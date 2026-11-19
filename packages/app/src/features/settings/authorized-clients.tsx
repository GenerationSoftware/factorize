import { useState } from "react";
import { ClientPermissions, type AuthorizedClient } from "./client-permissions";
import { Button, Page } from "../../shared/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { clientsQuery } from "./queries";
import { SettingsLayout } from "./navigation";
import { messageOf } from "../auth/session";
export function AuthorizedClients() {
  const cache = useQueryClient(), clients = useQuery(clientsQuery);
  const [editing, setEditing] = useState<AuthorizedClient | null>(null);
  const revoke = useMutation({ retry: false, mutationFn: async (grantId: string) => { const { error } = await api.DELETE("/api/v1/access/authorizations/{grantId}", { params: { path: { grantId } } }); if (error) throw new Error(messageOf(error)); }, onSuccess: () => cache.invalidateQueries({ queryKey: clientsQuery.queryKey }) });
  return <SettingsLayout title="Authorized clients">{clients.isPending && <p role="status">Loading clients…</p>}{clients.error && <p role="alert">{clients.error.message}</p>}{revoke.error && <p role="alert">{revoke.error.message}</p>}{clients.data?.length === 0 && <p>No authorized clients.</p>}
    <ul>{clients.data?.map(client => <li className="my-4" key={client.grantId}><strong>{client.clientName}</strong><p>{client.scopes.join(", ")} · Authorized {client.authorizationDate} · Expires {client.expiresAt ?? "No expiry"}</p>{client.availableScopes && <Button onClick={() => setEditing(client)}>Edit permissions</Button>} <Button disabled={revoke.isPending} onClick={() => { if (window.confirm(`Revoke access for ${client.clientName}?`)) revoke.mutate(client.grantId); }}>Revoke connection</Button></li>)}</ul>
    {editing && <ClientPermissions client={editing} close={() => setEditing(null)} />}
  </SettingsLayout>;
}
