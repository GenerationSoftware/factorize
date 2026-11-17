import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { Button, Card } from "../../shared/ui";
import { messageOf } from "../auth/session";

const permissions = [
  ["tweet.read", "Read posts the authorized account can view."],
  ["tweet.write", "Post and delete posts for the authorized account."],
  ["tweet.moderate.write", "Hide or unhide replies to the account's posts."],
  ["users.read", "Read user profiles the account can view."],
  ["users.email", "Read the authorized account's email address."],
  ["follows.read", "Read the account's followers and following."],
  ["follows.write", "Follow or unfollow accounts."],
  ["offline.access", "Keep the connection active with refresh tokens."],
  ["space.read", "Read Spaces the account can view."],
  ["mute.read", "Read muted accounts."], ["mute.write", "Mute or unmute accounts."],
  ["like.read", "Read posts liked by the account."], ["like.write", "Like or unlike posts."],
  ["list.read", "Read Lists the account can access."], ["list.write", "Create and manage Lists."],
  ["block.read", "Read blocked accounts."], ["block.write", "Block or unblock accounts."],
  ["bookmark.read", "Read bookmarked posts."], ["bookmark.write", "Bookmark or remove bookmarks."],
  ["dm.read", "Read Direct Messages."], ["dm.write", "Send and manage Direct Messages."],
  ["media.write", "Upload media for posts."], ["broadcast.read", "Read live broadcasts and chat."],
  ["broadcast.write", "Manage live broadcasts and send chat messages."],
] as const;
type XScope = typeof permissions[number][0];
const suggested: XScope[] = ["tweet.read", "users.read", "offline.access"];

export function XConnections() {
  const cache = useQueryClient();
  const [name, setName] = useState(""), [clientId, setClientId] = useState(""), [clientSecret, setClientSecret] = useState("");
  const [scopes, setScopes] = useState<XScope[]>(suggested), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const connections = useQuery({ queryKey: ["settings", "x-connections"], queryFn: async ({ signal }) => {
    const result = await api.GET("/api/v1/x/connections", { signal });
    if (!result.data || result.error) throw new Error(messageOf(result.error));
    return result.data.connections;
  }, staleTime: 0 });
  useEffect(() => {
    const result = new URLSearchParams(location.search).get("x");
    const messages: Record<string, string> = {
      connected: "X account connected and verified.", denied: "X authorization was declined. You can try again when ready.",
      expired: "That X authorization expired or was already used. Start a new attempt.",
      scope_mismatch: "X granted fewer permissions than selected. Review the scopes and reconnect.",
      session_required: "Sign in again as the workspace owner before connecting X.", failed: "X authorization could not be verified. Check the app setup and try again.",
    };
    if (result && messages[result]) {
      setNotice(messages[result]);
      const clean = new URL(location.href); clean.searchParams.delete("x"); history.replaceState(null, "", clean);
      void cache.invalidateQueries({ queryKey: ["settings", "x-connections"] });
    }
  }, [cache]);
  const create = useMutation({ retry: false, mutationFn: async () => {
    const response = await api.POST("/api/v1/x/connections", { body: { id: crypto.randomUUID(), name, clientId, clientSecret, scopes } });
    if (!response.data || response.error) throw new Error(messageOf(response.error));
    return response.data;
  }, onSuccess: async connection => {
    setClientSecret(""); setName(""); setClientId("");
    await cache.invalidateQueries({ queryKey: ["settings", "x-connections"] });
    const response = await api.POST("/api/v1/x/connections/{connectionId}/authorize", { params: { path: { connectionId: connection.id } }, body: {} });
    if (!response.data || response.error) throw new Error(messageOf(response.error));
    location.assign(response.data.authorizationUrl);
  }, onError: value => setError(value.message) });
  const authorize = useMutation({ retry: false, mutationFn: async (id: string) => {
    const response = await api.POST("/api/v1/x/connections/{connectionId}/authorize", { params: { path: { connectionId: id } }, body: {} });
    if (!response.data || response.error) throw new Error(messageOf(response.error));
    location.assign(response.data.authorizationUrl);
  }, onError: value => setError(value.message) });
  const toggle = (scope: XScope) => setScopes(current => current.includes(scope) ? current.filter(item => item !== scope) : [...current, scope]);
  const callback = `${location.origin}/oauth/x/callback`;

  return <section aria-labelledby="x-connections-heading" className="mt-8 space-y-4">
    <div><h2 id="x-connections-heading" className="text-2xl font-bold">X connections</h2><p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Connect your own X developer app and account. API usage is billed to your X developer account.</p></div>
    {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800 dark:bg-green-950 dark:text-green-200">{notice}</p>}
    {connections.error && <p role="alert">{connections.error.message}</p>}
    {connections.data?.map(connection => <Card key={connection.id} className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{connection.name}</h3><p className="text-sm text-slate-600 dark:text-slate-400">{connection.accountHandle ? `@${connection.accountHandle} · ${connection.accountId}` : "No X account connected yet"}</p></div><span className="rounded-full border px-3 py-1 text-sm">{connection.status === "connected" ? "Connected" : connection.status === "reconnect_required" ? "Needs attention" : "Setup incomplete"}</span></div>
      {connection.grantedScopes.length > 0 && <p className="text-sm">Granted permissions: {connection.grantedScopes.join(", ")}</p>}
      {connection.status !== "connected" && <Button disabled={authorize.isPending} onClick={() => { setError(null); authorize.mutate(connection.id); }}>Connect X</Button>}
    </Card>)}
    <Card className="space-y-5">
      <div><h3 className="text-lg font-semibold">Set up your X developer app</h3><ol className="ml-5 list-decimal space-y-2 text-sm text-slate-700 dark:text-slate-300">
        <li><a className="underline" href="https://developer.x.com/en/portal/dashboard" target="_blank" rel="noreferrer">Open the X Developer Console</a> and create a project and app. In app permissions, choose Read and write only if you plan to grant write scopes below.</li>
        <li>Enable OAuth 2.0, choose a Web App / confidential client, and add this callback URL exactly: <code className="break-all">{callback}</code> <button type="button" className="ml-2 underline" onClick={() => void navigator.clipboard.writeText(callback)}>Copy callback</button>.</li>
        <li>Fund API credits and set spending limits in X's console. X API calls can incur charges; Factorize does not collect or estimate these charges.</li>
        <li>Copy the OAuth 2.0 Client ID and Client Secret here. Factorize encrypts the secret and never shows it again.</li>
      </ol></div>
      <label className="block text-sm font-medium">Connection name<input className="mt-1 block w-full rounded-lg border px-3 py-2 dark:bg-slate-950" value={name} onChange={event => setName(event.target.value)} maxLength={80} required /></label>
      <label className="block text-sm font-medium">OAuth 2.0 Client ID<input className="mt-1 block w-full rounded-lg border px-3 py-2 dark:bg-slate-950" autoComplete="off" value={clientId} onChange={event => setClientId(event.target.value)} required /></label>
      <label className="block text-sm font-medium">OAuth 2.0 Client Secret<input className="mt-1 block w-full rounded-lg border px-3 py-2 dark:bg-slate-950" type="password" autoComplete="new-password" value={clientSecret} onChange={event => setClientSecret(event.target.value)} required /></label>
      <fieldset><legend className="font-semibold">X permissions</legend><p className="mb-3 text-sm text-slate-600 dark:text-slate-400">Suggested access is read-only posts and user profiles, plus offline access. Write permissions are opt-in. Direct Messages and other sensitive access are never selected automatically.</p><div className="mb-3 flex flex-wrap gap-2"><Button type="button" onClick={() => setScopes(suggested)}>Use suggested posts and users access</Button><Button type="button" onClick={() => setScopes(current => [...new Set<XScope>([...current, "tweet.write"])])}>Add post write access</Button></div><div className="grid gap-2 sm:grid-cols-2">{permissions.map(([scope, description]) => <label key={scope} className="flex items-start gap-2 rounded border p-2 text-sm"><input type="checkbox" checked={scopes.includes(scope)} onChange={() => toggle(scope)} /><span><code>{scope}</code><br /><span className="text-slate-600 dark:text-slate-400">{description}</span></span></label>)}</div><p className="mt-2 text-xs text-slate-600 dark:text-slate-400">tweet.read, users.read, and offline.access are required for this connection. The server validates the selected permission set.</p></fieldset>
      {error && <p role="alert" className="text-red-700 dark:text-red-400">{error}</p>}
      <Button disabled={create.isPending || !name.trim() || !clientId.trim() || !clientSecret || scopes.length === 0 || !scopes.includes("offline.access") || !scopes.includes("tweet.read") || !scopes.includes("users.read")} onClick={() => { setError(null); setNotice(null); create.mutate(); }}>{create.isPending ? "Saving…" : "Save app and connect X"}</Button>
    </Card>
  </section>;
}
