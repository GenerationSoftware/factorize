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
  limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.string().min(1).optional(),
});
export const runIdSchema = z.object({ runId: z.string().min(1) });
export const listEventsSchema = z.object({
  flowId: z.string().min(1), limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.string().min(1).optional(),
});

const stringRecordSchema = z.record(z.string(), z.string());
export const triggerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("manual"), config: z.object({}).strict().default({}) }).strict(),
  z.object({ kind: z.literal("schedule"), config: z.object({
    cron: z.string().trim().min(1), timezone: z.string().trim().min(1),
    context: z.string().max(50_000).optional(), parameters: stringRecordSchema.default({}),
  }).strict() }).strict(),
  z.object({ kind: z.literal("webhook"), config: z.record(z.string(), z.unknown()) }).strict(),
]);
export const jobInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  promptTemplate: z.string().min(1).max(50_000),
  parameterDefaults: stringRecordSchema.default({}),
  concurrencyLimit: z.number().int().min(1).max(50).default(1),
  executionTargetId: z.string().min(1),
  trigger: triggerSchema,
}).strict().superRefine((value, ctx) => {
  if (Object.prototype.hasOwnProperty.call(value.parameterDefaults, "context")) ctx.addIssue({ code: "custom", path: ["parameterDefaults", "context"], message: "context is reserved" });
});
export const jobIdSchema = z.object({ jobId: z.string().min(1) });
export const manualInvocationSchema = z.object({
  context: z.string().max(50_000).optional(),
  parameters: stringRecordSchema.default({}),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
}).strict().superRefine((value, ctx) => {
  if (Object.prototype.hasOwnProperty.call(value.parameters, "context")) ctx.addIssue({ code: "custom", path: ["parameters", "context"], message: "context must use the reserved context field" });
});

export type FlowInput = z.infer<typeof flowInputSchema>;
export type JobInput = z.infer<typeof jobInputSchema>;
export type ManualInvocationInput = z.infer<typeof manualInvocationSchema>;
