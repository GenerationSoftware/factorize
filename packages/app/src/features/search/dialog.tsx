import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { api } from "factorize-api-client";
import { messageOf } from "../auth/session";
export default function SearchDialog({ close }: { close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), navigate = useNavigate();
  const [text, setText] = useState(""), [q, setQuery] = useState(""), [selected, setSelected] = useState(0);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => { const timer = window.setTimeout(() => { setQuery(text.trim()); setSelected(0); }, 120); return () => window.clearTimeout(timer); }, [text]);
  const results = useQuery({ queryKey: ["search", q], enabled: !!q, queryFn: async ({ signal }) => { const { data, error } = await api.GET("/api/v1/search", { signal, params: { query: { q } } }); if (!data || error) throw new Error(messageOf(error)); return data; }, staleTime: 15_000, retry: 1 });
  const items = results.data?.items ?? [];
  const choose = (index: number) => { const item = items[index]; if (!item) return; close(); if (item.kind === "job") void navigate({ to: "/jobs/$jobId", params: { jobId: item.id } }); else void navigate({ to: "/job-runs/$runId", params: { runId: item.id }, search: { after: 0 } }); };
  return <dialog ref={dialog} aria-label="Search jobs and runs" onClose={close} onClick={e => { if (e.target === e.currentTarget) close(); }} className="w-[min(92vw,42rem)] max-h-[80vh] overflow-auto rounded bg-slate-900 text-slate-100 p-5">
    <label>Search jobs and runs <input autoFocus value={text} maxLength={500} aria-controls="search-results" aria-activedescendant={items.length ? `search-result-${selected}` : undefined} onChange={e => setText(e.target.value)} onKeyDown={e => {
      if (e.key === "ArrowDown" && items.length) { e.preventDefault(); setSelected(index => (index + 1) % items.length); }
      if (e.key === "ArrowUp" && items.length) { e.preventDefault(); setSelected(index => (index - 1 + items.length) % items.length); }
      if (e.key === "Enter") { e.preventDefault(); choose(selected); }
    }} /></label><button onClick={close}>Close search</button>
    {results.isFetching && <p role="status">Searching…</p>}{results.error && <p role="alert">{results.error.message}</p>}{q && !results.isPending && !items.length && <p>No results found.</p>}
    <ul id="search-results" role="listbox" aria-label="Search results">{items.map((item, index) => <li key={`${item.kind}:${item.id}:${index}`} role="option" id={`search-result-${index}`} aria-selected={selected === index}><button className="my-2 w-full text-left" onClick={() => choose(index)}>{item.title}<span className="block text-sm">{item.kind} · {item.subtitle}</span></button></li>)}</ul>
  </dialog>;
}
