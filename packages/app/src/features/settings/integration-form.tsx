import { SecretInput } from "../../shared/credential-fields";
import { Button, Input, Label } from "../../shared/ui";
import { AutosaveStatus, useDebouncedAutosave } from "../../shared/use-debounced-autosave";
import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { messageOf } from "../auth/session";
export function IntegrationForm({ kind, connectionId, initialName = "", initialApiBaseUrl }: { kind: "exe" | "amp"; connectionId?: string; initialName?: string; initialApiBaseUrl?: string }) {
  const cache = useQueryClient(), [credential, setCredential] = useState(""), [name, setName] = useState(initialName), [savedFeedback, setSavedFeedback] = useState(false), savedSnapshot = useRef("");
  const save = useMutation({ retry: false, mutationFn: async () => {
    if (kind === "exe") { const { data, error } = await api.PUT("/api/v1/integrations/exe", { body: { apiToken: credential || undefined, connectionId } }); if (!data || error) throw new Error(messageOf(error)); return { saved: true }; }
    if (kind === "amp") { const { data, error } = await api.PUT("/api/v1/integrations/amp", { body: { accessToken: credential || undefined, project: name || undefined, apiBaseUrl: initialApiBaseUrl, connectionId } }); if (!data || error) throw new Error(messageOf(error)); return { saved: true }; }
  }, onSuccess: async () => { setCredential(""); setSavedFeedback(true); await cache.invalidateQueries({ queryKey: ["settings"] }); await cache.invalidateQueries({ queryKey: ["providers"] }); await cache.invalidateQueries({ queryKey: ["editor"] }); } });
  const value = { credential, name };
  if (!savedSnapshot.current) savedSnapshot.current = JSON.stringify({ credential: "", name: initialName });
  const validate = (next: typeof value) => {
    if ((kind !== "exe" && !next.name.trim()) || next.name.trim().length > 120) return "Enter a valid integration name.";
    return undefined;
  };
  const autosave = useDebouncedAutosave({ value, enabled: Boolean(connectionId) && JSON.stringify(value) !== savedSnapshot.current, validate, save: async next => { await save.mutateAsync(); savedSnapshot.current = JSON.stringify({ ...next, credential: "" }); } });
  return <form autoComplete="off" method="post" className="my-4 grid gap-3" onSubmit={e => { e.preventDefault(); save.mutate(); }}>
    {kind !== "exe" && <Label>Amp project <Input required value={name} onChange={e => setName(e.target.value)} /></Label>}
    <Label>{kind === "exe" ? "exe.dev account token" : "Amp access token"} <SecretInput name="integration-api-token" required={!connectionId} value={credential} onChange={e => { setCredential(e.target.value); }} /></Label>
        {!connectionId && <Button variant="primary" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save integration"}</Button>}
    {connectionId && <AutosaveStatus state={autosave.state} error={autosave.error} label="Integration" />}{!connectionId && savedFeedback && <p role="status" aria-live="polite">Integration saved</p>}{[save.error].filter(Boolean).map((error, index) => <p key={index} role="alert">{error?.message}</p>)}
  </form>;
}
