import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { tokensQuery } from "./queries";
import { SettingsNavigation } from "./navigation";
import { messageOf } from "../auth/session";
const allScopes = ["flows:read", "flows:write", "runs:read", "runs:write"] as const;
export function ApiKeys() {
  const cache = useQueryClient(), tokens = useQuery(tokensQuery), [secret, setSecret] = useState("");
  const [name, setName] = useState(""), [scopes, setScopes] = useState<(typeof allScopes[number])[]>(["flows:read", "runs:read"]), [expiryDays, setExpiryDays] = useState<7 | 30 | 90>(30);
  const create = useMutation({ retry: false, mutationFn: async () => { const { data, error } = await api.POST("/api/v1/access-tokens", { body: { name, scopes, expiryDays } }); if (!data || error) throw new Error(messageOf(error)); const { token, ...metadata } = data; setSecret(token); return metadata; }, onSuccess: () => { setName(""); void cache.invalidateQueries({ queryKey: tokensQuery.queryKey }); } });
  const revoke = useMutation({ retry: false, mutationFn: async (tokenId: string) => { const { error } = await api.DELETE("/api/v1/access-tokens/{tokenId}", { params: { path: { tokenId } } }); if (error) throw new Error(messageOf(error)); }, onSuccess: () => cache.invalidateQueries({ queryKey: tokensQuery.queryKey }) });
  return <main className="mx-auto max-w-4xl p-6"><h1 className="text-3xl font-semibold">API keys</h1><SettingsNavigation />
    {secret && <section role="status" className="border p-4"><p>Copy this key now. It will only be displayed once.</p><pre className="break-all whitespace-pre-wrap">{secret}</pre><button onClick={() => void navigator.clipboard.writeText(secret)}>Copy key</button><button onClick={() => setSecret("")}>Dismiss key</button></section>}
    <form className="my-4 grid gap-3" onSubmit={e => { e.preventDefault(); create.mutate(); }}><label>Key name <input required maxLength={100} value={name} onChange={e => setName(e.target.value)} /></label><fieldset><legend>Scopes</legend>{allScopes.map(scope => <label key={scope} className="block"><input type="checkbox" checked={scopes.includes(scope)} onChange={e => setScopes(e.target.checked ? [...scopes, scope] : scopes.filter(s => s !== scope))} />{scope}</label>)}</fieldset><label>Expiry <select value={expiryDays} onChange={e => setExpiryDays(Number(e.target.value) as 7 | 30 | 90)}>{[7, 30, 90].map(days => <option key={days} value={days}>{days} days</option>)}</select></label><button disabled={create.isPending || !scopes.length}>Create key</button></form>
    {tokens.isPending && <p role="status">Loading keys…</p>}{[tokens.error, create.error, revoke.error].filter(Boolean).map((error, i) => <p key={i} role="alert">{error?.message}</p>)}{tokens.data?.length === 0 && <p>No API keys.</p>}
    <ul>{tokens.data?.map(token => <li className="my-4" key={token.id}><strong>{token.name}</strong><p>{token.scopes.join(", ")} · Expires {token.expires_at} · Last used {token.last_used_at ?? "Never"}</p>{token.revoked_at ? <p>Revoked</p> : <button disabled={revoke.isPending} onClick={() => { if (window.confirm(`Revoke ${token.name}?`)) revoke.mutate(token.id); }}>Revoke key</button>}</li>)}</ul>
  </main>;
}
