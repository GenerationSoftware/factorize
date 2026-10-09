import { Button, Input, Label } from "../../shared/ui";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { selectorQuery } from "./editor-queries";
export function LifecycleSelector({ selected, onChange }: { selected: string[]; onChange: (ids: string[]) => void }) {
  const [q, setQ] = useState(""), [cursor, setCursor] = useState<string>();
  const jobs = useQuery(selectorQuery(q, cursor));
  return <fieldset><legend>Source jobs</legend>
    <Label>Search source jobs <Input value={q} maxLength={120} onKeyDown={e => { if (e.key === "Enter") e.preventDefault(); }} onChange={e => { setQ(e.target.value); setCursor(undefined); }} /></Label>
    {jobs.isPending && <p role="status">Loading source jobs…</p>}{jobs.error && <p role="alert">{jobs.error.message}</p>}
    {selected.length > 0 && <p>Selected: {selected.join(", ")}</p>}
    {jobs.data?.items.map(job => <Label key={job.id} className="block"><Input type="checkbox" checked={selected.includes(job.id)} onChange={e => onChange(e.target.checked ? [...selected, job.id] : selected.filter(id => id !== job.id))} /> {job.name}</Label>)}
    {cursor && <Button type="button" onClick={() => setCursor(undefined)}>First source page</Button>}
    {jobs.data?.nextCursor && <Button type="button" onClick={() => setCursor(jobs.data!.nextCursor!)}>More source jobs</Button>}
  </fieldset>;
}
