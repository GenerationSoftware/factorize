import type { components, operations } from "factorize-api-client";
export type JobInput = components["schemas"]["JobInput"];
export type Job = operations["get_api_v1_jobs_jobId"]["responses"][200]["content"]["application/json"];
export type Trigger = JobInput["triggers"][number];
export const emptyJob = (): JobInput => ({ name: "", slug: "", promptTemplate: "", runNameTemplate: "", executionConfigId: "", concurrencyLimit: 1, tags: [], vmImage: "", model: "", effort: "", skillIds: [], triggers: [{ kind: "manual", slug: "trigger-1", enabled: true, config: {} }] });
export function canonicalizeVmImage(value: string): string {
  const trimmed = value.trim(), digestAt = trimmed.indexOf("@"), reference = digestAt < 0 ? trimmed : trimmed.slice(0, digestAt), digest = digestAt < 0 ? "" : trimmed.slice(digestAt);
  const slash = reference.lastIndexOf("/"), colon = reference.lastIndexOf(":"), tag = colon > slash ? reference.slice(colon) : "", name = tag ? reference.slice(0, -tag.length) : reference;
  return `${name.toLowerCase()}${tag}${digest}`;
}
export function editableJob(job: Job): JobInput {
  return { projectId: job.projectId, name: job.name, slug: job.slug, promptTemplate: job.promptTemplate, runNameTemplate: job.runNameTemplate, executionConfigId: job.executionConfigId, concurrencyLimit: job.concurrencyLimit, tags: job.tags ?? [], vmImage: job.executionConfig?.image ?? "", model: job.model, effort: job.effort ?? "", skillIds: job.skills?.map(skill => skill.id) ?? [], triggers: job.triggers.map(trigger => {
    const { id, slug, kind, enabled } = trigger;
    const config = trigger.kind === "webhook" ? Object.fromEntries(Object.entries(trigger.config).filter(([key]) => !["destination", "secretConfigured"].includes(key))) : trigger.config;
    return { id, slug, kind, enabled, config } as Trigger;
  }) };
}
// Three-way reconciliation only merges fields changed on one side. Conflicting
// fields require an explicit choice; triggers are atomic to preserve identity.
export function reconcile(base: JobInput, local: JobInput, remote: JobInput) {
  const merged = { ...remote }, conflicts: (keyof JobInput)[] = [];
  for (const key of Object.keys(base) as (keyof JobInput)[]) {
    const changedHere = JSON.stringify(local[key]) !== JSON.stringify(base[key]);
    const changedThere = JSON.stringify(remote[key]) !== JSON.stringify(base[key]);
    if (changedHere && changedThere && JSON.stringify(local[key]) !== JSON.stringify(remote[key])) conflicts.push(key);
    else if (changedHere) Object.assign(merged, { [key]: local[key] });
  }
  return { merged, conflicts };
}

export function writeInput(draft: JobInput): JobInput {
  return { ...draft, triggers: draft.triggers.map(trigger => ({ ...trigger, slug: trigger.slug && /^trigger-[1-9][0-9]*$/.test(trigger.slug) ? trigger.slug : undefined })) };
}

export function validateJobInput(input: JobInput): string | undefined {
  if (!input.name.trim() || input.name.length > 120) return "Enter a job name between 1 and 120 characters.";
  if (!/^[a-z][a-z0-9_-]{0,29}$/.test(input.slug)) return "Slug must start with a lowercase letter and contain at most 30 characters.";
  if (!input.promptTemplate || input.promptTemplate.length > 50_000) return "Enter a prompt template between 1 and 50,000 characters.";
  if (!Number.isInteger(input.concurrencyLimit) || input.concurrencyLimit < 1 || input.concurrencyLimit > 50) return "Concurrency limit must be between 1 and 50.";
  if (!input.executionConfigId) return "Choose an execution integration.";
  if ((input.tags?.length ?? 0) > 20 || input.tags?.some(tag => !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(tag))) return "VM tags are invalid.";
  if (input.vmImage && !/^(?:[a-z0-9]+(?:[._-][a-z0-9]+)*\/)?[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,127})?(?:@sha256:[a-f0-9]{64})?$/.test(canonicalizeVmImage(input.vmImage))) return input.vmImage.trim().startsWith("https://") ? "Enter an image reference without a URL scheme." : "Enter a public Docker/OCI image reference.";
  if (input.triggers.length > 50) return "A job can have at most 50 triggers.";
  for (const trigger of input.triggers) {
    if (!trigger.slug || !/^trigger-[1-9][0-9]*$/.test(trigger.slug)) return "Each trigger needs a valid stable identifier.";
    if (trigger.kind === "schedule" && (!trigger.config.cron.trim() || !trigger.config.timezone.trim())) return "Schedule triggers require a cron expression and timezone.";
    if (trigger.kind === "jobLifecycle" && (!trigger.config.sourceJobIds.length || !trigger.config.states.length)) return "Lifecycle triggers require a source job and state.";
    if (trigger.kind === "jobIdle" && !trigger.config.sourceJobIds.length) return "All runs complete triggers require a source job.";
    if (trigger.kind === "webhook" && (trigger.config.provider === "linear" || trigger.config.provider === "clickup") && !trigger.config.matchRules?.length) return "Provider triggers require at least one matching rule.";
  }
  return undefined;
}
