import { Dialog } from "../../shared/dialog";
import { Button, Input, Textarea, Label } from "../../shared/ui";
import { useRef, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { api } from "factorize-api-client";
import { messageOf } from "../auth/session";

export function InvokeJob({ jobId, enabled }: { jobId: string; enabled: boolean }) {
  const cache = useQueryClient(), navigate = useNavigate();
  const retry = useRef<{ payload: string; key: string } | null>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false), [menuOpen, setMenuOpen] = useState(false);
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
  function invoke(input: { prompt: string; data?: Record<string, unknown>; name?: string }) {
    if (!enabled || mutation.isPending) return;
    mutation.mutate(input);
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (mutation.isPending) return;
    const form = new FormData(event.currentTarget); setValidation("");
    let data: Record<string, unknown> | undefined;
    try {
      const raw = String(form.get("data") ?? "").trim();
      if (raw) { const parsed: unknown = JSON.parse(raw); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(); data = parsed as Record<string, unknown>; }
    } catch { setValidation("JSON data must be an object."); return; }
    invoke({ prompt: String(form.get("prompt") ?? ""), data, ...(String(form.get("name") ?? "").trim() ? { name: String(form.get("name")).trim() } : {}) });
  }
  return <div className="relative my-4 flex items-stretch">
    <Button className="min-h-9 rounded-r-none px-2.5 py-1.5 text-xs" variant="primary" disabled={!enabled || mutation.isPending} onClick={() => invoke({ prompt: "" })}>{mutation.isPending ? "Running…" : "Run job"}</Button>
    <Button ref={menuButton} variant="primary" disabled={!enabled || mutation.isPending} aria-label="More run options" aria-haspopup="menu" aria-expanded={menuOpen} aria-controls="run-job-menu" className="rounded-l-none px-2" onClick={() => { mutation.reset(); setMenuOpen(value => !value); }}>▾</Button>
    {menuOpen && <div id="run-job-menu" role="menu" aria-label="Run options" className="absolute left-0 top-full z-10 mt-2 min-w-44 rounded-lg border border-stone-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
      <button role="menuitem" className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-stone-100 dark:hover:bg-slate-800" onClick={() => { setMenuOpen(false); mutation.reset(); menuButton.current?.focus(); setOpen(true); }}>Run with prompt</button>
    </div>}
    {mutation.error && !open && <p role="alert" className="absolute left-0 top-full mt-3 w-max max-w-[min(28rem,calc(100vw-2rem))]">{mutation.error.message}</p>}
    {open && <Dialog title="Run with prompt" close={() => setOpen(false)}>
      <p className="mb-5 text-sm text-slate-600 dark:text-slate-400">Start a run with optional instructions and trigger data.</p>
      <form onSubmit={submit} className="grid gap-3">
        <Label>Run name (optional)<Input name="name" maxLength={120} /></Label>
        <Label>Prompt<Textarea name="prompt" maxLength={50000} autoFocus /></Label>
        <Label>JSON data (optional)<Textarea name="data" placeholder={'{"key":"value"}'} /></Label>
        <div className="flex flex-wrap justify-end gap-2"><Button type="button" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" disabled={!enabled || mutation.isPending}>{mutation.isPending ? "Invoking…" : "Run with prompt"}</Button></div>
        {(validation || mutation.error) && <p role="alert">{validation || mutation.error?.message}</p>}
      </form>
    </Dialog>}
  </div>;
}
