import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { Dialog } from "../../shared/dialog";
import {
  Button, Input, Label, Page, PageHeader, Table, tableCellClasses, tableHeadClasses, tableRowClasses,
} from "../../shared/ui";
import { messageOf } from "../auth/session";
import { ClientPermissions, type AuthorizedClient } from "./client-permissions";
import { clientsQuery } from "./queries";
import { EventSubscriptions } from "../events/subscriptions-table";
import { subscriptionsQuery } from "../events/queries";

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
      cache.invalidateQueries({ queryKey: subscriptionsQuery.queryKey }),
    ]),
  });
  return <>
    <Button disabled={revoke.isPending} onClick={() => {
      if (window.confirm(`Revoke access for ${client.clientName}?`)) revoke.mutate();
    }}>Revoke connection</Button>
    {revoke.error && <p role="alert">{revoke.error.message}</p>}
  </>;
}

function ConnectionDate({ value }: { value: string | null }) {
  return value ? <time dateTime={value}>{new Date(value).toLocaleString()}</time> : "No expiration";
}

export function ClientsPage() {
  const clients = useQuery(clientsQuery);
  return <Page>
    <PageHeader title="Clients" description="All of the connected MCP clients" />
    {clients.isPending && <p role="status">Loading clients…</p>}
    {clients.error && <p role="alert">{clients.error.message}</p>}
    {clients.data?.length === 0 && <p>No authorized clients.</p>}
    {!!clients.data?.length && <Table aria-label="MCP connections">
      <thead className={tableHeadClasses}><tr>
        {["Username", "Connection", "App", "Authorized", "Expires"].map(label =>
          <th scope="col" className={tableCellClasses} key={label}>{label}</th>)}
      </tr></thead>
      <tbody>{clients.data.map(client => <tr className={tableRowClasses} key={client.grantId}>
        <td className={tableCellClasses}>{client.ownerUsername ?? "—"}</td>
        <th scope="row" className={`${tableCellClasses} font-medium`}><Link className="underline" to="/clients/$grantId" params={{ grantId: client.grantId }}>{client.clientName}</Link></th>
        <td className={tableCellClasses}>{client.appName ?? client.clientName}</td>
        <td className={`${tableCellClasses} whitespace-nowrap`}><ConnectionDate value={client.authorizationDate} /></td>
        <td className={`${tableCellClasses} whitespace-nowrap`}><ConnectionDate value={client.expiresAt} /></td>
      </tr>)}</tbody>
    </Table>}
  </Page>;
}

export function ClientPage() {
  const { grantId } = useParams({ from: "/clients/$grantId" });
  const clients = useQuery(clientsQuery);
  const client = clients.data?.find(item => item.grantId === grantId);
  const [editing, setEditing] = useState(false);
  return <Page>
    <PageHeader title={client?.clientName ?? "Client connection"} />
    {clients.isPending && <p role="status">Loading client…</p>}
    {clients.error && <p role="alert">{clients.error.message}</p>}
    {!clients.isPending && !clients.error && !client && <p>Client connection not found.</p>}
    {client && <>
      <dl className="mb-5 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div><dt className="font-semibold">Username</dt><dd>{client.ownerUsername ?? "—"}</dd></div>
        <div><dt className="font-semibold">Client</dt><dd>{client.appName ?? client.clientName}</dd></div>
        <div><dt className="font-semibold">Authorized</dt><dd><ConnectionDate value={client.authorizationDate} /></dd></div>
        <div><dt className="font-semibold">Expires</dt><dd><ConnectionDate value={client.expiresAt} /></dd></div>
      </dl>
      <div className="mb-4 flex flex-wrap gap-2">
        <Button onClick={() => setEditing(true)}>Edit permissions</Button><RenameConnection client={client} /><RevokeConnection client={client} />
      </div>
      <section><h2 className="mb-3">Subscriptions</h2><EventSubscriptions grantId={client.grantId} /></section>
    </>}
    {editing && client && <ClientPermissions client={client} close={() => setEditing(false)} />}
  </Page>;
}
