import { triggersQuery } from "../triggers/queries";
import type { ReactNode } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { Button, Page, PageHeader, Table, tableCellClasses, tableHeadClasses, tableRowClasses } from "../../shared/ui";
import { OccurrenceTable } from "./occurrence-table";
import { eventsQuery, subscriptionsQuery } from "./queries";
import { EventSubscriptions, SubscriptionsTable, SubscriptionTime } from "./subscriptions-table";

const linkClass = "rounded-lg px-3 py-2 hover:bg-stone-100 dark:hover:bg-slate-800";
const activeClass = "bg-factorize-50 text-factorize-700 dark:bg-factorize-500/10 dark:text-factorize-500";
function EventsLayout({ title, description, children, subscriptions }: { title: string; description?: string; children: ReactNode; subscriptions?: boolean }) {
  return <Page><div className="grid min-w-0 gap-8 md:grid-cols-[13rem_minmax(0,1fr)] md:gap-10">
    <nav aria-label="Event navigation" className="flex flex-wrap gap-2 border-b border-stone-200 pb-4 text-sm font-semibold dark:border-slate-800 md:flex-col md:border-b-0">
      <Link to="/events" className={linkClass} activeOptions={{ exact: true }} inactiveProps={subscriptions ? {} : { className: activeClass, "aria-current": "location" }} activeProps={{ className: activeClass }}>Events</Link>
      <Link to="/events/subscriptions" className={linkClass} activeProps={{ className: activeClass }}>Subscriptions</Link>
    </nav>
    <div className="min-w-0"><PageHeader title={title} description={description} />{children}</div>
  </div></Page>;
}

export function EventsPage() {
  const events = useQuery(eventsQuery);
  const subscriptions = useQuery(subscriptionsQuery);
  const counts = new Map<string, number>();
  for (const row of subscriptions.data ?? []) if (row.status === "active") counts.set(row.eventId, (counts.get(row.eventId) ?? 0) + 1);
  return <EventsLayout title="Events" description="MCP Events to help coordinate your agents">
    {events.isPending && <p role="status">Loading Events…</p>}
    {events.error && <p role="alert">{events.error.message}</p>}
    {subscriptions.error && <p role="alert">Subscriber counts could not be loaded.</p>}
    {events.data?.length === 0 && <p>No Events yet.</p>}
    {!!events.data?.length && <Table aria-label="Events">
      <thead className={tableHeadClasses}><tr>{["Name", "Description", "Subscribers"].map(label =>
        <th key={label} scope="col" className={tableCellClasses} title={label === "Subscribers" ? "Active registrations for your connections in this workspace" : undefined}>{label}</th>)}</tr></thead>
      <tbody>{events.data.map(item => <tr key={item.id} className={tableRowClasses}>
        <th scope="row" className={`${tableCellClasses} font-medium`}><Link
          to="/events/$eventId" params={{ eventId: item.id }}
          className="underline after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-factorize-500">{item.name}</Link></th>
        <td className={tableCellClasses}>{item.description || "No description"}</td>
        <td className={tableCellClasses}>{subscriptions.error ? "—" : subscriptions.isPending ? "…" : counts.get(item.id) ?? 0}</td>
      </tr>)}</tbody>
    </Table>}
  </EventsLayout>;
}

export function EventPage() {
  const { eventId } = useParams({ from: "/events/$eventId" });
  const cache = useQueryClient();
  const navigate = useNavigate();
  const events = useQuery({ ...eventsQuery, select: rows => rows.find(row => row.id === eventId) });
  const detail = useQuery({ queryKey: ["events",eventId,"detail"], enabled: !!events.data, queryFn: async ({signal}) => {
    const response = await api.GET("/api/v1/events/{eventId}",{signal,params:{path:{eventId}}});
    if (!response.data || response.error) throw new Error(response.error?.error?.message ?? "Could not load the Event rule.");
    return response.data;
  }});
  const triggers = useQuery({ ...triggersQuery(), enabled: !!events.data, select: rows => rows.filter(row => row.eventId === eventId) });
  const event = events.data;
  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await api.DELETE("/api/v1/events/{eventId}", { params: { path: { eventId } } });
      if (error) throw new Error(error.error?.message ?? "Could not delete Event");
    },
    onSuccess: async () => {
      await Promise.all([
        cache.invalidateQueries({ queryKey: eventsQuery.queryKey }),
        cache.invalidateQueries({ queryKey: subscriptionsQuery.queryKey }),
      ]);
      cache.removeQueries({ queryKey: ["events", eventId, "occurrence-summaries"] });
      await navigate({ to: "/events" });
    },
  });
  return <EventsLayout title={event?.name ?? "Event"} description={event?.description || undefined}>
    {events.isPending && <p role="status">Loading Event…</p>}
    {events.error && <p role="alert">{events.error.message}</p>}
    {!events.isPending && !events.error && !event && <p>Event not found.</p>}
    {remove.error && <p role="alert">{remove.error.message}</p>}
    {event && <div className="space-y-8">
      <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <div><dt className="font-semibold">Revision</dt><dd>{event.revision}</dd></div>
        <div><dt className="font-semibold">Triggers</dt><dd>{event.triggerCount}</dd></div>
        <div><dt className="font-semibold">Occurrences</dt><dd>{event.occurrenceCount}</dd></div>
        <div><dt className="font-semibold">Created</dt><dd><SubscriptionTime value={event.createdAt} /></dd></div>
        <div><dt className="font-semibold">Updated</dt><dd><SubscriptionTime value={event.updatedAt} /></dd></div>
      </dl>
      <section className="space-y-3">
        <h2>Triggers</h2>
        {triggers.error && <p role="alert">{triggers.error.message}</p>}
        {triggers.isPending && <p role="status">Loading Triggers...</p>}
        {triggers.data?.length ? <Table>
          <thead><tr>{["Trigger","Input sources","Status"].map(item=><th key={item} scope="col" className={tableCellClasses}>{item}</th>)}</tr></thead>
          <tbody>{triggers.data.map(trigger=><tr key={trigger.id}>
            <td className={tableCellClasses}><Link className="text-factorize-700 hover:underline" to="/triggers/$triggerId" params={{triggerId:trigger.id}}>{trigger.name}</Link></td>
            <td className={tableCellClasses}>{[...new Set(trigger.sources.map(source=>source.kind))].join(", ") || "None"}</td>
            <td className={tableCellClasses}>{trigger.enabled ? "Enabled" : "Disabled"}</td>
          </tr>)}</tbody>
        </Table> : triggers.data && <p>No Triggers are attached.</p>}
      </section>
      {detail.data?.enrichmentPauseReason === "integration_removed" && <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">Evaluation is paused because an integration used by this Event was disconnected. Repair the match logic through the Factorize API or MCP to resume evaluation.</p>}
      {detail.data?.enrichment && <section className="space-y-3 rounded-xl border border-stone-200 bg-stone-50 p-4 dark:border-slate-700 dark:bg-slate-900">
        <h2>Match logic</h2>
        <p className="text-sm">After a Trigger matches, lookups run in order. The Event fires only when the final rule is true.</p>
        {!!detail.data.enrichment.extraDataUrls.length && <ol className="space-y-2 text-sm">
          {detail.data.enrichment.extraDataUrls.map((step,index)=><li key={step.name} className="rounded bg-white p-2 dark:bg-slate-800">
            <strong>{index+1}. {step.name}</strong> <span className="ml-2 font-mono text-xs">{step.method} {step.path}</span>
          </li>)}
        </ol>}
        <p className="text-sm font-semibold">Final rule</p>
        <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-white p-3 text-sm dark:bg-slate-800">{detail.data.enrichment.rule}</pre>
        <p className="text-xs">Read only. Edit this rule through the Factorize API or MCP.</p>
      </section>}
      <section><h2 className="mb-3">Subscriptions</h2><EventSubscriptions eventId={eventId} /></section>
      <OccurrenceTable key={eventId} eventId={eventId} />
      <Button disabled={remove.isPending} onClick={() => {
        if (window.confirm(`Delete ${event.name}, its Triggers, subscriptions, and all occurrence history?`)) remove.mutate();
      }}>Delete</Button>
    </div>}
  </EventsLayout>;
}

export function SubscriptionsPage() {
  return <EventsLayout subscriptions title="Subscriptions" description="MCP clients subscribed to Events. Active registrations may still be unable to receive deliveries.">
    <EventSubscriptions />
  </EventsLayout>;
}

export function SubscriptionPage() {
  const { subscriptionId } = useParams({ from: "/events/subscriptions/$subscriptionId" });
  const subscription = useQuery({
    queryKey: ["event-subscriptions", subscriptionId],
    queryFn: async ({ signal }) => {
      const { data, error, response } = await api.GET("/api/v1/event-subscriptions/{subscriptionId}", { params: { path: { subscriptionId } }, signal });
      if (response.status === 404) return null;
      if (!data || error) throw new Error(error?.error?.message ?? "Could not load subscription");
      return data;
    },
  });
  return <EventsLayout subscriptions title="Subscription" description={subscription.data?.eventName}>
    {subscription.isPending && <p role="status">Loading subscription…</p>}
    {subscription.error && <p role="alert">{subscription.error.message}</p>}
    {subscription.data === null && <p>Event subscription not found.</p>}
    {subscription.data && <>
      <dl className="mb-5 space-y-2 text-sm">
        <div>
          <dt className="font-semibold">Subscription ID</dt>
          <dd className="break-all font-mono">{subscription.data.id}</dd>
        </div>
        <div>
          <dt className="font-semibold">Last cooldown started</dt>
          <dd>{subscription.data.lastCooldownStartedAt
            ? <SubscriptionTime value={subscription.data.lastCooldownStartedAt} /> : "Not recorded"}</dd>
        </div>
      </dl>
      <SubscriptionsTable detail rows={[subscription.data]} />
      <div className="mt-8"><OccurrenceTable key={subscriptionId} subscriptionId={subscriptionId} /></div>
    </>}
  </EventsLayout>;
}
