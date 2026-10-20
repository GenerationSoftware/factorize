import { Button, Input, Select, Label, Card } from "../../shared/ui";
import { AutosaveStatus, useDebouncedAutosave } from "../../shared/use-debounced-autosave";
import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { integrationsQuery } from "./queries";
import { messageOf } from "../auth/session";
export function IntegrationForm({ kind, connectionId, initialName = "", initialAgent = "codex", initialTags = [], initialApiBaseUrl }: { kind: "exe" | "amp" | "cloudflareTail"; connectionId?: string; initialName?: string; initialAgent?: "codex" | "claude" | "pi"; initialTags?: string[]; initialApiBaseUrl?: string }) {
  const cache = useQueryClient(), [credential, setCredential] = useState(""), [name, setName] = useState(initialName), [agentKind, setAgentKind] = useState<"codex" | "claude" | "pi">(initialAgent), [tags, setTags] = useState<string[]>(initialTags), [generatedSecret, setGeneratedSecret] = useState(""), [savedFeedback, setSavedFeedback] = useState(false), savedSnapshot = useRef("");
  const test = useMutation({ retry: false, mutationFn: async () => {
    if (kind === "exe") { const { data, error } = await api.POST("/api/v1/integrations/exe/test", { body: { apiToken: credential || undefined, connectionId } }); if (!data || error) throw new Error(messageOf(error)); return data; }
    if (kind === "amp") { const { data, error } = await api.POST("/api/v1/integrations/amp/test", { body: { accessToken: credential || undefined, project: name || undefined, apiBaseUrl: initialApiBaseUrl, connectionId } }); if (!data || error) throw new Error(messageOf(error)); return { ...data, tags: [] }; }
    throw new Error("Save the Tail integration before testing.");
  } });
  const save = useMutation({ retry: false, mutationFn: async () => {
    if (kind === "exe") { const { data, error } = await api.PUT("/api/v1/integrations/exe", { body: { apiToken: credential || undefined, tags, agentKind, connectionId } }); if (!data || error) throw new Error(messageOf(error)); return { saved: true }; }
    if (kind === "amp") { const { data, error } = await api.PUT("/api/v1/integrations/amp", { body: { accessToken: credential || undefined, project: name || undefined, apiBaseUrl: initialApiBaseUrl, connectionId } }); if (!data || error) throw new Error(messageOf(error)); return { saved: true }; }
    const body = { name, signingSecret: credential || undefined, generateSecret: !credential && !connectionId };
    const { data, error } = connectionId ? await api.PUT("/api/v1/integrations/cloudflare-tail/{integrationId}", { params: { path: { integrationId: connectionId } }, body }) : await api.POST("/api/v1/integrations/cloudflare-tail", { body });
    if (!data || error) throw new Error(messageOf(error)); setGeneratedSecret(data.generatedSecret ?? ""); return { saved: true };
  }, onSuccess: async () => { setCredential(""); setSavedFeedback(true); test.reset(); await cache.invalidateQueries({ queryKey: integrationsQuery.queryKey }); await cache.invalidateQueries({ queryKey: ["providers"] }); await cache.invalidateQueries({ queryKey: ["editor"] }); } });
  const value = { credential, name, agentKind, tags };
  if (!savedSnapshot.current) savedSnapshot.current = JSON.stringify({ credential: "", name: initialName, agentKind: initialAgent, tags: initialTags });
  const validate = (next: typeof value) => {
    if (kind === "exe" && (!connectionId || !["codex", "claude", "pi"].includes(next.agentKind))) return "Choose a valid agent for this integration.";
    if ((kind !== "exe" && !next.name.trim()) || next.name.trim().length > 120) return "Enter a valid integration name.";
    if (kind === "cloudflareTail" && next.credential && next.credential.length < 16) return "Tail signing secrets must be at least 16 characters.";
    if (next.tags.length > 20 || next.tags.some(tag => !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(tag))) return "VM tags are invalid.";
    return undefined;
  };
  const autosave = useDebouncedAutosave({ value, enabled: Boolean(connectionId) && JSON.stringify(value) !== savedSnapshot.current, validate, save: async next => { await save.mutateAsync(); savedSnapshot.current = JSON.stringify({ ...next, credential: "" }); } });
  return <form className="my-4 grid gap-3" onSubmit={e => { e.preventDefault(); save.mutate(); }}>
    {kind !== "exe" && <Label>{kind === "amp" ? "Amp project" : "Tail name"} <Input required value={name} onChange={e => setName(e.target.value)} /></Label>}
    <Label>{kind === "exe" ? "exe.dev account token" : kind === "amp" ? "Amp access token" : "Tail signing secret (leave blank to generate or retain)"} <Input type="password" autoComplete="new-password" required={!connectionId && kind !== "cloudflareTail"} value={credential} onChange={e => { setCredential(e.target.value); test.reset(); }} /></Label>
    {kind === "exe" && <><Label>Agent <Select value={agentKind} onChange={e => setAgentKind(e.target.value as typeof agentKind)}><option value="codex">Codex</option><option value="claude">Claude</option><option value="pi">Pi</option></Select></Label><Label>VM tags <Select multiple value={tags} disabled={!connectionId && !test.data?.ok} onChange={e => setTags(Array.from(e.target.selectedOptions, option => option.value))}>{Array.from(new Set([...initialTags, ...(test.data?.tags ?? [])])).map(tag => <option key={tag}>{tag}</option>)}</Select></Label><p>Saving validates the agent and models on a temporary VM.</p></>}
    {kind !== "cloudflareTail" && <Button type="button" disabled={test.isPending || save.isPending} onClick={() => test.mutate()}>Test credentials</Button>}
    {test.data?.ok && <p role="status" aria-live="polite" className="text-green-700 dark:text-green-400">✓ Credentials verified.</p>}
    {test.data && !test.data.ok && <p role="alert" aria-live="polite" className="text-red-700 dark:text-red-400">Credential verification failed.</p>}
    {!connectionId && <Button variant="primary" disabled={save.isPending || test.isPending}>{save.isPending ? "Saving…" : "Save integration"}</Button>}
    {connectionId && <AutosaveStatus state={autosave.state} error={autosave.error} label="Integration" />}{!connectionId && savedFeedback && <p role="status" aria-live="polite">Integration saved</p>}{[test.error, save.error].filter(Boolean).map((error, index) => <p key={index} role="alert">{error?.message}</p>)}
    {generatedSecret && <Card role="status"><p>Copy this signing secret now; it is displayed only once.</p><pre className="whitespace-pre-wrap break-all">{generatedSecret}</pre><Button type="button" onClick={() => setGeneratedSecret("")}>Dismiss secret</Button></Card>}
  </form>;
}
