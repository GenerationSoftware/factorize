import { traceRevisionSql } from "../run-read-contracts";
import type { TraceSource } from "../trace-source";
import { consumeTraceStream, type TraceEvent } from "../trace";
import type { Database, DatabaseClient } from "./database";

import { traceCounts, traceMetric } from "../trace-observability";

export interface TracePage { items: TraceEvent[]; nextCursor: number | null; }

interface TraceRow {
  sequence: string | number;
  id: string;
  parent_id: string | null;
  event_type: TraceEvent["type"];
  role: string | null;
  title: string;
  preview_text: string;
  display_data: Record<string, unknown>;
  occurred_at: Date | null;
}

const mapped = (row: TraceRow): TraceEvent => ({
  sequence: Number(row.sequence), id: row.id, ...(row.parent_id ? { parentId: row.parent_id } : {}), type: row.event_type,
  ...(row.role ? { role: row.role } : {}), title: row.title, preview: row.preview_text,
  ...(row.occurred_at ? { occurredAt: row.occurred_at.toISOString() } : {}), display: row.display_data,
});

/** Tenant-scoped projection repository used by the run page; it never reads object storage. */
export class TraceRepository {
  constructor(private database: Database, private tenantId: string) {
    if (!tenantId) throw new Error("tenantId is required");
  }

  async replace(runId: string, events: TraceEvent[]): Promise<void> {
    await this.database.transaction(async client => {
      await client.query("DELETE FROM app.run_trace_events WHERE tenant_id=$1 AND run_id=$2", [this.tenantId, runId]);
      for (let offset = 0; offset < events.length; offset += 250) await this.insertBatch(client, runId, events.slice(offset, offset + 250));
    });
  }

  async replaceStream(runId: string, provider: "codex" | "claude" | "pi", stream: ReadableStream<Uint8Array>, sourceKind: TraceSource["kind"] = "native_session", client?: DatabaseClient): Promise<number> {
    const project = async (client: DatabaseClient) => {
      await client.query("DELETE FROM app.run_trace_events WHERE tenant_id=$1 AND run_id=$2", [this.tenantId, runId]);
      return consumeTraceStream(provider, stream, async items => {
        traceMetric("artifact_parsed", this.tenantId, runId, { ...traceCounts(items), provider, sourceKind });
        await this.insertBatch(client, runId, items);
      }, 250, sourceKind);
    };
    return client ? project(client) : this.database.transaction(project);
  }

  private async insertBatch(client: DatabaseClient, runId: string, items: TraceEvent[]): Promise<void> {
    if (!items.length) return;
    await client.query(`INSERT INTO app.run_trace_events(tenant_id,run_id,sequence,id,parent_id,event_type,role,title,preview_text,display_data,occurred_at)
      SELECT $1,$2,x.sequence,x.id,x.parent_id,x.event_type,x.role,x.title,x.preview_text,x.display_data,x.occurred_at
      FROM jsonb_to_recordset($3::jsonb) AS x(sequence bigint,id text,parent_id text,event_type text,role text,title text,preview_text text,display_data jsonb,occurred_at timestamptz)`, [this.tenantId, runId, JSON.stringify(items.map(item => ({ sequence: item.sequence, id: item.id, parent_id: item.parentId ?? null, event_type: item.type, role: item.role ?? null, title: item.title, preview_text: item.preview, display_data: item.display, occurred_at: item.occurredAt ?? null })))]);
  }

  async revisionPage(runId: string, after: number, limit: number, expectedRevision?: string) {
    const result = await this.database.pool.query<{ revision: string; reset: boolean; events: TraceRow[] }>(`
      WITH meta AS (
        SELECT ${traceRevisionSql} revision FROM app.runs r
        LEFT JOIN app.run_trace_cursors c ON c.tenant_id=r.tenant_id AND c.run_id=r.id
        LEFT JOIN app.run_trace_projections p ON p.tenant_id=r.tenant_id AND p.run_id=r.id
        WHERE r.tenant_id=$1 AND r.id=$2
      ), bound AS (SELECT revision,($5::text IS NOT NULL AND revision<>$5) reset FROM meta)
      SELECT revision,reset,coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.sequence) FROM (
        SELECT sequence,id,parent_id,event_type,role,title,preview_text,display_data,occurred_at
        FROM app.run_trace_events WHERE tenant_id=$1 AND run_id=$2 AND sequence>CASE WHEN reset THEN 0 ELSE $3 END
        ORDER BY sequence LIMIT $4
      ) e),'[]'::jsonb) events FROM bound`, [this.tenantId, runId, after, limit + 1, expectedRevision ?? null]);
    const row = result.rows[0];
    if (!row) return null;
    const events = row.events.slice(0, limit).map(event => mapped({ ...event, occurred_at: event.occurred_at ? new Date(event.occurred_at) : null }));
    return { items: events, revision: row.revision, reset: row.reset, nextCursor: row.events.length > limit ? events.at(-1)!.sequence : null };
  }
  async page(runId: string, after = 0, limit = 100): Promise<TracePage> {
    const size = Math.max(1, Math.min(200, Math.trunc(limit)));
    const result = await this.database.pool.query<TraceRow>(`SELECT sequence,id,parent_id,event_type,role,title,preview_text,display_data,occurred_at
      FROM app.run_trace_events WHERE tenant_id=$1 AND run_id=$2 AND sequence>$3 ORDER BY sequence LIMIT $4`, [this.tenantId, runId, Math.max(0, Math.trunc(after)), size + 1]);
    const rows = result.rows.slice(0, size), hasMore = result.rows.length > size;
    return { items: rows.map(mapped), nextCursor: hasMore && rows.length ? Number(rows.at(-1)!.sequence) : null };
  }
}
