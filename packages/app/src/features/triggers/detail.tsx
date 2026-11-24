import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Page } from "../../shared/ui";
import { triggerQuery } from "./queries";
import { FireTrigger } from "./invoke";
export function TriggerDetail() {
  const { triggerId } = useParams({ strict: false });
  const query = useQuery(triggerQuery(triggerId ?? ""));
  if (query.isPending) return <Page><p role="status">Loading Trigger…</p></Page>;
  if (query.error || !query.data) return <Page><p role="alert">{query.error?.message ?? "Trigger not found."}</p></Page>;
  const trigger = query.data;
  return <Page><header className="mb-6"><h1>{trigger.name}</h1><p className="mt-2 text-slate-600">Publishes occurrences of Event {trigger.eventId}.</p><div className="mt-4 flex gap-3"><Link to="/triggers/$triggerId/edit" params={{ triggerId: trigger.id }}><Button>Edit Trigger</Button></Link><Link to="/triggers"><Button>All Triggers</Button></Link></div></header><section className="max-w-xl rounded border p-4"><h2 className="mb-3 font-medium">Manual input</h2><FireTrigger triggerId={trigger.id} enabled={trigger.enabled} /></section></Page>;
}
