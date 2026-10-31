import { z } from "zod";
import { conditionsSchema, preparedWebhookSchema } from "./webhook-conditions";

export const scopeSchema = z.enum(["projects:read", "projects:write", "jobs:read", "jobs:write", "runs:read", "runs:invoke", "runs:cancel", "runs:write", "integrations:read", "integrations:write", "skills:read", "skills:write"]);
export const runStateSchema = z.enum(["queued", "reserved", "starting", "running", "done", "blocked", "failed", "ignored", "succeeded", "stopping", "stopped"]);
export const matchRuleSchema = z.object({
  type: z.enum(["owner", "creator", "status", "label", "assignee"]),
  targetId: z.string().min(1),
});
export const listRunsSchema = z.object({
  projectId: z.union([z.guid(), z.array(z.guid()).min(1).max(100)]).optional(), jobId: z.union([z.guid(), z.array(z.guid()).min(1).max(100)]).optional(), state: z.union([runStateSchema, z.array(runStateSchema).min(1).max(10)]).optional(),
  contextQuery: z.string().min(1).max(50_000).optional(),
  sort: z.enum(["job", "run", "status", "created", "agent"]).optional(),
  direction: z.enum(["asc", "desc"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.string().min(1).optional(),
}).refine(value => !value.direction || value.sort, { message: "direction requires sort" });
export const runIdSchema = z.object({ runId: z.string().min(1) });
export const renameRunSchema = z.object({ name: z.string().trim().min(1).max(120), expectedName: z.string().max(120).optional() }).strict();
export const reportRunErrorSchema = z.object({ reason: z.string().trim().min(1).max(2000) }).strict();
export const reportRunErrorResponse = z.object({ reported: z.literal(true), reason: z.string(), retry: z.boolean() });

const webhookCommonSchema = z.object({ conditions: conditionsSchema.optional() });
export const webhookTriggerConfigSchema = z.discriminatedUnion("provider", [
  webhookCommonSchema.extend({ provider: z.literal("linear"), projectId: z.string().min(1), matchRules: z.array(matchRuleSchema).min(1) }).strict(),
  webhookCommonSchema.extend({ provider: z.literal("clickup"), listId: z.string().min(1), matchRules: z.array(matchRuleSchema).min(1) }).strict(),
  webhookCommonSchema.extend({ provider: z.literal("github"), installationId: z.number().int().positive(), repositoryId: z.number().int().positive(), event: z.string().min(1).optional(), action: z.string().min(1).optional(), matchRules: z.array(matchRuleSchema).min(1).optional() }).strict().refine(value => Boolean(value.matchRules?.length || (value.event && value.action)), { message: "GitHub triggers require issue matching rules or an event and action" }),
  webhookCommonSchema.extend({ provider: z.literal("cloudflareTail"), integrationId: z.string().min(1) }).strict(),
]);
export const triggerSchema = z.discriminatedUnion("kind", [
  z.object({ id: z.string().min(1).optional(), slug: z.string().regex(/^trigger-[1-9][0-9]*$/).optional(), kind: z.literal("manual"), enabled: z.boolean().default(true), config: z.object({}).strict().default({}) }).strict(),
  z.object({ id: z.string().min(1).optional(), slug: z.string().regex(/^trigger-[1-9][0-9]*$/).optional(), kind: z.literal("schedule"), enabled: z.boolean().default(true), config: z.object({
    cron: z.string().trim().min(1), timezone: z.string().trim().min(1),
  }).strict() }).strict(),
  z.object({ id: z.string().min(1).optional(), slug: z.string().regex(/^trigger-[1-9][0-9]*$/).optional(), kind: z.literal("webhook"), enabled: z.boolean().default(true), config: webhookTriggerConfigSchema }).strict(),
  z.object({ id: z.string().min(1).optional(), slug: z.string().regex(/^trigger-[1-9][0-9]*$/).optional(), kind: z.literal("jobLifecycle"), enabled: z.boolean().default(true), config: z.object({
    sourceJobIds: z.array(z.string().min(1)).min(1), states: z.array(z.enum(["succeeded", "failed", "stopped", "edited"])).min(1),
  }).strict() }).strict(),
  z.object({ id: z.string().min(1).optional(), slug: z.string().regex(/^trigger-[1-9][0-9]*$/).optional(), kind: z.literal("jobIdle"), enabled: z.boolean().default(true), config: z.object({ sourceJobIds: z.array(z.string().min(1)).min(1) }).strict() }).strict(),
]);

/** Lower registry and repository names while keeping the case-sensitive tag. */
export function canonicalizeVmImage(value: string): string {
  const trimmed = value.trim();
  const digestAt = trimmed.indexOf("@");
  const reference = digestAt < 0 ? trimmed : trimmed.slice(0, digestAt);
  const digest = digestAt < 0 ? "" : trimmed.slice(digestAt);
  const slash = reference.lastIndexOf("/");
  const colon = reference.lastIndexOf(":");
  const tag = colon > slash ? reference.slice(colon) : "";
  const name = tag ? reference.slice(0, -tag.length) : reference;
  return `${name.toLowerCase()}${tag}${digest}`;
}

const imageReferencePattern = String.raw`(?:(?:[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*\/)?[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*(?:\/[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*)*(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,127})?(?:@sha256:[a-f0-9]{64})?)`;
const publicVmImage = (allowBlank: boolean) => (allowBlank ? z.string().trim().max(512) : z.string().trim().min(1).max(512))
  .regex(new RegExp(allowBlank ? `^(?:${imageReferencePattern})?$` : `^${imageReferencePattern}$`),
    "Enter a public Docker/OCI image reference without a URL scheme (for example, ghcr.io/owner/image:tag).")
  .transform(canonicalizeVmImage);
export const jobInputSchema = z.object({
  projectId: z.guid().optional(),
  name: z.string().trim().min(1).max(120),
  slug: z.string().regex(/^[a-z][a-z0-9_-]{0,29}$/),
  promptTemplate: z.string().min(1).max(50_000),
  runNameTemplate: z.string().max(500).optional(),
  concurrencyLimit: z.number().int().min(1).max(50).default(1),
  executionConfigId: z.string().min(1),
  tags: z.array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/)).max(20).optional(),
  vmImage: publicVmImage(true).optional(),
  model: z.string().trim().max(120).optional(),
  effort: z.string().trim().max(40).optional(),
  triggers: z.array(triggerSchema).max(50).default([]),
  skillIds: z.array(z.guid()).max(50).optional(),
}).strict();
export const vmImageVerificationInput = z.object({
  connectionId: z.string().min(1).max(200),
  image: publicVmImage(false),
  tags: z.array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/)).max(20),
  agentKind: z.enum(["codex", "claude", "pi"]),
}).strict();
export const vmImageVerificationResponse = z.object({ id: z.guid(), status: z.enum(["queued", "creating", "checking_ssh", "checking_agent", "cleaning_up", "succeeded", "failed", "cleanup_failed"]), phase: z.string(), errorKind: z.string().nullable(), error: z.string().nullable(), createdAt: z.string(), updatedAt: z.string() });
export const jobIdSchema = z.object({ jobId: z.string().min(1) });
export const manualInvocationSchema = z.object({
  prompt: z.string().max(50_000).default(""),
  data: z.record(z.string(), z.unknown()).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  idempotencyKey: z.string().trim().min(1).max(200).regex(/^(?!manual:)/, {
    message: "idempotencyKey must not include the reserved manual: claim-key prefix",
  }).optional(),
}).strict();
export const jobConditionsTestSchema = z.object({
  conditions: conditionsSchema.optional(), webhook: preparedWebhookSchema,
}).strict();

export type JobInput = z.infer<typeof jobInputSchema>;
export type ManualInvocationInput = z.infer<typeof manualInvocationSchema>;
