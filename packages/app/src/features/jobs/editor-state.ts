import type { components, operations } from "factorize-api-client";
export type JobInput = components["schemas"]["JobInput"];
export type Job = operations["get_api_v1_jobs_jobId"]["responses"][200]["content"]["application/json"];
export type Trigger = JobInput["triggers"][number];
export const emptyJob = (): JobInput => ({ name: "", slug: "", promptTemplate: "", runNameTemplate: "", executionTargetId: "", concurrencyLimit: 1, model: "", effort: "", triggers: [{ kind: "manual", slug: "trigger-1", enabled: true, config: {} }] });
export function editableJob(job: Job): JobInput {
  return { name: job.name, slug: job.slug, promptTemplate: job.promptTemplate, runNameTemplate: job.runNameTemplate, executionTargetId: job.executionTargetId, concurrencyLimit: job.concurrencyLimit, model: job.model, effort: job.effort ?? "", triggers: job.triggers.map(trigger => {
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
