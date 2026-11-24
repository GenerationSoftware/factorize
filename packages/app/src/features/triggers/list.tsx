import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Page } from "../../shared/ui";
import { triggersQuery } from "./queries";
export function TriggerList() {
  const query = useQuery(triggersQuery());
  return <Page><header className="mb-6 flex items-center justify-between"><div><h1>Triggers</h1><p className="mt-2 text-slate-600">Inputs that publish Event occurrences.</p></div><Link to="/triggers/new"><Button variant="primary">Create Trigger</Button></Link></header>{query.isPending ? <p role="status">Loading Triggers…</p> : query.error ? <p role="alert">{query.error.message}</p> : !query.data?.length ? <p>No Triggers yet. Create an Event first, then attach a Trigger.</p> : <ul className="grid gap-3">{query.data.map(trigger => <li key={trigger.id} className="rounded border p-4"><Link className="font-medium underline" to="/triggers/$triggerId" params={{ triggerId: trigger.id }}>{trigger.name}</Link><p className="text-sm text-slate-600">{trigger.events.map(event => event.kind).join(", ")} · {trigger.enabled ? "Enabled" : "Disabled"}</p></li>)}</ul>}</Page>;
}
