import { useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { Button, Label, Textarea } from "../../shared/ui";
import { Dialog } from "../../shared/dialog";
import { menuItemClasses, popoverClasses, usePopover } from "../../shared/popover";
import { messageOf } from "../auth/session";

export function RunSkillButton({ skillId, name, disabled = false, compact = false }: { skillId: string; name: string; disabled?: boolean; compact?: boolean }) {
  const navigate = useNavigate(), attempt = useRef<{ key: string; prompt?: string } | null>(null);
  const [promptOpen, setPromptOpen] = useState(false), [prompt, setPrompt] = useState("");
  const promptInput = useRef<HTMLTextAreaElement>(null), menuId = useId(), menu = usePopover({ width: 176 });
  useEffect(() => { if (promptOpen) promptInput.current?.focus(); }, [promptOpen]);
  useEffect(() => { if (menu.open) menu.panel.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus(); }, [menu.open]);
  const launch = useMutation({ retry: false, mutationFn: async (additionalPrompt?: string) => {
    if (!attempt.current || attempt.current.prompt !== additionalPrompt) attempt.current = { key: crypto.randomUUID(), prompt: additionalPrompt };
    const { data, error } = await api.POST("/api/v1/runs", { body: { skill: skillId, idempotencyKey: attempt.current.key, ...(additionalPrompt ? { prompt: additionalPrompt } : {}) } });
    if (!data || error) throw new Error(messageOf(error)); return data;
  }, onSuccess: receipt => navigate({ to: "/runs/$runId", params: { runId: receipt.runId }, search: { after: 0 } }) });
  const unavailable = disabled || launch.isPending;
  const quietButton = "flex h-10 shrink-0 items-center justify-center text-slate-600 hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800";
  return <div className="min-w-0">
    {compact ? <div className="inline-flex rounded-lg border border-stone-200 dark:border-slate-700">
      <button type="button" className={`${quietButton} w-10 rounded-l-lg`} aria-label={`Run ${name}`} aria-busy={launch.isPending} title={disabled ? "This skill is disabled" : `Run ${name}`} disabled={unavailable} onClick={() => launch.mutate(undefined)}>
        <svg aria-hidden="true" width="32" height="32" viewBox="0 0 24 24"><path d="M6 3 21 12 6 21Z" fill="currentColor"/></svg>
      </button>
      <button ref={element => { menu.anchor.current = element; }} type="button" className={`${quietButton} w-7 rounded-r-lg`} aria-label={`Run options for ${name}`} aria-haspopup="menu" aria-expanded={menu.open} aria-controls={menuId} disabled={unavailable} onClick={() => menu.setOpen(!menu.open)} onKeyDown={event => { if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); menu.setOpen(true); } }}>
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </button>
    </div> : <Button variant="primary" aria-label={`Run ${name}`} title={disabled ? "This skill is disabled" : `Run ${name}`} disabled={unavailable} onClick={() => launch.mutate(undefined)}>{launch.isPending ? "Starting…" : "Run"}</Button>}
    {menu.open && <div ref={menu.panel} id={menuId} popover="manual" role="menu" aria-label={`Run options for ${name}`} className={popoverClasses} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) menu.setOpen(false); }}><button type="button" role="menuitem" className={menuItemClasses} onClick={() => { menu.close(); launch.reset(); setPrompt(""); setPromptOpen(true); }}>With prompt</button></div>}
    {promptOpen && <Dialog title={`Run ${name} with prompt`} close={() => setPromptOpen(false)}><form className="grid gap-4" onSubmit={event => { event.preventDefault(); if (prompt.trim() && !unavailable) launch.mutate(prompt.trim()); }}>
      <Label>Additional prompt<Textarea ref={promptInput} required maxLength={50000} value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="Add instructions for this run…"/></Label>
      <div className="flex justify-end gap-2"><Button type="button" onClick={() => setPromptOpen(false)}>Cancel</Button><Button variant="primary" disabled={unavailable || !prompt.trim()}>{launch.isPending ? "Starting…" : "Run"}</Button></div>
      {launch.error && <p role="alert" className="text-sm">{launch.error.message}</p>}
    </form></Dialog>}
    {launch.error && !promptOpen && <p role="alert" className="mt-2 max-w-xs whitespace-normal text-left text-xs">{launch.error.message}</p>}
  </div>;
}
