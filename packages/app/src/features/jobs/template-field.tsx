import { Disclosure, Summary, Button, Input, Textarea, Label } from "../../shared/ui";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { metadataQuery } from "./editor-queries";
import type { Event } from "./editor-state";
export function TemplateField({ label, value, onChange, events, multiline = false, local = false }: { label: string; value: string; onChange: (value: string) => void; events: Event[]; multiline?: boolean; local?:boolean }) {
  const metadata = useQuery(metadataQuery), [search, setSearch] = useState("");
  const highlight = useRef<HTMLPreElement>(null);
  const input = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const paths = events.flatMap(event => {
    const kind = event.kind === "webhook" ? event.config.provider : event.kind;
    const slug = event.slug;
    return slug ? (metadata.data?.[kind] ?? []).map(field => ({ ...field, path: local || field.path==="webhook" ? field.path : `${slug}.${field.path}` })) : [];
  }).filter(field => field.path.toLowerCase().includes(search.toLowerCase())).slice(0, 50);
  const insert = (path: string) => { const el = input.current, start = el?.selectionStart ?? value.length, end = el?.selectionEnd ?? start, text = `{{${path}}}`; onChange(value.slice(0, start) + text + value.slice(end)); requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(start + text.length, start + text.length); }); };
  return <div><Label>{label} {multiline ? <div className="template-editor mt-1.5"><pre ref={highlight} aria-hidden="true">{value.split(/({{[\s\S]*?}})/g).map((part, index) => part.startsWith("{{") ? <span key={index} className="font-semibold text-factorize-700 dark:text-factorize-500">{part}</span> : part)}{"\n"}</pre><Textarea aria-label={label} onScroll={inputEvent => { if (highlight.current) { highlight.current.scrollTop = inputEvent.currentTarget.scrollTop; highlight.current.scrollLeft = inputEvent.currentTarget.scrollLeft; } }} ref={el => { input.current = el; }} rows={10} maxLength={50_000} value={value} onChange={e => onChange(e.target.value)} /></div> : <Input aria-label={label} ref={el => { input.current = el; }} maxLength={500} value={value} onChange={e => onChange(e.target.value)} />}</Label>
    <Disclosure><Summary>Insert a {label.toLowerCase()} variable</Summary><Label>Find {label.toLowerCase()} variable <Input value={search} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); if (paths.length === 1) insert(paths[0].path); } }} onChange={e => setSearch(e.target.value)} /></Label>{paths.map(field => <Button key={field.path} type="button" title={field.description} onClick={() => insert(field.path)}>{field.path}</Button>)}{!paths.length && <p>Save new events to assign their stable template variable names, or search for another variable.</p>}</Disclosure>
  </div>;
}
