import { Button, Input, Label } from "../../shared/ui";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { selectorQuery } from "./editor-queries";
export function LifecycleSelector({ selected, onChange, kind = "source" }: { selected: string[]; onChange: (ids: string[]) => void; kind?:"source"|"destination" }) {
  const [q, setQ] = useState(""), [cursor, setCursor] = useState<string>();
  const triggers = useQuery(selectorQuery(q, cursor));
  return <fieldset><legend>{kind === "source" ? "Source triggers" : "Allowed destination triggers"}</legend>
    <Label>Search {kind} triggers <Input value={q} maxLength={120} onKeyDown={e => { if (e.key === "Enter") e.preventDefault(); }} onChange={e => { setQ(e.target.value); setCursor(undefined); }} /></Label>
    {triggers.isPending && <p role="status">Loading {kind} triggers…</p>}{triggers.error && <p role="alert">{triggers.error.message}</p>}
    {selected.length > 0 && <p>Selected: {selected.join(", ")}</p>}
    {triggers.data?.items.map(trigger => <Label key={trigger.id} className="block"><Input type="checkbox" checked={selected.includes(trigger.id)} onChange={e => onChange(e.target.checked ? [...selected, trigger.id] : selected.filter(id => id !== trigger.id))} /> {trigger.name}</Label>)}
    {cursor && <Button type="button" onClick={() => setCursor(undefined)}>First {kind} page</Button>}
    {triggers.data?.nextCursor && <Button type="button" onClick={() => setCursor(triggers.data!.nextCursor!)}>More {kind} triggers</Button>}
  </fieldset>;
}
