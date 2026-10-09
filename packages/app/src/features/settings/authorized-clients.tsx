import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { clientsQuery } from "./queries";
import { SettingsNavigation } from "./navigation";
import { messageOf } from "../auth/session";
export function AuthorizedClients() {
  const cache = useQueryClient(), clients = useQuery(clientsQuery);
  const revoke = useMutation({ retry: false, mutationFn: async (clientId: string) => { const { error } = await api.DELETE("/api/v1/access/authorized-clients/{clientId}", { params: { path: { clientId } } }); if (error) throw new Error(messageOf(error)); }, onSuccess: () => cache.invalidateQueries({ queryKey: clientsQuery.queryKey }) });
  return <main className="mx-auto max-w-4xl p-6"><h1 className="text-3xl font-semibold">Authorized clients</h1><SettingsNavigation />{clients.isPending && <p role="status">Loading clients…</p>}{clients.error && <p role="alert">{clients.error.message}</p>}{revoke.error && <p role="alert">{revoke.error.message}</p>}{clients.data?.length === 0 && <p>No authorized clients.</p>}
    <ul>{clients.data?.map(client => <li className="my-4" key={client.grantId}><strong>{client.clientName}</strong><p>{client.scopes.join(", ")} · Authorized {client.authorizationDate} · Expires {client.expiresAt ?? "No expiry"}</p><button disabled={revoke.isPending} onClick={() => { if (window.confirm(`Revoke access for ${client.clientName}?`)) revoke.mutate(client.clientId); }}>Revoke client</button></li>)}</ul>
  </main>;
}
