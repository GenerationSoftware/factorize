import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import type { Trigger } from "./editor-state";
import { availabilityQuery } from "./editor-queries";
import { ProviderFields } from "./provider-fields";
import { LifecycleSelector } from "./lifecycle-selector";
import { messageOf } from "../auth/session";
const defaults: Record<Trigger["kind"], Trigger> = {
  manual: { kind: "manual", enabled: true, config: {} },
  schedule: { kind: "schedule", enabled: true, config: { cron: "0 * * * *", timezone: "UTC" } },
  jobLifecycle: { kind: "jobLifecycle", enabled: true, config: { sourceJobIds: [], states: ["succeeded"] } },
  webhook: { kind: "webhook", enabled: true, config: { provider: "linear", projectId: "", matchRules: [] } },
};
function ScheduleFields({ trigger, onChange }: { trigger: Extract<Trigger, { kind: "schedule" }>; onChange: (value: Trigger) => void }) {
  const preview = useMutation({ retry: false, mutationFn: async () => {
    const { data, error } = await api.POST("/api/v1/schedules/preview", { body: trigger.config });
    if (!data || error) throw new Error(messageOf(error)); return data;
  } });
  return <><label>Cron <input required value={trigger.config.cron} onChange={e => { preview.reset(); onChange({ ...trigger, config: { ...trigger.config, cron: e.target.value } }); }} /></label>
    <label>Timezone <input required value={trigger.config.timezone} onChange={e => { preview.reset(); onChange({ ...trigger, config: { ...trigger.config, timezone: e.target.value } }); }} /></label>
    <button type="button" disabled={preview.isPending} onClick={() => preview.mutate()}>Preview schedule</button>
    {preview.data && <p role="status">Next run: {preview.data.nextRunAt}</p>}{preview.error && <p role="alert">{preview.error.message}</p>}</>;
}
export function TriggerEditor({ triggers, onChange }: { triggers: Trigger[]; onChange: (value: Trigger[]) => void }) {
  const availability = useQuery(availabilityQuery), [kind, setKind] = useState<Trigger["kind"]>("schedule");
  const replace = (index: number, value: Trigger) => onChange(triggers.map((item, i) => i === index ? value : item));
  return <section><h2 className="text-xl font-semibold">Triggers</h2>
    {availability.error && <p role="alert">{availability.error.message}</p>}
    {triggers.map((trigger, index) => <fieldset key={trigger.id ?? `new-${index}`} className="my-4 grid gap-3 border p-3"><legend>{trigger.slug ?? `New ${trigger.kind} trigger`}</legend>
      <label><input type="checkbox" checked={trigger.enabled} onChange={e => replace(index, { ...trigger, enabled: e.target.checked })} /> Enabled</label>
      {trigger.kind === "schedule" && <ScheduleFields trigger={trigger} onChange={value => replace(index, value)} />}
      {trigger.kind === "webhook" && <ProviderFields config={trigger.config} onChange={config => replace(index, { ...trigger, config })} />}
      {trigger.kind === "jobLifecycle" && <><LifecycleSelector selected={trigger.config.sourceJobIds} onChange={sourceJobIds => replace(index, { ...trigger, config: { ...trigger.config, sourceJobIds } })} />
        <fieldset><legend>Lifecycle states</legend>{(["succeeded", "failed", "stopped", "edited"] as const).map(state => <label key={state}><input type="checkbox" checked={trigger.config.states.includes(state)} onChange={e => replace(index, { ...trigger, config: { ...trigger.config, states: e.target.checked ? [...trigger.config.states, state] : trigger.config.states.filter(s => s !== state) } })} />{state} </label>)}</fieldset></>}
      {trigger.kind !== "manual" && <button type="button" onClick={() => onChange(triggers.filter((_, i) => i !== index))}>Remove trigger</button>}
    </fieldset>)}
    <label>New trigger kind <select value={kind} onChange={e => setKind(e.target.value as Trigger["kind"])}><option value="schedule">Schedule</option><option value="jobLifecycle">Job lifecycle</option><option value="webhook">Provider webhook</option></select></label>
    <button type="button" disabled={triggers.length >= 50} onClick={() => (() => { const used = new Set(triggers.map(t => t.slug)); let next = 1; while (used.has(`trigger-${next}`)) next++; onChange([...triggers, { ...structuredClone(defaults[kind]), slug: `trigger-${next}` }]); })()}>Add trigger</button>
  </section>;
}
