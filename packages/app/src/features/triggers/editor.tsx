import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { api, type components } from "factorize-api-client";
import { Button, Input, Label, Page, Select, Textarea } from "../../shared/ui";
import { messageOf } from "../auth/session";
import { eventsQuery, triggerQuery } from "./queries";
type InputSource = components["schemas"]["TriggerInput"]["sources"][number];
export function TriggerEditor() {
  const params = useParams({ strict: false }), id = params.triggerId; const navigate = useNavigate(), cache = useQueryClient();
  const current = useQuery({ ...triggerQuery(id ?? ""), enabled: !!id }), events = useQuery(eventsQuery());
  const [name, setName] = useState(""), [eventId, setEventId] = useState(""), [kind, setKind] = useState<"manual" | "schedule" | "webhook">("manual"), [cron, setCron] = useState("0 * * * *"), [timezone, setTimezone] = useState("UTC"), [webhook, setWebhook] = useState('{"provider":"linear","projectId":"","matchRules":[]}');
  const [removeRetired, setRemoveRetired] = useState(false);
  const retiredSources = current.data?.sources.flatMap(source => source.kind === "webhook" && source.config.provider === "cloudflareTail" ? [{ id: source.id, integrationId: source.config.integrationId }] : []) ?? [];
  const [initialized, setInitialized] = useState(false);
  if (current.data && !initialized) { setName(current.data.name); setEventId(current.data.eventId ?? ""); const source = current.data.sources.find(source => source.kind !== "webhook" || source.config.provider !== "cloudflareTail"); if (source?.kind === "schedule") { setKind("schedule"); setCron(source.config.cron); setTimezone(source.config.timezone); } else if (source?.kind === "webhook") { setKind("webhook"); setWebhook(JSON.stringify(source.config, null, 2)); } setInitialized(true); }
  const inputSource: InputSource | undefined = kind === "manual" ? { kind, enabled: true, config: {} } : kind === "schedule" ? { kind, enabled: true, config: { cron, timezone } } : (() => { try { const config = JSON.parse(webhook); return { kind, enabled: true, config } as InputSource; } catch { return undefined; } })();
  const save = useMutation({ mutationFn: async () => {
    if (!inputSource) throw new Error("Webhook configuration must be valid JSON.");
    const retired = removeRetired ? [] : retiredSources.map(source => ({ id: source.id, kind: "webhook" as const, enabled: false,
      config: { provider: "cloudflareTail" as const, integrationId: source.integrationId } }));
    const body = { name, eventId, sources: [inputSource, ...retired] };
    const result = id ? await api.PUT("/api/v1/triggers/{triggerId}", { params: { path: { triggerId: id } }, body }) : await api.POST("/api/v1/triggers", { body });
    if (!result.data || result.error) throw new Error(messageOf(result.error)); return result.data;
  }, onSuccess: async trigger => { await Promise.all([cache.invalidateQueries({ queryKey: ["triggers"] }), cache.invalidateQueries({ queryKey: ["events"] })]); await navigate({ to: "/triggers/$triggerId", params: { triggerId: trigger.id } }); } });
  if (current.isPending && id) return <Page><p role="status">Loading Trigger…</p></Page>;
  if (current.error) return <Page><p role="alert">{current.error.message}</p></Page>;
  return <Page><header className="mb-6"><h1>{id ? "Edit Trigger" : "Create Trigger"}</h1><p className="mt-2 text-slate-600">A Trigger watches an input source and publishes an occurrence of its Event.</p></header><form className="grid max-w-2xl gap-4" onSubmit={event => { event.preventDefault(); save.mutate(); }}>
    <Label>Name<Input required value={name} onChange={e => setName(e.target.value)} /></Label>
    <Label>Event<Select required value={eventId} onChange={e => setEventId(e.target.value)}><option value="">Select an Event</option>{(events.data ?? []).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Label>
    <Label>Input source<Select value={kind} onChange={e => setKind(e.target.value as typeof kind)}><option value="manual">Manual</option><option value="schedule">Schedule</option><option value="webhook">Provider webhook</option></Select></Label>
    {retiredSources.length > 0 && <div><p>Cloudflare Tail is retired. These sources no longer deliver events.</p>
      <label><input type="checkbox" checked={removeRetired} onChange={e => setRemoveRetired(e.target.checked)} /> Remove retired Cloudflare Tail sources on save</label></div>}
    {kind === "schedule" && <><Label>Cron<Input required value={cron} onChange={e => setCron(e.target.value)} /></Label><Label>Timezone<Input required value={timezone} onChange={e => setTimezone(e.target.value)} /></Label></>}
    {kind === "webhook" && <Label>Provider configuration (JSON)<Textarea rows={8} value={webhook} onChange={e => setWebhook(e.target.value)} /></Label>}
    {events.error && <p role="alert">{events.error.message}</p>}{!events.data?.length && <p role="alert">Create an Event before adding a Trigger. <Link to="/events" className="underline">Open Events</Link>.</p>}
    <div className="flex gap-3"><Button variant="primary" disabled={save.isPending || !eventId || !events.data?.length}>{save.isPending ? "Saving…" : "Save Trigger"}</Button><Link to="/triggers" className="self-center underline">Cancel</Link></div>{save.error && <p role="alert">{save.error.message}</p>}
  </form></Page>;
}
