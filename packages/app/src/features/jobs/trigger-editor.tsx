import { TemplateField } from "./template-field";
import { Button, Input, Select, Label, Card } from "../../shared/ui";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import type { Event } from "./editor-state";
import { availabilityQuery } from "./editor-queries";
import { ProviderFields } from "./provider-fields";
import { LifecycleSelector } from "./lifecycle-selector";
import { messageOf } from "../auth/session";
const defaults: Record<Event["kind"], Event> = {
  manual: { kind: "manual", enabled: true, config: {} },
  schedule: { kind: "schedule", enabled: true, config: { cron: "0 * * * *", timezone: "UTC" } },
  triggerLifecycle: { kind: "triggerLifecycle", enabled: true, config: { sourceTriggerIds: [], states: ["succeeded"] } },
  triggerIdle: { kind: "triggerIdle", enabled: true, config: { sourceTriggerIds: [] } },
  webhook: { kind: "webhook", enabled: true, config: { provider: "linear", projectId: "", matchRules: [] } },
};
function ScheduleFields({ event, onChange }: { event: Extract<Event, { kind: "schedule" }>; onChange: (value: Event) => void }) {
  const preview = useMutation({ retry: false, mutationFn: async () => {
    const { data, error } = await api.POST("/api/v1/schedules/preview", { body: event.config });
    if (!data || error) throw new Error(messageOf(error)); return data;
  } });
  return <><Label>Cron <Input required value={event.config.cron} onChange={e => { preview.reset(); onChange({ ...event, config: { ...event.config, cron: e.target.value } }); }} /></Label>
    <Label>Timezone <Input required value={event.config.timezone} onChange={e => { preview.reset(); onChange({ ...event, config: { ...event.config, timezone: e.target.value } }); }} /></Label>
    <Button type="button" disabled={preview.isPending} onClick={() => preview.mutate()}>Preview schedule</Button>
    {preview.data && <p role="status">Next run: {preview.data.nextRunAt}</p>}{preview.error && <p role="alert">{preview.error.message}</p>}</>;
}
export function EventEditor({ events, onChange, onValidityChange,addLabel="Add event" }: { addLabel?:string; events: Event[]; onChange: (value: Event[]) => void; onValidityChange?: (invalid: boolean) => void }) {
  const availability = useQuery(availabilityQuery), [kind, setKind] = useState<Event["kind"]>("schedule");
  const replace = (index: number, value: Event) => onChange(events.map((item, i) => i === index ? value : item));
  return <Card>
    {availability.error && <p role="alert">{availability.error.message}</p>}
    {events.map((event, index) => <fieldset key={event.id ?? `new-${index}`} className="my-4 grid gap-3 border p-3"><legend>{event.slug ?? `New ${event.kind} event`}</legend>
      <Label><Input type="checkbox" checked={event.enabled} onChange={e => replace(index, { ...event, enabled: e.target.checked })} /> Enabled</Label>
      <TemplateField label="Event template" multiline local value={event.template ?? ""} onChange={template=>replace(index,{...event,template})} events={[event]} />
      <p className="text-sm">Optional Mustache text. Leave blank to contribute no Event data. Use <code>{"{{webhook}}"}</code> to include the full webhook object.</p>
      {event.kind === "schedule" && <ScheduleFields event={event} onChange={value => replace(index, value)} />}
      {event.kind === "webhook" && <ProviderFields config={event.config} onChange={config => replace(index, { ...event, config })} onValidityChange={onValidityChange} />}
      {event.kind === "triggerLifecycle" && <><LifecycleSelector selected={event.config.sourceTriggerIds} onChange={sourceTriggerIds => replace(index, { ...event, config: { ...event.config, sourceTriggerIds } })} />
        <fieldset><legend>Lifecycle states</legend>{(["succeeded", "failed", "stopped", "edited"] as const).map(state => <Label key={state}><Input type="checkbox" checked={event.config.states.includes(state)} onChange={e => replace(index, { ...event, config: { ...event.config, states: e.target.checked ? [...event.config.states, state] : event.config.states.filter(s => s !== state) } })} />{state} </Label>)}</fieldset></>}
      {event.kind === "triggerIdle" && <><LifecycleSelector selected={event.config.sourceTriggerIds} onChange={sourceTriggerIds => replace(index, { ...event, config: { ...event.config, sourceTriggerIds } })} /><p>Starts when the selected trigger has no queued or active runs.</p></>}
      {event.kind !== "manual" && <Button type="button" onClick={() => onChange(events.filter((_, i) => i !== index))}>Remove event</Button>}
    </fieldset>)}
    <Label>New event kind <Select value={kind} onChange={e => setKind(e.target.value as Event["kind"])}><option value="schedule">Schedule</option><option value="triggerLifecycle">Trigger lifecycle</option><option value="triggerIdle">All runs complete</option><option value="webhook">Provider webhook</option></Select></Label>
    <Button type="button" disabled={events.length >= 50} onClick={() => (() => { const used = new Set(events.map(t => t.slug)); let next = 1; while (used.has(`event-${next}`)) next++; onChange([...events, { ...structuredClone(defaults[kind]), slug: `event-${next}` }]); })()}>{addLabel}</Button>
  </Card>;
}
