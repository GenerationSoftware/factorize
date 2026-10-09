import { Button, Input, Select, Label, Page, Card } from "../../shared/ui";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { tokensQuery } from "./queries";
import { SettingsLayout } from "./navigation";
import { messageOf } from "../auth/session";
const allScopes = ["flows:read", "flows:write", "runs:read", "runs:write"] as const;
export function ApiKeys() {
  const cache = useQueryClient(), tokens = useQuery(tokensQuery), [secret, setSecret] = useState("");
  const [name, setName] = useState(""), [scopes, setScopes] = useState<(typeof allScopes[number])[]>(["flows:read", "runs:read"]), [expiryDays, setExpiryDays] = useState<7 | 30 | 90>(30);
  const create = useMutation({ retry: false, mutationFn: async () => { const { data, error } = await api.POST("/api/v1/access-tokens", { body: { name, scopes, expiryDays } }); if (!data || error) throw new Error(messageOf(error)); const { token, ...metadata } = data; setSecret(token); return metadata; }, onSuccess: () => { setName(""); void cache.invalidateQueries({ queryKey: tokensQuery.queryKey }); } });
  const revoke = useMutation({ retry: false, mutationFn: async (tokenId: string) => { const { error } = await api.DELETE("/api/v1/access-tokens/{tokenId}", { params: { path: { tokenId } } }); if (error) throw new Error(messageOf(error)); }, onSuccess: () => cache.invalidateQueries({ queryKey: tokensQuery.queryKey }) });
  return <SettingsLayout title="API keys">
    {secret && <Card role="status" className="border p-4"><p>Copy this key now. It will only be displayed once.</p><pre className="break-all whitespace-pre-wrap">{secret}</pre><Button onClick={() => void navigator.clipboard.writeText(secret)}>Copy key</Button><Button onClick={() => setSecret("")}>Dismiss key</Button></Card>}
    <form className="my-4 grid gap-3" onSubmit={e => { e.preventDefault(); create.mutate(); }}><Label>Key name <Input required maxLength={100} value={name} onChange={e => setName(e.target.value)} /></Label><fieldset><legend>Scopes</legend>{allScopes.map(scope => <Label key={scope} className="block"><Input type="checkbox" checked={scopes.includes(scope)} onChange={e => setScopes(e.target.checked ? [...scopes, scope] : scopes.filter(s => s !== scope))} />{scope}</Label>)}</fieldset><Label>Expiry <Select value={expiryDays} onChange={e => setExpiryDays(Number(e.target.value) as 7 | 30 | 90)}>{[7, 30, 90].map(days => <option key={days} value={days}>{days} days</option>)}</Select></Label><Button variant="primary" disabled={create.isPending || !scopes.length}>Create key</Button></form>
    {tokens.isPending && <p role="status">Loading keys…</p>}{[tokens.error, create.error, revoke.error].filter(Boolean).map((error, i) => <p key={i} role="alert">{error?.message}</p>)}{tokens.data?.length === 0 && <p>No API keys.</p>}
    <ul>{tokens.data?.map(token => <li className="my-4 rounded-xl border border-stone-200 p-5 dark:border-slate-800" key={token.id}><strong>{token.name}</strong><p>{token.scopes.join(", ")} · Expires {token.expires_at} · Last used {token.last_used_at ?? "Never"}</p>{token.revoked_at ? <p>Revoked</p> : <Button disabled={revoke.isPending} onClick={() => { if (window.confirm(`Revoke ${token.name}?`)) revoke.mutate(token.id); }}>Revoke key</Button>}</li>)}</ul>
  </SettingsLayout>;
}
