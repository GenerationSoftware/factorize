import { describe, expect, it } from "vitest";
import { parseTrace, consumeTraceStream } from "../src/trace";
import { LiveTraceRepository } from "../src/postgres/live-trace-repository";

const digest = async (value: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map(x => x.toString(16).padStart(2, "0")).join("");
const zero = "0".repeat(64);

function fakeDatabase() {
  let cursor: any = null;
  const chunks = new Map<string, any>(), events: any[] = [];
  const query = async (sql: string, values: any[] = []) => {
    if (sql.startsWith("SELECT id FROM app.")) return { rows: [], rowCount: 0 };
    if (sql.startsWith("SELECT generation,committed_offset") && sql.includes("FOR UPDATE")) return { rows: cursor ? [cursor] : [], rowCount: cursor ? 1 : 0 };
    if (sql.startsWith("DELETE FROM app.run_trace_events")) { events.length = 0; return { rows: [], rowCount: 0 }; }
    if (sql.startsWith("DELETE FROM app.run_trace_chunks")) { chunks.clear(); return { rows: [], rowCount: 0 }; }
    if (sql.startsWith("INSERT INTO app.run_trace_cursors")) { cursor = { generation: values[2], committed_offset: 0, pending_bytes: new Uint8Array(), next_sequence: 1, rolling_hash: values[3] }; return { rows: [], rowCount: 1 }; }
    if (sql.startsWith("SELECT chunk_sha256")) { const row = chunks.get(`${values[2]}:${values[3]}`); return { rows: row ? [row] : [], rowCount: row ? 1 : 0 }; }
    if (sql.startsWith("INSERT INTO app.run_trace_events")) { events.push(...JSON.parse(values[2])); return { rows: [], rowCount: 1 }; }
    if (sql.startsWith("INSERT INTO app.run_trace_chunks")) { chunks.set(`${values[2]}:${values[3]}`, { end_offset: values[4], chunk_sha256: values[5], previous_hash: values[6], rolling_hash: values[7] }); return { rows: [], rowCount: 1 }; }
    if (sql.startsWith("UPDATE app.run_trace_cursors")) { cursor = { ...cursor, committed_offset: values[2], pending_bytes: values[3], next_sequence: values[4], rolling_hash: values[5] }; return { rows: [], rowCount: 1 }; }
    throw new Error(`Unexpected query: ${sql}`);
  };
  return { database: { pool: { query }, transaction: (work: any) => work({ query }) } as any, state: () => ({ cursor, chunks, events }) };
}

describe("LiveTraceRepository", () => {
  it("atomically carries partial records across idempotent chunks", async () => {
    const fake = fakeDatabase(), repository = new LiveTraceRepository(fake.database, "tenant-1");
    const firstText = '{"type":"session_meta","payload":{"id":"s1"}', first = new TextEncoder().encode(firstText);
    const firstResult = await repository.append("run-1", "codex", { generation: "file-1", expectedGeneration: null, startOffset: 0, chunkSha256: await digest(firstText), previousHash: zero, bytes: first });
    expect(firstResult.events).toBe(0);
    expect(fake.state().cursor.pending_bytes).toEqual(first);

    const duplicate = await repository.append("run-1", "codex", { generation: "file-1", expectedGeneration: null, startOffset: 0, chunkSha256: await digest(firstText), previousHash: zero, bytes: first });
    expect(duplicate.duplicate).toBe(true);

    const secondText = '}\n', second = new TextEncoder().encode(secondText);
    const secondResult = await repository.append("run-1", "codex", { generation: "file-1", expectedGeneration: "file-1", startOffset: first.byteLength, chunkSha256: await digest(secondText), previousHash: firstResult.rollingHash, bytes: second });
    expect(secondResult.events).toBe(1);
    expect(fake.state().events).toMatchObject([{ sequence: 1, event_type: "metadata", id: "s1" }]);
    expect(fake.state().cursor.pending_bytes).toHaveLength(0);
  });

  it("rejects stale generation changes instead of rolling the cursor back", async () => {
    const fake = fakeDatabase(), repository = new LiveTraceRepository(fake.database, "tenant-1"), bytes = new TextEncoder().encode("{}\n"), hash = await digest("{}\n");
    await repository.append("run-1", "codex", { generation: "file-2", expectedGeneration: null, startOffset: 0, chunkSha256: hash, previousHash: zero, bytes });
    await expect(repository.append("run-1", "codex", { generation: "file-1", expectedGeneration: null, startOffset: 0, chunkSha256: hash, previousHash: zero, bytes })).rejects.toThrow("Stale trace generation transition");
  });
  it("projects declared execution records live, retries safely, and agrees with terminal reconciliation", async () => {
    const fake = fakeDatabase(), repository = new LiveTraceRepository(fake.database, "tenant-1");
    const record = JSON.stringify({ version: 1, id: "event-1", type: "assistant_message", title: "Assistant", preview: "hello 😀" });
    const text = `${record}\n{"version":1`, bytes = new TextEncoder().encode(text);
    const split = bytes.indexOf(240) + 2; // split inside the multibyte emoji
    const chunks = [bytes.slice(0, split), bytes.slice(split)];
    let offset = 0, previousHash = zero;
    for (const bytes of chunks) {
      const chunkSha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(x => x.toString(16).padStart(2, "0")).join("");
      const chunk = { generation: "file-1", expectedGeneration: offset ? "file-1" : null, startOffset: offset, chunkSha256, previousHash, bytes };
      const receipt = await repository.append("run-1", "codex", chunk, "execution_stream");
      expect((await repository.append("run-1", "codex", chunk, "execution_stream")).duplicate).toBe(true);
      offset = receipt.offset; previousHash = receipt.rollingHash;
    }
    expect(fake.state().events).toMatchObject([{ id: "event-1", sequence: 1, event_type: "assistant_message", preview_text: "hello 😀" }]);
    const terminal: any[] = [];
    await consumeTraceStream("codex", new Response(bytes).body!, async items => { terminal.push(...items); }, 250, "execution_stream");
    expect(terminal).toEqual(parseTrace("codex", record, "execution_stream"));
    expect(fake.state().events.length).toBe(terminal.length);
    const rotated = new TextEncoder().encode(`${record}\n`);
    await repository.append("run-1", "codex", { generation: "file-2", expectedGeneration: "file-1", startOffset: 0, chunkSha256: await digest(`${record}\n`), previousHash: zero, bytes: rotated }, "execution_stream");
    expect(fake.state().events).toHaveLength(1);
    expect(fake.state().cursor.pending_bytes).toHaveLength(0);
  });

});
