import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type paths } from "factorize-api-client";
import { Button, Table, tableCellClasses, tableHeadClasses, tableRowClasses } from "../../shared/ui";
import { SubscriptionTime } from "./subscriptions-table";

type History = { eventId: string } | { subscriptionId: string };
type EventOccurrence = paths["/api/v1/events/{eventId}/occurrence-summaries"]["get"]["responses"][200]["content"]["application/json"]["items"][number];
type SubscriptionOccurrence = paths["/api/v1/event-subscriptions/{subscriptionId}/occurrences"]["get"]["responses"][200]["content"]["application/json"]["items"][number];
function hasDelivery(item: EventOccurrence): item is SubscriptionOccurrence { return "delivery" in item; }
const pageSize = 10;
const sourceLabels = {
  manual: "Manual trigger", schedule: "Schedule", github: "GitHub", linear: "Linear webhook",
  cloudflare: "Cloudflare webhook", webhook: "Webhook", unknown: "Unknown",
};
const deliveryLabels = {
  pending: "Pending", sending: "Sending", accepted: "HTTP accepted", failed: "Failed", cancelled: "Cancelled",
};
const acknowledgmentLabels = {
  off: "Off", pending: "Pending delivery", awaiting_ack: "Awaiting acknowledgment", processed: "Acknowledged",
  waived: "Waived", exhausted: "Recovery exhausted", cancelled: "Cancelled",
};

export function OccurrenceTable(history: History) {
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const subscription = "subscriptionId" in history;
  const label = subscription ? "Subscription occurrences" : "Event occurrences";
  const cursor = cursors.at(-1);
  const page = useQuery({
    queryKey: subscription
      ? ["event-subscriptions", history.subscriptionId, "occurrences", cursor]
      : ["events", history.eventId, "occurrence-summaries", cursor],
    queryFn: async ({ signal }) => {
      const query = { limit: pageSize, cursor };
      const result = subscription
        ? await api.GET("/api/v1/event-subscriptions/{subscriptionId}/occurrences", { signal, params: { path: history, query } })
        : await api.GET("/api/v1/events/{eventId}/occurrence-summaries", { signal, params: { path: history, query } });
      if (!result.data || result.error) throw new Error(result.error?.error?.message ?? "Could not load occurrences");
      return result.data;
    },
  });
  const columns = subscription
    ? ["Timestamp", "Source", "Occurrence ID", "Delivery", "Acknowledgment"]
    : ["Timestamp", "Source", "Occurrence ID"];
  const next = page.data?.nextCursor;
  return <section>
    <h2 className="mb-3">Occurrence history</h2>
    {subscription && <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">HTTP acceptance confirms receipt, not processing. Acknowledgment is tracked separately.</p>}
    {page.isPending && <p role="status">Loading occurrences…</p>}
    {page.error && <p role="alert">{page.error.message}</p>}
    {page.data?.items.length === 0 && <p>No occurrences on this page.</p>}
    {!!page.data?.items.length && <Table aria-label={label}>
      <thead className={tableHeadClasses}><tr>{columns.map(column =>
        <th key={column} scope="col" className={tableCellClasses}>{column}</th>)}</tr></thead>
      <tbody>{page.data.items.map(item => <tr key={item.id} className={tableRowClasses}>
        <td className={tableCellClasses}><SubscriptionTime value={item.occurredAt} /></td>
        <td className={tableCellClasses}>{sourceLabels[item.source]}</td>
        <th scope="row" className={tableCellClasses}><code className="select-all break-all text-xs font-normal">{item.id}</code></th>
        {hasDelivery(item) && <>
          <td className={tableCellClasses}>{deliveryLabels[item.delivery]}</td>
          <td className={tableCellClasses}>{acknowledgmentLabels[item.acknowledgment]}</td>
        </>}
      </tr>)}</tbody>
    </Table>}
    <nav aria-label={label + " pagination"} className="mt-3 flex flex-wrap items-center gap-3">
      <Button disabled={cursors.length === 1} onClick={() => setCursors(stack => stack.slice(0, -1))}>Previous page</Button>
      <span aria-live="polite" className="text-sm">Page {cursors.length}</span>
      <Button disabled={!next} onClick={() => { if (next) setCursors(stack => [...stack, next]); }}>Next page</Button>
    </nav>
  </section>;
}
