import { z } from "zod";
export const executionState = z.enum(["queued", "starting", "running", "blocked", "stopping", "succeeded", "failed", "stopped"]);
export const runStatusResponse = z.object({
  id: z.string(), job_id: z.string(), state: executionState,
  run_name: z.string(), job_name: z.string(), destination_url: z.string().nullable(),
  created_at: z.string(), updated_at: z.string(), started_at: z.string().nullable(),
  artifact_state: z.enum(["pending", "collecting", "stored", "partial", "failed"]),
  finalizing: z.boolean(), trace_revision: z.string(),
});
export const traceEventResponse = z.object({
  sequence: z.number().int(), id: z.string(), parentId: z.string().optional(),
  type: z.enum(["user_message", "assistant_message", "reasoning", "tool_call", "tool_result", "command", "file_change", "compaction", "branch", "usage", "warning", "error", "metadata"]),
  role: z.string().optional(), title: z.string(), preview: z.string(), occurredAt: z.string().optional(), display: z.record(z.string(), z.unknown()),
});
export const revisionTraceQuery = z.object({ after: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(200).default(100), revision: z.string().max(1000).optional() }).refine(value => value.after === 0 || !!value.revision, { message: "A revision is required when continuing a trace page" });
export const revisionTracePage = z.object({ items: z.array(traceEventResponse), nextCursor: z.number().int().nullable(), revision: z.string(), reset: z.boolean() });
// A statement snapshot binds metadata and events, even during canonical replacement.
export const traceRevisionSql = "jsonb_build_array(c.generation,p.source_kind,p.artifact_sha256,p.parser_version,p.updated_at)::text";
