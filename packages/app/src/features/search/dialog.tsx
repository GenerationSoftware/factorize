import { Button, Input, Label } from "../../shared/ui";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { api } from "factorize-api-client";
import { messageOf } from "../auth/session";

function Highlighted({ text, ranges }: { text: string; ranges: { start: number; end: number }[] }) {
  const parts: ReactNode[] = [], ordered = [...ranges].sort((a, b) => a.start - b.start);
  let cursor = 0;
  for (const range of ordered) { if (range.start > cursor) parts.push(text.slice(cursor, range.start)); parts.push(<strong key={`${range.start}:${range.end}`}>{text.slice(range.start, range.end)}</strong>); cursor = Math.max(cursor, range.end); }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}
export default function SearchDialog({ close }: { close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), navigate = useNavigate();
  const [text, setText] = useState(""), [q, setQuery] = useState(""), [selected, setSelected] = useState(0);
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; dialog.current?.showModal(); dialog.current?.querySelector("input")?.focus(); return () => { dialog.current?.close(); previous?.focus(); }; }, []);
  useEffect(() => { const timer = window.setTimeout(() => { setQuery(text.trim()); setSelected(0); }, 120); return () => window.clearTimeout(timer); }, [text]);
  const results = useQuery({ queryKey: ["search", q], enabled: !!q, queryFn: async ({ signal }) => { const { data, error } = await api.GET("/api/v1/search", { signal, params: { query: { q } } }); if (!data || error) throw new Error(messageOf(error)); return data; }, placeholderData: previous => previous, staleTime: 15_000, retry: 1 });
  const currentText = text.trim(), queryCurrent = currentText === q, items = currentText ? (results.data?.items ?? []) : [];
  useEffect(() => { setSelected(0); }, [q, results.data]);
  useEffect(() => { dialog.current?.querySelector(`#search-result-${selected}`)?.scrollIntoView({ block: "nearest" }); }, [selected, results.data]);
  const choose = (index: number) => { if (!queryCurrent) return; const item = items[index]; if (!item) return; close(); if (item.kind === "job") void navigate({ to: "/jobs/$jobId", params: { jobId: item.id } }); else void navigate({ to: "/job-runs/$runId", params: { runId: item.source.id }, search: { after: 0 } }); };
  return <dialog ref={dialog} aria-label="Search jobs, runs, and messages" onClose={close} onClick={e => { if (e.target === e.currentTarget) close(); }} className="w-[min(92vw,42rem)] h-[min(36rem,80dvh)] overflow-hidden">
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-4 flex shrink-0 items-start justify-between gap-3"><h2>Search</h2><Button onClick={close}>Close search</Button></div><Label className="shrink-0">Search jobs and runs by name, title, or issue identifier <Input autoFocus role="combobox" aria-expanded={items.length > 0} aria-autocomplete="list" value={text} maxLength={500} aria-controls="search-results" aria-activedescendant={queryCurrent && items.length ? `search-result-${selected}` : undefined} onChange={e => { setText(e.target.value); setSelected(0); }} onKeyDown={e => {
        if (e.key === "ArrowDown" && queryCurrent && items.length) { e.preventDefault(); setSelected(index => (index + 1) % items.length); }
        if (e.key === "ArrowUp" && queryCurrent && items.length) { e.preventDefault(); setSelected(index => (index - 1 + items.length) % items.length); }
        if (e.key === "Enter") { e.preventDefault(); choose(selected); }
      }} /></Label>
      <div className="mt-4 min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
        {!currentText && <p className="my-4 text-sm text-slate-600 dark:text-slate-400">Find jobs and runs by approximate name, title, or issue identifier. Use ↑ ↓ to select and Enter to open.</p>}
        {(results.isFetching || (currentText && !queryCurrent)) && <p role="status">{results.isFetching ? "Searching…" : "Updating…"}</p>}{results.error && <p role="alert">{results.error.message}</p>}{currentText && queryCurrent && !results.isPending && !items.length && <p>No results found.</p>}
        <ul id="search-results" role="listbox" aria-label="Search results">{items.map((item, index) => <li key={`${item.kind}:${item.id}:${index}`} role="presentation"><Button role="option" id={`search-result-${index}`} aria-selected={queryCurrent && selected === index} tabIndex={-1} className="my-2 w-full flex-col items-start !items-start text-left font-normal aria-selected:border-factorize-500 aria-selected:bg-factorize-50 dark:aria-selected:bg-factorize-500/10" onClick={() => choose(index)}><span className="block font-medium">{item.source.kind[0]!.toUpperCase() + item.source.kind.slice(1)} · {item.source.label}</span><span className="block text-sm"><Highlighted text={item.match.text} ranges={item.match.ranges} /></span></Button></li>)}</ul>
      </div>
    </div>
  </dialog>;
}
