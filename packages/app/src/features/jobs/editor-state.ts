import { defaultRunScopes } from "./run-permissions";
import type { components, operations } from "factorize-api-client";
export type TriggerInput = components["schemas"]["TriggerInput"];
export type Trigger = operations["get_api_v1_triggers_triggerId"]["responses"][200]["content"]["application/json"];
export type Event = TriggerInput["events"][number];
export type TeamDefaults = operations["get_api_v1_team"]["responses"][200]["content"]["application/json"]["runDefaults"];
export const emptyTrigger = (defaults: TeamDefaults = {}): TriggerInput => {
  const {capacity: _capacity, allowedTriggerIds: _destinations, ...settings} = defaults;
  return { runScopes: [...defaultRunScopes], executionType: "agent", requiresVm:false, name: "", prompt: "", script: "", runNameTemplate: "", tags: [], vmImage: "", model: "", effort: "", ...settings, executionConfigId:settings.executionConfigId ?? "", concurrencyLimit:settings.concurrencyLimit ?? 1, events: [{ kind: "manual", slug: "event-1", enabled: true, config: {} }] };
};
export function canonicalizeVmImage(value: string): string {
  const trimmed = value.trim(), digestAt = trimmed.indexOf("@"), reference = digestAt < 0 ? trimmed : trimmed.slice(0, digestAt), digest = digestAt < 0 ? "" : trimmed.slice(digestAt);
  const slash = reference.lastIndexOf("/"), colon = reference.lastIndexOf(":"), tag = colon > slash ? reference.slice(colon) : "", name = tag ? reference.slice(0, -tag.length) : reference;
  return `${name.toLowerCase()}${tag}${digest}`;
}
export function editableTrigger(trigger: Trigger): TriggerInput {
  return { requiresVm:trigger.requiresVm,skillId:trigger.skillId, modelAccountId: trigger.modelAccountId, portableIntegrationIds: trigger.portableIntegrationIds, githubInstallationIds: trigger.githubInstallationIds, linearConnectionId: trigger.linearConnectionId, xConnectionIds: trigger.xConnectionIds ?? [], runScopes: trigger.runScopes ?? [...defaultRunScopes], executionType: trigger.executionType ?? "agent", name: trigger.name, prompt: trigger.prompt, script: trigger.script ?? "", runNameTemplate: trigger.runNameTemplate, executionConfigId: trigger.executionConfigId, concurrencyLimit: trigger.concurrencyLimit, tags: trigger.tags ?? [], vmImage: trigger.executionConfig?.image ?? "", model: trigger.model, effort: (["","minimal","low","medium","high","xhigh"] as const).find(value=>value===trigger.effort) ?? "", events: trigger.events.map(event => {
    const { id, slug, kind, enabled, template } = event;
    const config = event.kind === "webhook" ? Object.fromEntries(Object.entries(event.config).filter(([key]) => !["destination", "secretConfigured"].includes(key))) : event.config;
    return { id, slug, kind, enabled, config, template } as Event;
  }) };
}
// Three-way reconciliation only merges fields changed on one side. Conflicting
// fields require an explicit choice; events are atomic to preserve identity.
export function reconcile(base: TriggerInput, local: TriggerInput, remote: TriggerInput) {
  const merged = { ...remote }, conflicts: (keyof TriggerInput)[] = [];
  for (const key of Object.keys(base) as (keyof TriggerInput)[]) {
    const changedHere = JSON.stringify(local[key]) !== JSON.stringify(base[key]);
    const changedThere = JSON.stringify(remote[key]) !== JSON.stringify(base[key]);
    if (changedHere && changedThere && JSON.stringify(local[key]) !== JSON.stringify(remote[key])) conflicts.push(key);
    else if (changedHere) Object.assign(merged, { [key]: local[key] });
  }
  return { merged, conflicts };
}

export function writeInput(draft: TriggerInput): TriggerInput {
  return { ...draft,...(draft.requiresVm===false && draft.executionType!=="code"?{executionConfigId:undefined,vmImage:undefined,tags:[]}:{}), events: draft.events.map(event => ({ ...event, slug: event.slug && /^event-[1-9][0-9]*$/.test(event.slug) ? event.slug : undefined })) };
}

export function validateTriggerInput(input: TriggerInput): string | undefined {
  if (!/^(?=.{1,64}$)[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.name) || input.name === "manual") return "Use 1–64 lowercase letters, digits, and single hyphens. The name manual is reserved.";
  if ((input.prompt?.length ?? 0) > 50_000) return "Prompt must contain at most 50,000 characters.";
  if (input.executionType === "code" && (!input.script?.trim() || input.script.length > 50_000)) return "Enter a script between 1 and 50,000 characters.";
  if (input.concurrencyLimit !== undefined && (!Number.isInteger(input.concurrencyLimit) || input.concurrencyLimit < 1 || input.concurrencyLimit > 50)) return "Concurrency limit must be between 1 and 50.";
  if (input.executionConfigId === "fly-new") return "Save Fly VM settings before saving the trigger.";
  if ((input.requiresVm || input.executionType==="code") && !input.executionConfigId) return "Choose an execution integration.";
  if ((input.tags?.length ?? 0) > 20 || input.tags?.some(tag => !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(tag))) return "VM tags are invalid.";
  if (input.vmImage && !/^(?:[a-z0-9]+(?:[._-][a-z0-9]+)*\/)?[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,127})?(?:@sha256:[a-f0-9]{64})?$/.test(canonicalizeVmImage(input.vmImage))) return input.vmImage.trim().startsWith("https://") ? "Enter an image reference without a URL scheme." : "Enter a public Docker/OCI image reference.";
  if (input.events.length > 50) return "A trigger can have at most 50 events.";
  for (const event of input.events) {
    if (!event.slug || !/^event-[1-9][0-9]*$/.test(event.slug)) return "Each event needs a valid stable identifier.";
    if (event.kind === "schedule" && (!event.config.cron.trim() || !event.config.timezone.trim())) return "Schedule events require a cron expression and timezone.";
    if (event.kind === "triggerLifecycle" && (!event.config.sourceTriggerIds.length || !event.config.states.length)) return "Lifecycle events require a source trigger and state.";
    if (event.kind === "triggerIdle" && !event.config.sourceTriggerIds.length) return "All runs complete events require a source trigger.";
    if (event.kind === "webhook" && (event.config.provider === "linear" || event.config.provider === "clickup") && !event.config.matchRules?.length) return "Provider events require at least one matching rule.";
  }
  return undefined;
}

// A save acknowledges its submitted snapshot, not edits made while it was in flight.
export function applySavedTrigger(snapshot: TriggerInput, current: TriggerInput, saved: TriggerInput): TriggerInput {
  const merged = { ...saved };
  for (const key of Object.keys(current) as (keyof TriggerInput)[]) {
    if (JSON.stringify(current[key]) !== JSON.stringify(snapshot[key])) Object.assign(merged, { [key]: current[key] });
  }
  // New events acquire server IDs on their first save, even if edited meanwhile.
  merged.events = merged.events.map(event => {
    const accepted = saved.events.find(value => value.slug === event.slug);
    return !event.id && accepted?.id ? { ...event, id: accepted.id } : event;
  });
  return merged;
}
