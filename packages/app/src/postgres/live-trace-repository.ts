import { parseTrace, type TraceEvent } from "../trace";
import type { Database, DatabaseClient } from "./database";

const ZERO_HASH = "0".repeat(64);
const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, "0")).join("");
const sha256 = async (bytes: Uint8Array | string) => { const value = typeof bytes === "string" ? encoder.encode(bytes) : new Uint8Array(bytes); return hex(await crypto.subtle.digest("SHA-256", value.buffer)); };

export interface LiveTraceCursor { generation: string | null; offset: number; rollingHash: string; }
export interface TraceChunk { generation: string; expectedGeneration: string | null; startOffset: number; chunkSha256: string; previousHash: string; bytes: Uint8Array; }

interface CursorRow { generation: string; committed_offset: string | number; pending_bytes: Uint8Array; next_sequence: string | number; rolling_hash: string; }

export class LiveTraceRepository {
  constructor(private database: Database, private tenantId: string) { if (!tenantId) throw new Error("tenantId is required"); }

  async cursor(runId: string): Promise<LiveTraceCursor> {
    const row = (await this.database.pool.query<CursorRow>("SELECT generation,committed_offset,pending_bytes,next_sequence,rolling_hash FROM app.run_trace_cursors WHERE tenant_id=$1 AND run_id=$2", [this.tenantId, runId])).rows[0];
    return row ? { generation: row.generation, offset: Number(row.committed_offset), rollingHash: row.rolling_hash } : { generation: null, offset: 0, rollingHash: ZERO_HASH };
  }

  async append(runId: string, provider: "codex" | "claude" | "pi", chunk: TraceChunk) {
    if (!chunk.generation || chunk.generation.length > 200 || !Number.isSafeInteger(chunk.startOffset) || chunk.startOffset < 0) throw new Error("Invalid trace chunk metadata");
    const actualHash = await sha256(chunk.bytes);
    if (actualHash !== chunk.chunkSha256) throw new Error("Trace chunk checksum mismatch");
    return this.database.transaction(async client => {
      let cursor = (await client.query<CursorRow>("SELECT generation,committed_offset,pending_bytes,next_sequence,rolling_hash FROM app.run_trace_cursors WHERE tenant_id=$1 AND run_id=$2 FOR UPDATE", [this.tenantId, runId])).rows[0];
      if (!cursor || cursor.generation !== chunk.generation) {
        if (chunk.startOffset !== 0) throw new Error("Trace generation changed; restart at offset zero");
        if ((cursor?.generation ?? null) !== chunk.expectedGeneration) throw new Error("Stale trace generation transition");
        await client.query("DELETE FROM app.run_trace_events WHERE tenant_id=$1 AND run_id=$2", [this.tenantId, runId]);
        await client.query("DELETE FROM app.run_trace_chunks WHERE tenant_id=$1 AND run_id=$2", [this.tenantId, runId]);
        await client.query(`INSERT INTO app.run_trace_cursors(tenant_id,run_id,generation,committed_offset,pending_bytes,next_sequence,rolling_hash)
          VALUES ($1,$2,$3,0,''::bytea,1,$4) ON CONFLICT (tenant_id,run_id) DO UPDATE SET generation=excluded.generation,committed_offset=0,pending_bytes=''::bytea,next_sequence=1,rolling_hash=excluded.rolling_hash,updated_at=now()`, [this.tenantId, runId, chunk.generation, ZERO_HASH]);
        cursor = { generation: chunk.generation, committed_offset: 0, pending_bytes: new Uint8Array(), next_sequence: 1, rolling_hash: ZERO_HASH };
      }
      const committed = Number(cursor.committed_offset), endOffset = chunk.startOffset + chunk.bytes.byteLength;
      const receipt = (await client.query<{ chunk_sha256: string; end_offset: string | number; previous_hash: string; rolling_hash: string }>("SELECT chunk_sha256,end_offset,previous_hash,rolling_hash FROM app.run_trace_chunks WHERE tenant_id=$1 AND run_id=$2 AND generation=$3 AND start_offset=$4", [this.tenantId, runId, chunk.generation, chunk.startOffset])).rows[0];
      if (receipt) {
        if (receipt.chunk_sha256 !== chunk.chunkSha256 || Number(receipt.end_offset) !== endOffset || receipt.previous_hash !== chunk.previousHash) throw new Error("Conflicting trace chunk retry");
        return { offset: Number(receipt.end_offset), rollingHash: receipt.rolling_hash, duplicate: true, events: 0 };
      }
      if (chunk.startOffset !== committed) throw new Error(`Trace chunk offset mismatch: expected ${committed}`);
      if (chunk.previousHash !== cursor.rolling_hash) throw new Error("Trace chunk hash chain mismatch");

      const pending = cursor.pending_bytes instanceof Uint8Array ? cursor.pending_bytes : new Uint8Array(cursor.pending_bytes as any);
      const combined = new Uint8Array(pending.byteLength + chunk.bytes.byteLength); combined.set(pending); combined.set(chunk.bytes, pending.byteLength);
      let boundary = combined.lastIndexOf(10), remainder = new Uint8Array(), complete = combined;
      if (boundary < 0) { complete = new Uint8Array(); remainder = combined; }
      else { complete = combined.slice(0, boundary + 1); remainder = combined.slice(boundary + 1); }
      if (remainder.byteLength > 16 * 1024 * 1024) throw new Error("Incomplete trace record exceeds 16 MiB");
      const parsed = parseTrace(provider, new TextDecoder("utf-8", { fatal: true }).decode(complete));
      const nextSequence = Number(cursor.next_sequence), events = parsed.map((item, index) => ({ ...item, sequence: nextSequence + index }));
      for (let offset = 0; offset < events.length; offset += 250) await this.insertBatch(client, runId, events.slice(offset, offset + 250));
      const rollingHash = await sha256(`${cursor.rolling_hash}:${chunk.startOffset}:${endOffset}:${chunk.chunkSha256}`);
      await client.query("INSERT INTO app.run_trace_chunks(tenant_id,run_id,generation,start_offset,end_offset,chunk_sha256,previous_hash,rolling_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [this.tenantId, runId, chunk.generation, chunk.startOffset, endOffset, chunk.chunkSha256, chunk.previousHash, rollingHash]);
      await client.query("UPDATE app.run_trace_cursors SET committed_offset=$3,pending_bytes=$4,next_sequence=$5,rolling_hash=$6,updated_at=now() WHERE tenant_id=$1 AND run_id=$2", [this.tenantId, runId, endOffset, remainder, nextSequence + events.length, rollingHash]);
      return { offset: endOffset, rollingHash, duplicate: false, events: events.length };
    });
  }

  private async insertBatch(client: DatabaseClient, runId: string, items: TraceEvent[]) {
    if (!items.length) return;
    await client.query(`INSERT INTO app.run_trace_events(tenant_id,run_id,sequence,id,parent_id,event_type,role,title,preview_text,display_data,occurred_at)
      SELECT $1,$2,x.sequence,x.id,x.parent_id,x.event_type,x.role,x.title,x.preview_text,x.display_data,x.occurred_at
      FROM jsonb_to_recordset($3::jsonb) AS x(sequence bigint,id text,parent_id text,event_type text,role text,title text,preview_text text,display_data jsonb,occurred_at timestamptz)`, [this.tenantId, runId, JSON.stringify(items.map(item => ({ sequence: item.sequence, id: item.id, parent_id: item.parentId ?? null, event_type: item.type, role: item.role ?? null, title: item.title, preview_text: item.preview, display_data: item.display, occurred_at: item.occurredAt ?? null })))]);
  }
}
