import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { Dialog } from "../../shared/dialog";
import { Button, Input, Label, Page } from "../../shared/ui";
import { messageOf } from "../auth/session";
import { ClientPermissions, type AuthorizedClient } from "./client-permissions";
import { clientsQuery } from "./queries";

function RenameConnection({ client }: { client: AuthorizedClient }) {
  const cache = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const rename = useMutation({
    retry: false,
    mutationFn: async (name: string) => {
      const { data, error } = await api.PUT("/api/v1/access/authorizations/{grantId}/name", {
        params: { path: { grantId: client.grantId } }, body: { name },
      });
      if (!data || error) throw new Error(messageOf(error));
      return data;
    },
    onSuccess: ({ name }) => {
      cache.setQueryData(clientsQuery.queryKey, clients =>
        clients?.map(row => row.grantId === client.grantId ? { ...row, clientName: name } : row));
      setEditing(false);
      return cache.invalidateQueries({ queryKey: clientsQuery.queryKey });
    },
  });
  return <>
    <Button disabled={rename.isPending} onClick={() => { rename.reset(); setName(client.clientName); setEditing(true); }}>Rename connection</Button>
    {editing && <Dialog title="Rename connection" close={() => setEditing(false)}>
      <form className="grid gap-3" onSubmit={event => {
        event.preventDefault();
        if (!rename.isPending && name.trim()) rename.mutate(name.trim());
      }}>
        <Label>Connection name<Input value={name} onChange={event => setName(event.target.value)} maxLength={120} required disabled={rename.isPending} /></Label>
        {rename.error && <p role="alert">{rename.error.message}</p>}
        <Button type="submit" variant="primary" disabled={rename.isPending || !name.trim()}>Save name</Button>
      </form>
    </Dialog>}
  </>;
}

function RevokeConnection({ client }: { client: AuthorizedClient }) {
  const cache = useQueryClient();
  const revoke = useMutation({
    retry: false,
    mutationFn: async () => {
      const { error } = await api.DELETE("/api/v1/access/authorizations/{grantId}", { params: { path: { grantId: client.grantId } } });
      if (error) throw new Error(messageOf(error));
    },
    onSuccess: () => Promise.all([
      cache.invalidateQueries({ queryKey: clientsQuery.queryKey }),
    ]),
  });
  return <>
    <Button disabled={revoke.isPending} onClick={() => {
      if (window.confirm(`Revoke access for ${client.clientName}?`)) revoke.mutate();
    }}>Revoke connection</Button>
    {revoke.error && <p role="alert">{revoke.error.message}</p>}
  </>;
}

export function ClientsPage() {
  const clients = useQuery(clientsQuery);
  const [editing, setEditing] = useState<AuthorizedClient | null>(null);
  return <Page>
    <h1 className="mb-4">Clients</h1>
    {clients.isPending && <p role="status">Loading clients…</p>}
    {clients.error && <p role="alert">{clients.error.message}</p>}
    {clients.data?.length === 0 && <p>No authorized clients.</p>}
    {!!clients.data?.length && <div className="overflow-x-auto"><table aria-label="MCP connections" className="w-full text-left text-sm">
      <thead><tr>
        <th className="px-2 py-3">Connection</th>
        <th className="px-2 py-3">App</th>
        <th className="px-2 py-3">Authorized</th>
        <th className="px-2 py-3">Actions</th>
      </tr></thead>
      <tbody>{clients.data.map(client => <tr className="border-t border-stone-200 dark:border-slate-800" key={client.grantId}>
        <th scope="row" className="px-2 py-3 font-medium"><Link className="underline" to="/clients/$grantId" params={{ grantId: client.grantId }}>{client.clientName}</Link></th>
        <td className="px-2 py-3">{client.appName ?? client.clientName}</td>
        <td className="px-2 py-3">{new Date(client.authorizationDate).toLocaleString()}</td>
        <td className="px-2 py-3"><div className="flex flex-wrap gap-2">
          <Button onClick={() => setEditing(client)}>Edit permissions</Button><RenameConnection client={client} /><RevokeConnection client={client} />
        </div></td>
      </tr>)}</tbody>
    </table></div>}
    {editing && <ClientPermissions client={editing} close={() => setEditing(null)} />}
  </Page>;
}

export function ClientPage() {
  const { grantId } = useParams({ from: "/clients/$grantId" });
  const clients = useQuery(clientsQuery);
  const client = clients.data?.find(item => item.grantId === grantId);
  const [editing, setEditing] = useState(false);
  return <Page>
    <Link to="/clients" className="underline">Clients</Link>
    <h1 className="my-4">{client?.clientName ?? "Client connection"}</h1>
    {clients.error && <p role="alert">{clients.error.message}</p>}
    {client && <div className="mb-4 flex flex-wrap gap-2">
      <Button onClick={() => setEditing(true)}>Edit permissions</Button><RenameConnection client={client} /><RevokeConnection client={client} />
    </div>}
    {editing && client && <ClientPermissions client={client} close={() => setEditing(false)} />}
  </Page>;
}
