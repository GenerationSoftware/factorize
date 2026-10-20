import { Button } from "../../shared/ui";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { tokensQuery } from "./queries";
import { SettingsLayout } from "./navigation";
import { messageOf } from "../auth/session";

export function ApiKeys() {
  const cache = useQueryClient(), tokens = useQuery(tokensQuery);
  const revoke = useMutation({ retry: false, mutationFn: async (tokenId: string) => { const { error } = await api.DELETE("/api/v1/access-tokens/{tokenId}", { params: { path: { tokenId } } }); if (error) throw new Error(messageOf(error)); }, onSuccess: () => cache.invalidateQueries({ queryKey: tokensQuery.queryKey }) });
  return <SettingsLayout title="API keys">
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4"><p>Manage the keys used to access your workspace.</p><Link to="/settings/api-keys/new"><Button variant="primary">Create API Key</Button></Link></div>
    {tokens.isPending && <p role="status">Loading keys…</p>}{tokens.error && <p role="alert">{tokens.error.message}</p>}{revoke.error && <p role="alert">{revoke.error.message}</p>}{tokens.data?.length === 0 && <p>No API keys.</p>}
    <ul>{tokens.data?.map(token => <li className="my-4 rounded-xl border border-stone-200 p-5 dark:border-slate-800" key={token.id}><strong>{token.name}</strong><p>{token.scopes.join(", ")} · Expires {token.expires_at} · Last used {token.last_used_at ?? "Never"}</p>{token.revoked_at ? <p>Revoked</p> : <Button disabled={revoke.isPending} onClick={() => { if (window.confirm(`Revoke ${token.name}?`)) revoke.mutate(token.id); }}>Revoke key</Button>}</li>)}</ul>
  </SettingsLayout>;
}
