import { z } from "zod";
import { jobInputSchema, triggerSchema, webhookTriggerConfigSchema } from "./flow-schemas";

export const jobPageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.guid().optional(),
  q: z.string().trim().max(120).default(""),
  enabled: z.enum(["true", "false"]).optional(),
});
export type JobPageQuery = z.infer<typeof jobPageQuery>;
export const jobSelectorItem = z.object({ id: z.guid(), name: z.string(), slug: z.string(), enabled: z.boolean() });
export const jobSummary = jobSelectorItem.extend({
  model: z.string(), effort: z.string(), agentKind: z.string(),
  concurrencyLimit: z.number().int(), runningCount: z.number().int(),
  lastRunState: z.enum(["queued", "starting", "running", "blocked", "stopping", "succeeded", "failed", "stopped", "done", "ignored"]).nullable(), createdAt: z.string(), updatedAt: z.string(),
});
export const jobSummaryPage = z.object({ items: z.array(jobSummary), nextCursor: z.guid().nullable() });
export const jobSelectorPage = z.object({ items: z.array(jobSelectorItem), nextCursor: z.guid().nullable() });
const triggerIdentity = { id: z.guid(), jobId: z.guid(), slug: z.string(), createdAt: z.string(), updatedAt: z.string() };
const webhookResponse = z.discriminatedUnion("provider", [
  webhookTriggerConfigSchema.options[0].extend({ secretConfigured: z.boolean().optional() }).strip(),
  webhookTriggerConfigSchema.options[1].extend({ secretConfigured: z.boolean().optional() }).strip(),
  webhookTriggerConfigSchema.options[2].extend({ secretConfigured: z.boolean().optional() }).strip(),
  webhookTriggerConfigSchema.options[3].extend({ destination: z.string().optional(), secretConfigured: z.boolean().optional() }).strip(),
]);
export const triggerResponse = z.discriminatedUnion("kind", [
  triggerSchema.options[0].extend(triggerIdentity),
  triggerSchema.options[1].extend(triggerIdentity),
  triggerSchema.options[2].extend({ ...triggerIdentity, config: webhookResponse }),
  triggerSchema.options[3].extend(triggerIdentity),
]);
export const jobResponse = z.object({
  id: z.guid(), name: z.string(), slug: z.string(), enabled: z.boolean(),
  promptTemplate: z.string(), runNameTemplate: z.string(), model: z.string(), effort: z.string().optional(),
  executionTarget: z.object({ connectionId: z.string(), workspace: z.string().optional(), cwd: z.string().optional(), agentKind: z.string() }),
  executionTargetId: z.string(), agentKind: z.string(), concurrencyLimit: z.number().int(),
  runningCount: z.number().int(), currentRuns: z.number().int(), maxConcurrency: z.number().int(), lastRunState: z.enum(["queued", "starting", "running", "blocked", "stopping", "succeeded", "failed", "stopped", "done", "ignored"]).nullable(),
  triggers: z.array(triggerResponse),
  createdAt: z.string(), updatedAt: z.string(),
});
// Omission keeps legacy REST/MCP last-writer-wins behavior. New editors supply
// the timestamp returned by get_job; the repository checks it under row lock.
export const jobUpdateInput = jobInputSchema.extend({ expectedUpdatedAt: z.iso.datetime().optional() });
