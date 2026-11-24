import { SecretInput } from "../../shared/credential-fields";
import { Button, Input, Label, Card } from "../../shared/ui";
import { AutosaveStatus, useDebouncedAutosave } from "../../shared/use-debounced-autosave";
import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { messageOf } from "../auth/session";
export function IntegrationForm({ kind, connectionId, initialName = "", initialApiBaseUrl }: { kind: "exe" | "amp" | "cloudflareTail"; connectionId?: string; initialName?: string; initialApiBaseUrl?: string }) {
  const cache = useQueryClient(), [credential, setCredential] = useState(""), [name, setName] = useState(initialName), [generatedSecret, setGeneratedSecret] = useState(""), [savedFeedback, setSavedFeedback] = useState(false), savedSnapshot = useRef("");
  const save = useMutation({ retry: false, mutationFn: async () => {
    if (kind === "exe") { const { data, error } = await api.PUT("/api/v1/integrations/exe", { body: { apiToken: credential || undefined, connectionId } }); if (!data || error) throw new Error(messageOf(error)); return { saved: true }; }
    if (kind === "amp") { const { data, error } = await api.PUT("/api/v1/integrations/amp", { body: { accessToken: credential || undefined, project: name || undefined, apiBaseUrl: initialApiBaseUrl, connectionId } }); if (!data || error) throw new Error(messageOf(error)); return { saved: true }; }
    const body = { name, signingSecret: credential || undefined, generateSecret: !credential && !connectionId };
    const { data, error } = connectionId ? await api.PUT("/api/v1/integrations/cloudflare-tail/{integrationId}", { params: { path: { integrationId: connectionId } }, body }) : await api.POST("/api/v1/integrations/cloudflare-tail", { body });
    if (!data || error) throw new Error(messageOf(error)); setGeneratedSecret(data.generatedSecret ?? ""); return { saved: true };
  }, onSuccess: async () => { setCredential(""); setSavedFeedback(true); await cache.invalidateQueries({ queryKey: ["settings"] }); await cache.invalidateQueries({ queryKey: ["providers"] }); await cache.invalidateQueries({ queryKey: ["editor"] }); } });
  const value = { credential, name };
  if (!savedSnapshot.current) savedSnapshot.current = JSON.stringify({ credential: "", name: initialName });
  const validate = (next: typeof value) => {
    if ((kind !== "exe" && !next.name.trim()) || next.name.trim().length > 120) return "Enter a valid integration name.";
    if (kind === "cloudflareTail" && next.credential && next.credential.length < 16) return "Tail signing secrets must be at least 16 characters.";
    return undefined;
  };
  const autosave = useDebouncedAutosave({ value, enabled: Boolean(connectionId) && JSON.stringify(value) !== savedSnapshot.current, validate, save: async next => { await save.mutateAsync(); savedSnapshot.current = JSON.stringify({ ...next, credential: "" }); } });
  return <form autoComplete="off" method="post" className="my-4 grid gap-3" onSubmit={e => { e.preventDefault(); save.mutate(); }}>
    {kind !== "exe" && <Label>{kind === "amp" ? "Amp project" : "Tail name"} <Input required value={name} onChange={e => setName(e.target.value)} /></Label>}
    <Label>{kind === "exe" ? "exe.dev account token" : kind === "amp" ? "Amp access token" : "Tail signing secret (leave blank to generate or retain)"} <SecretInput name="integration-api-token" required={!connectionId && kind !== "cloudflareTail"} value={credential} onChange={e => { setCredential(e.target.value); }} /></Label>
        {!connectionId && <Button variant="primary" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save integration"}</Button>}
    {connectionId && <AutosaveStatus state={autosave.state} error={autosave.error} label="Integration" />}{!connectionId && savedFeedback && <p role="status" aria-live="polite">Integration saved</p>}{[save.error].filter(Boolean).map((error, index) => <p key={index} role="alert">{error?.message}</p>)}
    {generatedSecret && <Card role="status"><p>Copy this signing secret now; it is displayed only once.</p><pre className="whitespace-pre-wrap break-all">{generatedSecret}</pre><Button type="button" onClick={() => setGeneratedSecret("")}>Dismiss secret</Button></Card>}
  </form>;
}
