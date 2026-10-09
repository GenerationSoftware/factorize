import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { integrationsQuery } from "./queries";
import { messageOf } from "../auth/session";
export function IntegrationForm({ kind, connectionId, initialName = "", initialAgent = "codex", initialTags = [], initialApiBaseUrl }: { kind: "exe" | "amp" | "cloudflareTail"; connectionId?: string; initialName?: string; initialAgent?: "codex" | "claude" | "pi"; initialTags?: string[]; initialApiBaseUrl?: string }) {
  const cache = useQueryClient(), [credential, setCredential] = useState(""), [name, setName] = useState(initialName), [agentKind, setAgentKind] = useState<"codex" | "claude" | "pi">(initialAgent), [tags, setTags] = useState<string[]>(initialTags), [generatedSecret, setGeneratedSecret] = useState("");
  const test = useMutation({ retry: false, mutationFn: async () => {
    if (kind === "exe") { const { data, error } = await api.POST("/api/v1/integrations/exe/test", { body: { apiToken: credential || undefined, connectionId } }); if (!data || error) throw new Error(messageOf(error)); return data; }
    if (kind === "amp") { const { data, error } = await api.POST("/api/v1/integrations/amp/test", { body: { accessToken: credential || undefined, project: name || undefined, apiBaseUrl: initialApiBaseUrl, connectionId } }); if (!data || error) throw new Error(messageOf(error)); return { ...data, tags: [] }; }
    throw new Error("Save the Tail integration before testing.");
  } });
  const save = useMutation({ retry: false, mutationFn: async () => {
    if (kind === "exe") { const { data, error } = await api.PUT("/api/v1/integrations/exe", { body: { apiToken: credential, tags, agentKind, connectionId } }); if (!data || error) throw new Error(messageOf(error)); return { saved: true }; }
    if (kind === "amp") { const { data, error } = await api.PUT("/api/v1/integrations/amp", { body: { accessToken: credential, project: name, apiBaseUrl: initialApiBaseUrl, connectionId } }); if (!data || error) throw new Error(messageOf(error)); return { saved: true }; }
    const body = { name, signingSecret: credential || undefined, generateSecret: !credential && !connectionId };
    const { data, error } = connectionId ? await api.PUT("/api/v1/integrations/cloudflare-tail/{integrationId}", { params: { path: { integrationId: connectionId } }, body }) : await api.POST("/api/v1/integrations/cloudflare-tail", { body });
    if (!data || error) throw new Error(messageOf(error)); setGeneratedSecret(data.generatedSecret ?? ""); return { saved: true };
  }, onSuccess: async () => { setCredential(""); test.reset(); await cache.invalidateQueries({ queryKey: integrationsQuery.queryKey }); await cache.invalidateQueries({ queryKey: ["providers"] }); await cache.invalidateQueries({ queryKey: ["editor"] }); } });
  return <form className="my-4 grid gap-3" onSubmit={e => { e.preventDefault(); save.mutate(); }}>
    {kind !== "exe" && <label>{kind === "amp" ? "Amp project" : "Tail name"} <input required value={name} onChange={e => setName(e.target.value)} /></label>}
    <label>{kind === "exe" ? "exe.dev account token" : kind === "amp" ? "Amp access token" : "Tail signing secret (leave blank to generate or retain)"} <input type="password" autoComplete="new-password" required={kind !== "cloudflareTail"} value={credential} onChange={e => { setCredential(e.target.value); test.reset(); }} /></label>
    {kind === "exe" && <><label>Agent <select value={agentKind} onChange={e => setAgentKind(e.target.value as typeof agentKind)}><option value="codex">Codex</option><option value="claude">Claude</option><option value="pi">Pi</option></select></label><label>VM tags <select multiple value={tags} disabled={!test.data?.ok} onChange={e => setTags(Array.from(e.target.selectedOptions, option => option.value))}>{Array.from(new Set([...initialTags, ...(test.data?.tags ?? [])])).map(tag => <option key={tag}>{tag}</option>)}</select></label><p>Saving validates the agent and models on a temporary VM.</p></>}
    {kind !== "cloudflareTail" && <button type="button" disabled={test.isPending || save.isPending} onClick={() => test.mutate()}>Test credentials</button>}
    {test.data && <p role="status">{test.data.ok ? "Credentials verified" : "Credential test failed"}</p>}
    <button disabled={save.isPending || test.isPending}>{save.isPending ? "Saving…" : "Save integration"}</button>
    {save.isSuccess && <p role="status">Integration saved</p>}{[test.error, save.error].filter(Boolean).map((error, index) => <p key={index} role="alert">{error?.message}</p>)}
    {generatedSecret && <section role="status"><p>Copy this signing secret now; it is displayed only once.</p><pre className="whitespace-pre-wrap break-all">{generatedSecret}</pre><button type="button" onClick={() => setGeneratedSecret("")}>Dismiss secret</button></section>}
  </form>;
}
