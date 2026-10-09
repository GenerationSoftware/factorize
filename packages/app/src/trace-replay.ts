import { z } from "zod";
import { artifactKey } from "./artifacts";
import type { Env } from "./types";
import { databaseFor } from "./postgres/database";
import { ArtifactRepository } from "./postgres/artifact-repository";
import { TraceProjectionRepository, TRACE_PARSER_VERSION } from "./postgres/trace-projection-repository";
import { traceMetric } from "./trace-observability";

export const traceReplayRunIdSchema = z.uuid();
export const traceReplaySchema = z.object({ requestId: z.uuid(), source: z.enum(["primary", "native_session"]).default("primary") }).strict();
export class TraceReplayError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }

/** One run per request bounds work; clients checkpoint request IDs while paging runs.
 * Completed results and projection commit together; failed transactions can resume with the same ID.
 */
export async function replayTrace(env: Env, tenantId: string, actorId: string, runId: string, input: z.infer<typeof traceReplaySchema>) {
  const database = databaseFor(env);
  // Reserve persistent tenant budget separately so failing replays also consume capacity.
  await database.transaction(async client => {
    await client.query("INSERT INTO app.trace_replay_limits(tenant_id) VALUES ($1) ON CONFLICT DO NOTHING", [tenantId]);
    const allowed = await client.query(`UPDATE app.trace_replay_limits SET attempts=CASE WHEN window_start<=now()-interval '1 minute' THEN 1 ELSE attempts+1 END,
      window_start=CASE WHEN window_start<=now()-interval '1 minute' THEN now() ELSE window_start END
      WHERE tenant_id=$1 AND (window_start<=now()-interval '1 minute' OR attempts<10) RETURNING tenant_id`, [tenantId]);
    if (!allowed.rows.length) throw new TraceReplayError(429, "rate_limited", "Trace replay is limited to 10 requests per tenant per minute.");
  });
  try {
    const result = await database.transaction(async client => {
      // Tenant lock serializes request IDs even when clients retry against another run.
      await client.query("SELECT tenant_id FROM app.trace_replay_limits WHERE tenant_id=$1 FOR UPDATE", [tenantId]);
      const prior = (await client.query("SELECT run_id,source,result FROM app.trace_replay_operations WHERE tenant_id=$1 AND request_id=$2", [tenantId, input.requestId])).rows[0];
      if (prior) {
        if (prior.run_id !== runId || prior.source !== input.source) throw new TraceReplayError(409, "conflict", "Replay request ID was already used for another request.");
        return prior.result;
      }
      const run = (await client.query("SELECT state,trace_sources FROM app.runs WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [tenantId, runId])).rows[0];
      if (!run) throw new TraceReplayError(404, "not_found", "Run not found");
      let result: Record<string, unknown>;
      if (!["done", "succeeded", "failed", "stopped", "ignored"].includes(run.state)) {
        result = { status: "skipped", reason: "run_active" };
      } else {
        if (input.source === "native_session" && run.trace_sources?.primary?.provider === "codex" && run.trace_sources.primary.kind === "execution_stream") throw new TraceReplayError(400, "invalid_source", "Codex runs replay only their canonical execution stream.");
        const artifacts = await new ArtifactRepository(database, tenantId).list(runId, client);
        const kind = input.source === "native_session" ? "native_session" : run.trace_sources?.primary?.kind ?? "native_session";
        const eligible = artifacts.filter(item => item.kind === kind && item.state === "stored");
        // Never silently fall back or arbitrarily pick one of multiple native sessions.
        const artifact = eligible.length === 1 ? eligible[0] : null;
        if (!artifact) result = { status: "unrecoverable", reason: eligible.length > 1 ? "ambiguous_artifacts" : "missing_artifact", sourceKind: kind };
        else if (!["codex", "claude", "pi"].includes(artifact.provider) || artifact.format !== "jsonl") result = { status: "skipped", reason: "unsupported_artifact" };
        else {
          const prefix = artifactKey(tenantId, runId, "native/session.jsonl").slice(0, -"native/session.jsonl".length);
          if (!artifact.object_key.startsWith(prefix)) throw new TraceReplayError(409, "invalid_artifact", "Artifact ownership does not match the run.");
          if (!env.RUN_ARTIFACTS) throw new TraceReplayError(503, "storage_unavailable", "Artifact storage is unavailable.");
          const stored = await env.RUN_ARTIFACTS.get(artifact.object_key);
          if (!stored) result = { status: "unrecoverable", reason: "artifact_not_retained", sourceKind: kind };
          else {
            const checksum = stored.checksums.sha256;
            const hash = checksum ? [...new Uint8Array(checksum)].map(byte => byte.toString(16).padStart(2, "0")).join("") : null;
            if (hash !== artifact.sha256 || stored.size !== Number(artifact.byte_size)) throw new TraceReplayError(409, "invalid_artifact", "Retained artifact checksum or size does not match its receipt.");
            const projection = (await client.query("SELECT source_kind,artifact_sha256,parser_version FROM app.run_trace_projections WHERE tenant_id=$1 AND run_id=$2", [tenantId, runId])).rows[0];
            if (projection?.source_kind === kind && projection.artifact_sha256 === artifact.sha256 && projection.parser_version === TRACE_PARSER_VERSION) {
              await stored.body.cancel();
              result = { status: "already_projected", sourceKind: kind, sha256: artifact.sha256 };
            } else {
              const reconciliation = await new TraceProjectionRepository(database, tenantId).project(client, runId, { provider: artifact.provider as "codex" | "claude" | "pi", kind, sha256: artifact.sha256, byte_size: artifact.byte_size }, stored.body);
              result = { status: "projected", sourceKind: kind, sha256: artifact.sha256, parserVersion: TRACE_PARSER_VERSION, reconciliation };
            }
          }
        }
      }
      result = { requestId: input.requestId, runId, ...result };
      await client.query("INSERT INTO app.trace_replay_operations(tenant_id,request_id,run_id,source,actor_id,result) VALUES ($1,$2,$3,$4,$5,$6)", [tenantId, input.requestId, runId, input.source, actorId, result]);
      return result;
    });
    traceMetric("replay_outcome", tenantId, runId, { requestId: input.requestId, status: String(result.status), reason: result.reason ? String(result.reason) : null });
    return result;
  } catch (error) {
    traceMetric("replay_failure", tenantId, runId, { requestId: input.requestId, code: error instanceof TraceReplayError ? error.code : "projection_failed" });
    throw error;
  }
}
