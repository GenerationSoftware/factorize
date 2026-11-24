import { GitToken } from "./git-token";
import { useEffect, useId, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { Button, Input, Label } from "../../shared/ui";
import { popoverClasses, usePopover } from "../../shared/popover";
import { messageOf } from "../auth/session";

export function SkillsCodeMenu() {
  const id = useId(), popover = usePopover({ width: 384 }), [copied, setCopied] = useState(""), [copyError, setCopyError] = useState("");
  const info = useQuery({ queryKey: ["skill-library", "clone"], enabled: popover.open, queryFn: async () => {
    const { data, error } = await api.GET("/api/v1/skill-library/clone"); if (error || !data) throw new Error(messageOf(error)); return data;
  } });
  const copy = async (label: string, value: string) => { setCopyError(""); try { await navigator.clipboard.writeText(value); setCopied(label); } catch { setCopyError("Copy unavailable. Select the text and copy it."); } };
  const close = () => { setCopied(""); setCopyError(""); popover.setOpen(false); };
  // Credentials are removed from the rendered UI whenever the dropdown closes.
  useEffect(() => { if (!popover.open) { setCopied(""); setCopyError(""); } }, [popover.open]);
  return <>
    <button ref={element => { popover.anchor.current = element; }} type="button" aria-haspopup="dialog" aria-controls={id} aria-expanded={popover.open} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-green-800/20 bg-[#1f883d] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#1a7f37] dark:border-green-400/20 dark:bg-[#238636] dark:hover:bg-[#2ea043]" onClick={() => popover.open ? close() : popover.setOpen(true)}><span aria-hidden="true" className="font-mono text-base">&lt;&gt;</span> Code <span aria-hidden="true" className="text-xs">▾</span></button>
    {popover.open && <div ref={popover.panel} id={id} popover="manual" role="dialog" aria-label="Clone skills repository" className={`${popoverClasses} p-0`}>
      <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3 dark:border-slate-700"><span className="text-sm font-semibold">Clone</span><button type="button" aria-label="Close Code menu" className="flex size-8 items-center justify-center rounded hover:bg-stone-100 dark:hover:bg-slate-800" onClick={() => { close(); popover.anchor.current?.focus(); }}>✕</button></div>
      <div className="space-y-3 p-4"><span className="inline-block border-b-2 border-factorize-500 pb-1 text-sm font-semibold">HTTPS</span>
        {info.isPending && <p role="status" className="text-sm">Loading repository…</p>}{info.error && <p role="alert">{info.error.message}</p>}
        {info.data?.url ? <>
          <div className="flex min-w-0 items-end gap-2"><Label className="min-w-0 flex-1">Repository URL<Input readOnly value={info.data.url} className="font-mono text-xs" onFocus={event => event.target.select()} /></Label><Button aria-label="Copy clone URL" onClick={() => void copy("Clone URL", info.data!.url!)}>{copied === "Clone URL" ? "✓" : <svg aria-hidden="true" className="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M11 5V2H2v9h3"/></svg>}</Button></div>
          <p className="break-words text-xs text-slate-600 dark:text-slate-400">Branch <code>{info.data.branch}</code> · Skills folder <code>{info.data.folder || "/"}</code></p>
          {info.data.source === "github" ? <p className="text-xs text-slate-600 dark:text-slate-400">Use your GitHub credentials to clone or push. Factorize syncs from this repository.</p> : <>
            <p className="text-xs text-slate-600 dark:text-slate-400">Clone, pull and push with a Factorize Git token. Pushes update your team’s skills.</p>
            <GitToken buttonLabel="Get Git token" buttonClassName="w-full"/>
          </>}
        </> : info.data && <p className="text-sm">Configure a skills repository to enable cloning.</p>}
        {copied && <p role="status" className="text-xs">{copied} copied.</p>}{copyError && <p role="alert">{copyError}</p>}
      </div>
    </div>}
  </>;
}
