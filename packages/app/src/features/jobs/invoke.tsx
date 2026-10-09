import { useRef, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { api } from "factorize-api-client";
import { messageOf } from "../auth/session";
export function InvokeJob({ jobId, enabled }: { jobId: string; enabled: boolean }) {
  const cache = useQueryClient(), navigate = useNavigate();
  const retry = useRef<{ payload: string; key: string } | null>(null);
  const [validation, setValidation] = useState("");
  const mutation = useMutation({ retry: false, mutationFn: async (input: { prompt: string; data?: Record<string, unknown>; name?: string }) => {
    const payload = JSON.stringify(input);
    if (retry.current?.payload !== payload) retry.current = { payload, key: crypto.randomUUID() };
    const { data, error } = await api.POST("/api/v1/jobs/{jobId}/invocations", { params: { path: { jobId } }, body: { ...input, idempotencyKey: retry.current!.key } });
    if (error || !data) throw new Error(messageOf(error)); return data;
  }, onSuccess: async result => {
    retry.current = null;
    await cache.invalidateQueries({ queryKey: ["jobs"] });
    await cache.invalidateQueries({ queryKey: ["runs"] });
    await navigate({ to: "/job-runs/$runId", params: { runId: result.runId } });
  } });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (mutation.isPending) return;
    const form = new FormData(event.currentTarget); setValidation("");
    let data: Record<string, unknown> | undefined;
    try {
      const raw = String(form.get("data") ?? "").trim();
      if (raw) { const parsed: unknown = JSON.parse(raw); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(); data = parsed as Record<string, unknown>; }
    } catch { setValidation("JSON data must be an object."); return; }
    mutation.mutate({ prompt: String(form.get("prompt") ?? ""), data, ...(String(form.get("name") ?? "").trim() ? { name: String(form.get("name")).trim() } : {}) });
  }
  return <section className="my-6"><h2 className="text-xl font-semibold">Invoke job</h2>
    <form onSubmit={submit} className="grid gap-3">
      <label>Run name (optional)<input name="name" maxLength={120} /></label>
      <label>Prompt<textarea name="prompt" maxLength={50000} /></label>
      <label>JSON data (optional)<textarea name="data" placeholder={'{"key":"value"}'} /></label>
      <button disabled={!enabled || mutation.isPending}>{mutation.isPending ? "Invoking…" : "Invoke"}</button>
      {(validation || mutation.error) && <p role="alert">{validation || mutation.error?.message}</p>}
    </form>
  </section>;
}
