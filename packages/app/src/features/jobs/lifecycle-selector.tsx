import { Button, Input, Label } from "../../shared/ui";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { selectorQuery } from "./editor-queries";
export function LifecycleSelector({ selected, onChange, kind = "source", presentation = "default" }: { selected: string[]; onChange: (ids: string[]) => void; kind?:"source"|"destination"; presentation?:"default"|"preset" }) {
  const [q, setQ] = useState(""), [cursor, setCursor] = useState<string>();
  const triggers = useQuery(selectorQuery(q, cursor));
  const styled = presentation === "preset";
  return <fieldset className={styled ? "!rounded-xl !border-stone-200 !bg-white !p-5 dark:!border-slate-700 dark:!bg-slate-900" : ""}><legend className={styled ? "sr-only" : ""}>{kind === "source" ? "Source triggers" : "Allowed destination triggers"}</legend>
    {styled && <div className="mb-4"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="!mb-0 text-lg font-semibold">Allowed triggers</h2><span className="text-xs text-slate-500 dark:text-slate-400">{selected.length} selected</span></div><p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Choose which triggers these runs may invoke. The Run permission to invoke triggers is also required.</p></div>}
    <Label>Search {kind} triggers <Input value={q} maxLength={120} onKeyDown={e => { if (e.key === "Enter") e.preventDefault(); }} onChange={e => { setQ(e.target.value); setCursor(undefined); }} /></Label>
    {triggers.isPending && <p role="status">Loading {kind} triggers…</p>}{triggers.error && <p role="alert">{triggers.error.message}</p>}
    {selected.length > 0 && (styled ? <div className="my-3 flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400"><span>{selected.length} allowed {selected.length === 1 ? "trigger" : "triggers"}</span><button type="button" className="rounded px-2 py-1 underline underline-offset-2 hover:text-factorize-700 dark:hover:text-factorize-500" onClick={() => onChange([])}>Clear selection</button></div> : <p>Selected: {selected.join(", ")}</p>)}
    <div className={styled ? "mt-3 grid gap-2 sm:grid-cols-2" : ""}>{triggers.data?.items.map(trigger => <Label key={trigger.id} className={styled ? `flex min-h-12 cursor-pointer items-center gap-2 rounded-lg border px-3 py-3 ${selected.includes(trigger.id) ? "border-factorize-500 bg-factorize-50 dark:bg-factorize-500/10" : "border-stone-200 hover:bg-stone-50 dark:border-slate-700 dark:hover:bg-slate-800"}` : "block"}><Input type="checkbox" checked={selected.includes(trigger.id)} onChange={e => onChange(e.target.checked ? [...selected, trigger.id] : selected.filter(id => id !== trigger.id))} /> {trigger.name}</Label>)}</div>
    {styled && triggers.data && !triggers.data.items.length && <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">No matching triggers.</p>}
    {cursor && <Button type="button" onClick={() => setCursor(undefined)}>First {kind} page</Button>}
    {triggers.data?.nextCursor && <Button type="button" onClick={() => setCursor(triggers.data!.nextCursor!)}>More {kind} triggers</Button>}
  </fieldset>;
}
