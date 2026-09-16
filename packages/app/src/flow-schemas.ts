import { z } from "zod";

export const scopeSchema = z.enum(["flows:read", "flows:write", "runs:read", "runs:write"]);
export const runStateSchema = z.enum(["queued", "starting", "running", "recovering", "done", "blocked", "failed", "ignored"]);
export const matchRuleSchema = z.object({
  type: z.enum(["owner", "creator", "status", "label", "assignee"]),
  targetId: z.string().min(1),
});
export const publicSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("linear"), projectId: z.string().min(1), matchRules: z.array(matchRuleSchema).min(1) }).strict(),
  z.object({ kind: z.literal("cloudflareTail"), handlerCode: z.string().max(16_384).optional() }).strict(),
]);
export const flowInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  flowId: z.string().trim().regex(/^[a-z0-9][a-z0-9-]*$/).optional(),
  source: publicSourceSchema,
  maxConcurrency: z.number().int().min(0).max(50).default(3),
  workspaceName: z.string().max(120).optional(),
  contextTemplate: z.string().max(50_000).optional(),
  cwd: z.string().max(1_000).optional(),
  exeConnectionId: z.string().min(1),
}).strict();
export const flowIdSchema = z.object({ flowId: z.string().min(1) });
export const listRunsSchema = z.object({
  jobId: z.string().min(1).optional(), state: runStateSchema.optional(),
  contextQuery: z.string().min(1).max(50_000).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.string().min(1).optional(),
});
export const runIdSchema = z.object({ runId: z.string().min(1) });
export const listEventsSchema = z.object({
  flowId: z.string().min(1), limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.string().min(1).optional(),
});

const webhookCommonSchema = z.object({ handlerCode: z.string().max(16_384).optional() });
export const webhookTriggerConfigSchema = z.discriminatedUnion("provider", [
  webhookCommonSchema.extend({ provider: z.literal("linear"), projectId: z.string().min(1), matchRules: z.array(matchRuleSchema).min(1) }).strict(),
  webhookCommonSchema.extend({ provider: z.literal("github"), installationId: z.number().int().positive(), repositoryId: z.number().int().positive(), event: z.string().min(1).default("pull_request"), action: z.string().min(1).default("dequeued") }).strict(),
  webhookCommonSchema.extend({ provider: z.literal("cloudflareTail"), signingSecret: z.string().min(16).optional(), handlerCode: z.string().max(16_384).optional() }).strict(),
  webhookCommonSchema.extend({ provider: z.literal("custom"), secret: z.string().min(16).optional() }).strict(),
]);
export const triggerSchema = z.discriminatedUnion("kind", [
  z.object({ id: z.string().min(1).optional(), slug: z.string().regex(/^trigger-[1-9][0-9]*$/).optional(), kind: z.literal("manual"), enabled: z.boolean().default(true), config: z.object({}).strict().default({}) }).strict(),
  z.object({ id: z.string().min(1).optional(), slug: z.string().regex(/^trigger-[1-9][0-9]*$/).optional(), kind: z.literal("schedule"), enabled: z.boolean().default(true), config: z.object({
    cron: z.string().trim().min(1), timezone: z.string().trim().min(1),
  }).strict() }).strict(),
  z.object({ id: z.string().min(1).optional(), slug: z.string().regex(/^trigger-[1-9][0-9]*$/).optional(), kind: z.literal("webhook"), enabled: z.boolean().default(true), config: webhookTriggerConfigSchema }).strict(),
  z.object({ id: z.string().min(1).optional(), slug: z.string().regex(/^trigger-[1-9][0-9]*$/).optional(), kind: z.literal("jobLifecycle"), enabled: z.boolean().default(true), config: z.object({
    sourceJobIds: z.array(z.string().min(1)).min(1), states: z.array(z.enum(["succeeded", "failed", "stopped"])).min(1),
  }).strict() }).strict(),
]);
export const jobInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  promptTemplate: z.string().min(1).max(50_000),
  concurrencyLimit: z.number().int().min(1).max(50).default(1),
  executionTargetId: z.string().min(1),
  triggers: z.array(triggerSchema).max(50).default([]),
}).strict();
export const jobIdSchema = z.object({ jobId: z.string().min(1) });
export const manualInvocationSchema = z.object({
  prompt: z.string().max(50_000).default(""),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
}).strict();
export const jobHandlerTestSchema = z.object({
  handlerCode: z.string().max(16_384), payload: z.record(z.string(), z.unknown()),
}).strict();

export type FlowInput = z.infer<typeof flowInputSchema>;
export type JobInput = z.infer<typeof jobInputSchema>;
export type ManualInvocationInput = z.infer<typeof manualInvocationSchema>;
