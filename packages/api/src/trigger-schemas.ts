import Mustache from "mustache";
import { z } from "zod";
import { ACCESS_SCOPES } from "./access-tokens";
import { resourceName } from "./resource-names";
import { conditionsSchema, preparedWebhookSchema } from "./webhook-conditions";

export const scopeSchema = z.enum(ACCESS_SCOPES);
export const matchRuleSchema = z.object({ type: z.enum(["owner", "creator", "status", "label", "assignee"]), targetId: z.string().min(1) });
const webhookCommonSchema = z.object({ conditions: conditionsSchema.optional() });
export const webhookSourceConfigSchema = z.discriminatedUnion("provider", [
  webhookCommonSchema.extend({ provider: z.literal("linear"), projectId: z.string().min(1), matchRules: z.array(matchRuleSchema).min(1) }).strict(),
  webhookCommonSchema.extend({ provider: z.literal("clickup"), listId: z.string().min(1), matchRules: z.array(matchRuleSchema).min(1) }).strict(),
  webhookCommonSchema.extend({ provider: z.literal("github"), installationId: z.number().int().positive(), repositoryId: z.number().int().positive(), event: z.string().min(1).optional(), action: z.string().min(1).optional(), matchRules: z.array(matchRuleSchema).min(1).optional() }).strict().refine(value => Boolean(value.matchRules?.length || (value.event && value.action)), { message: "GitHub events require issue matching rules or an event and action" }),
  webhookCommonSchema.extend({ provider: z.literal("cloudflareTail"), integrationId: z.string().min(1) }).strict(),
]);
const sourceTemplate = z.string().max(50_000).refine(value => { try { Mustache.parse(value); return true; } catch { return false; } }, "Enter a valid Mustache template.").optional();
export const triggerSourceSchema = z.discriminatedUnion("kind", [
  z.object({ id: z.string().min(1).optional(), slug: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/).optional(), kind: z.literal("manual"), template: sourceTemplate, enabled: z.boolean().default(true), config: z.object({}).strict().default({}) }).strict(),
  z.object({ id: z.string().min(1).optional(), slug: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/).optional(), kind: z.literal("schedule"), template: sourceTemplate, enabled: z.boolean().default(true), config: z.object({ cron: z.string().trim().min(1), timezone: z.string().trim().min(1) }).strict() }).strict(),
  z.object({ id: z.string().min(1).optional(), slug: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/).optional(), kind: z.literal("webhook"), template: sourceTemplate, enabled: z.boolean().default(true), config: webhookSourceConfigSchema }).strict(),
]);
const triggerSources = z.array(triggerSourceSchema).min(1).max(50);
export const triggerInputSchema = z.object({ name: resourceName, eventId: z.guid(), sources: triggerSources.default([{ kind: "manual", slug: "source-1", enabled: true, config: {} }]) }).strict();

// A previously discovered MCP tool catalog can still send the old "events"
// input. Validate both spellings identically, but keep REST's contract unchanged.
export const mcpTriggerInputSchema = triggerInputSchema.extend({
  sources: triggerSources.optional().describe("Input sources for the Trigger."),
  events: triggerSources.optional().describe("Deprecated MCP alias for sources; do not supply both."),
}).refine(({ sources, events }) => sources === undefined || events === undefined, {
  path: ["events"], message: "Specify either sources or events, not both.",
});

export function normalizeMcpTriggerInput({ events, sources, ...input }: z.infer<typeof mcpTriggerInputSchema>): TriggerInput {
  return triggerInputSchema.parse({ ...input, sources: sources ?? events });
}
export const triggerIdSchema = z.object({ triggerId: z.string().min(1) });
export const fireTriggerInputSchema = z.object({ data: z.record(z.string(), z.unknown()).default({}), idempotencyKey: z.string().trim().min(1).max(200).optional() }).strict();
export const triggerConditionsTestSchema = z.object({ conditions: conditionsSchema.optional(), webhook: preparedWebhookSchema }).strict();
export type TriggerInput = z.infer<typeof triggerInputSchema>;
export type FireTriggerInput = z.infer<typeof fireTriggerInputSchema>;
export const teamResponse = z.object({ id: z.guid(), name: z.string().nullable() });
