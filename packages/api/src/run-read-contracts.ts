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
export const runSummaryResponse = z.object({
  id: z.string(), job_id: z.string(), issue_id: z.string(), issue_url: z.string().nullable(), issue_title: z.string(), run_name: z.string(), agent_name: z.string(), workspace_name: z.string(), agent_kind: z.string(), state: z.enum([...executionState.options, "done", "ignored"]), provider: z.string(), backend_kind: z.string(), capabilities: z.array(z.string()), destination_url: z.string().nullable(), artifact_state: z.enum(["pending", "collecting", "stored", "partial", "failed"]), artifact_error: z.string().nullable(), created_at: z.string(), updated_at: z.string(), started_at: z.string().nullable(),
});
export const runPageResponse = z.object({ items: z.array(runSummaryResponse), nextCursor: z.string().nullable() });
// Public JSON after serialization: enumerate known safe fields and keep opaque
// invocation/diagnostic content as unknown, never publish future row columns.
const record = z.record(z.string(), z.unknown());
const traceSource = z.object({ kind: z.enum(["execution_stream", "native_session"]), path: z.string(), mediaType: z.literal("application/x-ndjson"), provider: z.enum(["codex", "claude", "pi"]), formatVersion: z.string().optional(), cliVersion: z.string().optional(), harnessVersion: z.string().optional(), discoverCommand: z.string().optional() });
export const fullRunResponse = runSummaryResponse.extend({
  tenant_id: z.string(), invocation_id: z.string(),
  execution_handle: z.object({ backendKind: z.string(), id: z.string() }).nullable(),
  execution_backend_kind: z.string(), execution_capabilities: z.array(z.string()),
  claim_released: z.boolean(), vm_cleanup_attempt: z.number().int(), cleanup_next_at: z.string().nullable(), vm_cleanup_complete: z.boolean(),
  job_name: z.string(), prompt: z.string(), context: record, occurrence: record.nullable(),
  invocation: z.object({ id: z.string(), source: z.string(), claim_key: z.string(), trigger_id: z.string().nullable(), context: record, occurrence: record.nullable(), created_at: z.string() }),
  invocation_source: z.string(), invocation_claim_key: z.string(), invocation_trigger_id: z.string().nullable(), invocation_created_at: z.string(),
  activity: z.array(z.object({ action: z.string(), detail: z.string(), created_at: z.string() })),
  execution_diagnostics: record.nullable(), trace_sources: z.object({ primary: traceSource, nativeSession: traceSource.optional() }).nullable(), trace_projection: record.nullable(), trace_generation: z.string().nullable(), harness_log: record.nullable(),
});
