import { z } from "zod";
import { triggerInputSchema, scopeSchema, eventSchema, webhookEventConfigSchema } from "./flow-schemas";

export const triggerPageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().max(512).optional(),
  q: z.string().trim().max(120).default(""),
  enabled: z.enum(["true", "false"]).optional(),
  sort: z.enum(["id", "updated", "active", "running", "title"]).optional(),
  direction: z.enum(["asc", "desc"]).optional(),
}).superRefine((query, context) => {
  if (!query.cursor) return;
  const legacySort = query.sort === undefined || query.sort === "id" || query.sort === "updated";
  if (z.guid().safeParse(query.cursor).success !== legacySort) {
    context.addIssue({ code: "custom", path: ["cursor"], message: "Cursor format does not match the selected sort" });
  }
});
export type TriggerPageQuery = z.infer<typeof triggerPageQuery>;
export const triggerSelectorItem = z.object({ id: z.guid(), name: z.string(), enabled: z.boolean() });
export const triggerSummary = triggerSelectorItem.extend({
  model: z.string(), effort: z.string(), agentKind: z.string(), executionType: z.enum(["agent", "code"]),
  concurrencyLimit: z.number().int(), runningCount: z.number().int(),
  lastRunState: z.enum(["queued", "reserved", "starting", "running", "blocked", "stopping", "succeeded", "failed", "stopped", "done", "ignored"]).nullable(), createdAt: z.string(), updatedAt: z.string(),
});
export const triggerSummaryPage = z.object({ items: z.array(triggerSummary), nextCursor: z.string().nullable() });
export const triggerSelectorPage = z.object({ items: z.array(triggerSelectorItem), nextCursor: z.string().nullable() });
const eventIdentity = { id: z.guid(), triggerId: z.guid(), slug: z.string(), createdAt: z.string(), updatedAt: z.string() };
const webhookResponse = z.discriminatedUnion("provider", [
  webhookEventConfigSchema.options[0].extend({ secretConfigured: z.boolean().optional() }).strip(),
  webhookEventConfigSchema.options[1].extend({ secretConfigured: z.boolean().optional() }).strip(),
  webhookEventConfigSchema.options[2].extend({ secretConfigured: z.boolean().optional() }).strip(),
  webhookEventConfigSchema.options[3].extend({ destination: z.string().optional(), secretConfigured: z.boolean().optional() }).strip(),
]);
export const eventResponse = z.discriminatedUnion("kind", [
  eventSchema.options[0].extend(eventIdentity),
  eventSchema.options[1].extend(eventIdentity),
  eventSchema.options[2].extend({ ...eventIdentity, config: webhookResponse }),
  eventSchema.options[3].extend(eventIdentity),
  eventSchema.options[4].extend(eventIdentity),
]);
export const triggerResponse = z.object({
  id: z.guid(), name: z.string(), enabled: z.boolean(),
  requiresVm:z.boolean(),
  executionType: z.enum(["agent", "code"]).optional(), prompt: z.string(), script: z.string().optional(), runNameTemplate: z.string(), tags: z.array(z.string()).optional(), model: z.string(), effort: z.string().optional(),
  executionConfig: z.object({ connectionId: z.string(), requiresVm:z.boolean().optional(), workspace: z.string().optional(), cwd: z.string().optional(), agentKind: z.string(), image: z.string().optional(), region: z.string().optional(), size: z.string().optional(), executionType: z.enum(["agent", "code"]).optional(), script: z.string().optional() }),
  runScopes: z.array(scopeSchema),
  portableIntegrationIds: z.array(z.guid()).optional(), modelAccountId: z.guid().optional(),
  githubInstallationIds: z.array(z.number().int().positive()).optional(), linearConnectionId: z.literal("linear").nullable().optional(),
  xConnectionIds: z.array(z.guid()).optional(),
  skillId: z.guid().nullable().optional(),
  executionConfigId: z.string(), agentKind: z.string(), concurrencyLimit: z.number().int(),
  runningCount: z.number().int(), currentRuns: z.number().int(), maxConcurrency: z.number().int(), lastRunState: z.enum(["queued", "reserved", "starting", "running", "blocked", "stopping", "succeeded", "failed", "stopped", "done", "ignored"]).nullable(),
  events: z.array(eventResponse),
  skill: z.object({id:z.guid(),key:z.string(),revision:z.number().int().positive()}).nullable().optional(),
  contextReviewRequired:z.boolean().optional(),
  createdAt: z.string(), updatedAt: z.string(),
});
// Omission keeps legacy REST/MCP last-writer-wins behavior. New editors supply
// the timestamp returned by get_trigger; the repository checks it under row lock.
export const triggerUpdateInput = triggerInputSchema.extend({ expectedUpdatedAt: z.iso.datetime().optional() });
