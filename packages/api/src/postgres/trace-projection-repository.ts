import type { Database, DatabaseClient } from "./database";
import type { TraceSource } from "../trace-source";
import { TraceRepository } from "./trace-repository";
import { traceMetric } from "../trace-observability";

export const TRACE_PARSER_VERSION = "trace-v3-canonical-codex";
export class TraceProjectionRepository {
  constructor(private database: Database, private tenantId: string) { if (!tenantId) throw new Error("tenantId is required"); }

  async diagnostics(runId: string) {
    const [projection, cursor, counts, replay] = await Promise.all([
      this.database.pool.query("SELECT source_kind,artifact_sha256,parser_version,reconciliation,updated_at FROM app.run_trace_projections WHERE tenant_id=$1 AND run_id=$2", [this.tenantId, runId]),
      this.database.pool.query("SELECT generation,committed_offset,octet_length(pending_bytes) pending_bytes,updated_at FROM app.run_trace_cursors WHERE tenant_id=$1 AND run_id=$2", [this.tenantId, runId]),
      this.database.pool.query(`SELECT count(*)::int events,count(*) FILTER (WHERE event_type='warning')::int parse_warnings,
        count(*) FILTER (WHERE title LIKE 'Unknown Codex%' OR title LIKE 'Unknown Claude%' OR title LIKE 'Unknown entry:%' OR title LIKE 'Unknown message role:%')::int unknown_events FROM app.run_trace_events WHERE tenant_id=$1 AND run_id=$2`, [this.tenantId, runId]),
      this.database.pool.query("SELECT request_id,source,result,created_at FROM app.trace_replay_operations WHERE tenant_id=$1 AND run_id=$2 ORDER BY created_at DESC LIMIT 1", [this.tenantId, runId]),
    ]);
    const totals = counts.rows[0] ?? { events: 0, parse_warnings: 0, unknown_events: 0 };
    return { projection: projection.rows[0] ?? null, liveCursor: cursor.rows[0] ?? null, counts: { ...totals, unknownEventRate: totals.events ? totals.unknown_events / totals.events : 0 }, lastReplay: replay.rows[0] ?? null };
  }

  /** Caller holds the tenant/run lock. Compare the live prefix before atomically replacing it. */
  async project(client: DatabaseClient, runId: string, artifact: { provider: "codex" | "claude" | "pi"; kind: TraceSource["kind"]; sha256: string; byte_size: number | string }, stream: ReadableStream<Uint8Array>, reconcile = false) {
    if (reconcile) await client.query("CREATE TEMP TABLE trace_before ON COMMIT DROP AS SELECT sequence,id,parent_id,event_type,role,title,preview_text,display_data,occurred_at FROM app.run_trace_events WHERE tenant_id=$1 AND run_id=$2", [this.tenantId, runId]);
    const events = await new TraceRepository(this.database, this.tenantId).replaceStream(runId, artifact.provider, stream, artifact.kind, client);
    let reconciliation: Record<string, unknown> = { state: "reprojected", events };
    if (reconcile) {
      const comparison = (await client.query(`SELECT (SELECT count(*) FROM trace_before)::int live_events,
        (SELECT count(*) FROM (SELECT * FROM trace_before EXCEPT SELECT sequence,id,parent_id,event_type,role,title,preview_text,display_data,occurred_at FROM app.run_trace_events WHERE tenant_id=$1 AND run_id=$2) missing)::int mismatches,
        (SELECT generation FROM app.run_trace_cursors WHERE tenant_id=$1 AND run_id=$2) generation,
        (SELECT committed_offset FROM app.run_trace_cursors WHERE tenant_id=$1 AND run_id=$2) live_offset`, [this.tenantId, runId])).rows[0] ?? { live_events: 0, mismatches: 0, live_offset: null };
      const mismatch = comparison.mismatches > 0 || Number(comparison.live_offset ?? 0) > Number(artifact.byte_size);
      reconciliation = { state: comparison.live_offset == null ? "no_live_cursor" : mismatch ? "mismatch" : "matched", events, liveEvents: comparison.live_events, mismatches: comparison.mismatches, liveOffset: comparison.live_offset == null ? null : Number(comparison.live_offset), artifactBytes: Number(artifact.byte_size), generation: comparison.generation ?? null };
      traceMetric("terminal_reconciliation", this.tenantId, runId, { mismatch, events, mismatches: comparison.mismatches });
    }
    if (artifact.provider === "codex" && artifact.kind === "execution_stream") {
      const completed = (await client.query("SELECT count(*)::int completed FROM app.run_trace_events WHERE tenant_id=$1 AND run_id=$2 AND display_data->>'eventType'='turn.completed'", [this.tenantId, runId])).rows[0]?.completed ?? 0;
      reconciliation.codexCompletion = completed ? "turn.completed" : "missing_turn_completed";
    }
    await client.query(`INSERT INTO app.run_trace_projections(tenant_id,run_id,source_kind,artifact_sha256,parser_version,reconciliation)
      VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (tenant_id,run_id) DO UPDATE SET source_kind=excluded.source_kind,artifact_sha256=excluded.artifact_sha256,parser_version=excluded.parser_version,reconciliation=excluded.reconciliation,updated_at=now()`, [this.tenantId, runId, artifact.kind, artifact.sha256, TRACE_PARSER_VERSION, reconciliation]);
    return reconciliation;
  }
}
