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
  flowId: z.string().min(1).optional(), state: runStateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.string().min(1).optional(),
});
export const runIdSchema = z.object({ runId: z.string().min(1) });
export const listEventsSchema = z.object({
  flowId: z.string().min(1), limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.string().min(1).optional(),
});

export type FlowInput = z.infer<typeof flowInputSchema>;
