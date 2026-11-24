import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { Button, Page } from "../../shared/ui";

export function EventsPage() {
  const client = useQueryClient();
  const [selected, setSelected] = useState<string>();
  const events = useQuery({ queryKey: ["events"], queryFn: async ({ signal }) => {
    const result = await api.GET("/api/v1/events", { signal });
    if (!result.data || result.error) throw new Error(result.error?.error?.message ?? "Could not load Events");
    return result.data;
  }});
  const occurrences = useQuery({ queryKey: ["events", selected, "occurrences"], enabled: !!selected, queryFn: async ({ signal }) => {
    const result = await api.GET("/api/v1/events/{eventId}/occurrences", { params: { path: { eventId: selected! }, query: { limit: 50 } }, signal });
    if (!result.data || result.error) throw new Error(result.error?.error?.message ?? "Could not load occurrences");
    return result.data;
  }});
  const remove = useMutation({ mutationFn: async (eventId: string) => {
    const result = await api.DELETE("/api/v1/events/{eventId}", { params: { path: { eventId } } });
    if (result.error) throw new Error(result.error.error?.message ?? "Could not delete Event");
  }, onSuccess: async (_result, eventId) => { if (selected === eventId) setSelected(undefined); await client.invalidateQueries({ queryKey: ["events"] }); } });
  return <Page><header className="mb-8"><p className="text-xs font-semibold uppercase tracking-widest text-factorize-700">Event stream</p><h1>Events</h1><p className="mt-2 text-slate-600 dark:text-slate-400">Durable occurrences published by Triggers. Subscribe to an Event’s occurrence resource over MCP.</p></header>
    {events.error && <p role="alert">{events.error.message}</p>}
    {remove.error && <p role="alert">{remove.error.message}</p>}
    <div className="grid gap-6 lg:grid-cols-2"><section><h2>Defined Events</h2><ul className="mt-3 divide-y divide-stone-200 dark:divide-slate-800">{(events.data ?? []).map(item => <li key={item.id} className="flex items-start justify-between gap-3 py-3"><button className="text-left" onClick={() => setSelected(item.id)}><strong>{item.name}</strong><span className="block text-sm text-slate-500">{item.description || "No description"} · {item.triggerCount} Triggers · {item.occurrenceCount} occurrences</span></button><Button disabled={remove.isPending} onClick={() => {if(window.confirm(`Delete ${item.name}, its Triggers, and all occurrence history?`))remove.mutate(item.id);}}>Delete</Button></li>)}</ul>{events.data?.length === 0 && <p>No Events yet.</p>}</section>
      <section><h2>Occurrences</h2>{!selected ? <p className="mt-3 text-slate-500">Select an Event to inspect its durable occurrences.</p> : occurrences.error ? <p role="alert">{occurrences.error.message}</p> : <ol className="mt-3 space-y-3">{(occurrences.data?.items ?? []).map(item => <li key={item.id} className="rounded border p-3"><time className="text-xs text-slate-500">{item.occurredAt}</time><pre className="mt-2 overflow-auto text-xs">{JSON.stringify(item.payload, null, 2)}</pre></li>)}</ol>}</section></div>
  </Page>;
}
