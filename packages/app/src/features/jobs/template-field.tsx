import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { metadataQuery } from "./editor-queries";
import type { Trigger } from "./editor-state";
export function TemplateField({ label, value, onChange, triggers, multiline = false }: { label: string; value: string; onChange: (value: string) => void; triggers: Trigger[]; multiline?: boolean }) {
  const metadata = useQuery(metadataQuery), [search, setSearch] = useState("");
  const input = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const paths = triggers.flatMap(trigger => {
    const kind = trigger.kind === "webhook" ? trigger.config.provider : trigger.kind;
    const slug = trigger.slug;
    return slug ? (metadata.data?.[kind] ?? []).map(field => ({ ...field, path: `${slug}.${field.path}` })) : [];
  }).filter(field => field.path.toLowerCase().includes(search.toLowerCase())).slice(0, 50);
  const insert = (path: string) => { const el = input.current, start = el?.selectionStart ?? value.length, end = el?.selectionEnd ?? start, text = `{{${path}}}`; onChange(value.slice(0, start) + text + value.slice(end)); requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(start + text.length, start + text.length); }); };
  return <div><label>{label} {multiline ? <textarea aria-label={label} ref={el => { input.current = el; }} required rows={10} maxLength={50_000} value={value} onChange={e => onChange(e.target.value)} /> : <input aria-label={label} ref={el => { input.current = el; }} maxLength={500} value={value} onChange={e => onChange(e.target.value)} />}</label>
    <details><summary>Insert a {label.toLowerCase()} variable</summary><label>Find {label.toLowerCase()} variable <input value={search} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); if (paths.length === 1) insert(paths[0].path); } }} onChange={e => setSearch(e.target.value)} /></label>{paths.map(field => <button key={field.path} type="button" title={field.description} onClick={() => insert(field.path)}>{field.path}</button>)}{!paths.length && <p>Save new triggers to assign their stable template variable names, or search for another variable.</p>}</details>
  </div>;
}
