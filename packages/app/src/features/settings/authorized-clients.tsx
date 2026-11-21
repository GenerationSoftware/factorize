import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { Button, Page } from "../../shared/ui";
import { VmAttachments } from "../vms/attachments";
import { messageOf } from "../auth/session";
import { ClientPermissions, type AuthorizedClient } from "./client-permissions";
import { clientsQuery } from "./queries";

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
      cache.invalidateQueries({ queryKey: ["vm-attachments"] }),
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
          <Button onClick={() => setEditing(client)}>Edit permissions</Button><RevokeConnection client={client} />
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
      <Button onClick={() => setEditing(true)}>Edit permissions</Button><RevokeConnection client={client} />
    </div>}
    <h2 className="mb-2 text-lg font-semibold">VMs</h2>
    <VmAttachments source={{ kind: "client", id: grantId }} />
    {editing && client && <ClientPermissions client={client} close={() => setEditing(false)} />}
  </Page>;
}
