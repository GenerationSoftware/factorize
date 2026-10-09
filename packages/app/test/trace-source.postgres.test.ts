import { readFile, readdir } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Database } from "../src/postgres/database";
import { LiveTraceRepository } from "../src/postgres/live-trace-repository";
import { TraceRepository } from "../src/postgres/trace-repository";
import { ArtifactRepository } from "../src/postgres/artifact-repository";
import { replayTrace } from "../src/trace-replay";
import { TraceProjectionRepository } from "../src/postgres/trace-projection-repository";
import { artifactUpload, issueArtifactUploadGrant } from "../src/artifact-upload";

const url = process.env.TRACE_TEST_DATABASE_URL ?? process.env.AUTH_TEST_DATABASE_URL;
const zero = "0".repeat(64), secret = "test-signing-secret";
const hash = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer))].map(x => x.toString(16).padStart(2, "0")).join("");
const record = (id: string) => JSON.stringify({ version: 1, id, type: "assistant_message", title: "Assistant", preview: id }) + "\n";

describe.skipIf(!url)("trace sources with PostgreSQL", () => {
  let database: Database, admin: Database;
  const databaseName = `trace_test_${crypto.randomUUID().replaceAll("-", "")}`;
  beforeAll(async () => {
    admin = new Database({ connectionString: url });
    await admin.pool.query(`CREATE DATABASE ${databaseName}`);
    const connection = new URL(url!); connection.pathname = `/${databaseName}`;
    database = new Database({ connectionString: connection.toString() });
    const directory = new URL("../migrations/", import.meta.url);
    for (const file of (await readdir(directory)).filter(file => file.endsWith(".sql")).sort()) await database.pool.query(await readFile(new URL(file, directory), "utf8"));
  });
  afterAll(async () => { await database?.close(); if (admin) { await admin.pool.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`); await admin.close(); } });

  async function fixture(provider: "codex" | "claude" = "codex") {
    const tenantId = crypto.randomUUID(), jobId = crypto.randomUUID(), triggerId = crypto.randomUUID(), invocationId = crypto.randomUUID(), runId = crypto.randomUUID();
    await database.pool.query("INSERT INTO app.tenants(id) VALUES ($1)", [tenantId]);
    await database.pool.query("INSERT INTO app.jobs(tenant_id,id,name,slug,encrypted_prompt_template,execution_target,concurrency_limit) VALUES ($1,$2,'Trace test','trace-test','test','{}',1)", [tenantId, jobId]);
    await database.pool.query("INSERT INTO app.triggers(tenant_id,id,job_id,kind,slug) VALUES ($1,$2,$3,'manual','manual')", [tenantId, triggerId, jobId]);
    await database.pool.query("INSERT INTO app.invocations(tenant_id,id,job_id,source,claim_key,trigger_id,context) VALUES ($1,$2,$3,'manual','test',$4,'{}')", [tenantId, invocationId, jobId, triggerId]);
    await database.pool.query("INSERT INTO app.runs(tenant_id,id,job_id,invocation_id,provider,issue_id,agent_name,state,trace_sources) VALUES ($1,$2,$3,$4,'manual','test','test','running',$5)", [tenantId, runId, jobId, invocationId, { primary: { kind: "execution_stream" } }]);
    const blobs = new Map<string, Uint8Array>();
    const env = { DATABASE: database, SESSION_SIGNING_SECRET: secret, RUN_ARTIFACTS: {
      put: async (key: string, stream: ReadableStream, options: any) => { const bytes = new Uint8Array(await new Response(stream).arrayBuffer()); expect(await hash(bytes)).toBe(options.sha256); blobs.set(key, bytes); return { httpEtag: "test" }; },
      get: async (key: string) => blobs.has(key) ? { body: new Response(new Uint8Array(blobs.get(key)!)).body, size: blobs.get(key)!.length, checksums: { sha256: await crypto.subtle.digest("SHA-256", new Uint8Array(blobs.get(key)!).buffer) } } : null,
    } } as any;
    const upload = async (text: string, kind: "execution_stream" | "native_session" = "execution_stream") => {
      const bytes = new TextEncoder().encode(text), sha256 = await hash(bytes);
      const traceGeneration = kind === "execution_stream" ? (await new LiveTraceRepository(database, tenantId).cursor(runId)).generation : undefined;
      const token = await issueArtifactUploadGrant({ traceGeneration, tenantId, runId, path: kind === "execution_stream" ? "trace/stream.jsonl" : "native/session.jsonl", contentType: "application/x-ndjson", provider, format: "jsonl", sourceKind: kind, sourcePath: "/tmp/trace.jsonl", formatVersion: "1", cliVersion: "p1", harnessVersion: "h1", primary: kind === "execution_stream", expiresAt: Date.now() + 60_000 }, secret);
      return artifactUpload(new Request("https://app/upload", { method: "PUT", headers: { "Content-Type": "application/x-ndjson", "Content-Length": String(bytes.length), "X-Artifact-SHA256": sha256 }, body: bytes }), env, token);
    };
    return { tenantId, env, runId, upload, blobs, live: new LiveTraceRepository(database, tenantId), trace: new TraceRepository(database, tenantId), artifacts: new ArtifactRepository(database, tenantId) };
  }

  it.each(["codex", "claude"] as const)("reconciles %s durable bytes, preserves native audit data, and rejects late chunks", async provider => {
    const f = await fixture(provider), text = record("event-1") + '{"partial":', bytes = new TextEncoder().encode(text);
    const chunk = { generation: "file-1", expectedGeneration: null, startOffset: 0, chunkSha256: await hash(bytes), previousHash: zero, bytes };
    const receipts = await Promise.all([f.live.append(f.runId, provider, chunk, "execution_stream"), f.live.append(f.runId, provider, chunk, "execution_stream")]);
    expect(receipts.filter(receipt => receipt.duplicate)).toHaveLength(1);
    const live = await f.trace.page(f.runId);
    expect(live.items).toHaveLength(1);
    expect((await f.upload(text)).status).toBe(201);
    expect(await f.trace.page(f.runId)).toEqual(live);
    expect((await new TraceProjectionRepository(database, f.tenantId).diagnostics(f.runId)).projection?.reconciliation.state).toBe("matched");
    expect((await f.upload('{"type":"session_meta","payload":{"id":"native"}}\n', "native_session")).status).toBe(201);
    expect(await f.trace.page(f.runId)).toEqual(live);
    const artifacts = await f.artifacts.list(f.runId);
    expect(artifacts.map(item => item.kind).sort()).toEqual(["execution_stream", "native_session"]);
    const stream = artifacts.find(item => item.kind === "execution_stream")!;
    expect(stream).toMatchObject({ source_path: "/tmp/trace.jsonl", media_type: "application/x-ndjson", format_version: "1", cli_version: "p1", harness_version: "h1" });
    expect(new TextDecoder().decode(f.blobs.get(stream.object_key))).toBe(text);
    expect((await f.upload(text)).status).toBe(201);
    expect((await f.upload(record("replacement"))).status).toBe(409);
    await expect(f.live.append(f.runId, provider, chunk, "execution_stream")).rejects.toThrow("already finalized");
  });

  it("rolls back failed final projection and its receipt without losing live events", async () => {
    const f = await fixture(), bytes = new TextEncoder().encode(record("live"));
    await f.live.append(f.runId, "codex", { generation: "file-1", expectedGeneration: null, startOffset: 0, chunkSha256: await hash(bytes), previousHash: zero, bytes }, "execution_stream");
    const live = await f.trace.page(f.runId);
    // Malformed provider records may be tolerated. Force a real persistence failure
    // after a complete batch was inserted to exercise the transaction rollback.
    await database.pool.query("ALTER TABLE app.run_trace_events ADD CONSTRAINT reject_final_projection CHECK (preview_text <> 'reject-final-projection')");
    try {
      const text = Array.from({ length: 250 }, (_, index) => record(`new-${index}`)).join("") + record("reject-final-projection");
      await expect(f.upload(text)).rejects.toThrow("reject_final_projection");
    } finally {
      await database.pool.query("ALTER TABLE app.run_trace_events DROP CONSTRAINT reject_final_projection");
    }
    expect(await f.trace.page(f.runId)).toEqual(live);
    expect(await f.artifacts.list(f.runId)).toHaveLength(0);
    expect((await f.upload(record("live"))).status).toBe(201);
  });
  it("replays corrected historical Codex calls, resumes, rate limits, and preserves artifacts across rollback", async () => {
    const f = await fixture();
    const native = JSON.stringify({ type: "response_item", payload: { type: "custom_tool_call", call_id: "apply-1", name: "apply_patch", input: "patch" } }) + "\n";
    await f.upload(record("stream"));
    await f.upload(native, "native_session");
    await database.pool.query("UPDATE app.runs SET state='succeeded' WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.runId]);
    const requestId = crypto.randomUUID(), input = { requestId, source: "native_session" as const };
    const result = await replayTrace(f.env, f.tenantId, "owner", f.runId, input);
    expect(result).toMatchObject({ status: "projected", sourceKind: "native_session" });
    expect((await f.trace.page(f.runId)).items).toMatchObject([{ type: "tool_call", title: "apply_patch", id: "apply-1" }]);
    expect(await replayTrace(f.env, f.tenantId, "owner", f.runId, input)).toEqual(result);
    expect(await replayTrace(f.env, f.tenantId, "owner", f.runId, { ...input, requestId: crypto.randomUUID() })).toMatchObject({ status: "already_projected" });
    expect((await f.upload(record("stream"))).status).toBe(201);
    expect((await f.trace.page(f.runId)).items[0].type).toBe("tool_call");
    expect(await f.artifacts.list(f.runId)).toHaveLength(2);
    await expect(replayTrace(f.env, f.tenantId, "owner", crypto.randomUUID(), input)).rejects.toMatchObject({ status: 409 });
    expect(await replayTrace(f.env, f.tenantId, "owner", f.runId, { requestId: crypto.randomUUID(), source: "primary" })).toMatchObject({ status: "projected", sourceKind: "execution_stream" });
    expect((await f.trace.page(f.runId)).items[0].id).toBe("stream");
    for (let i = 0; i < 5; i++) await replayTrace(f.env, f.tenantId, "owner", f.runId, { requestId: crypto.randomUUID(), source: "primary" });
    await expect(replayTrace(f.env, f.tenantId, "owner", f.runId, input)).rejects.toMatchObject({ status: 429 });
  });

  it("reports active and unavailable runs without inventing recovery; isolates requests and retained bytes", async () => {
    const f = await fixture(), other = await fixture();
    const input = { requestId: crypto.randomUUID(), source: "primary" as const };
    expect(await replayTrace(f.env, f.tenantId, "owner", f.runId, input)).toMatchObject({ status: "skipped", reason: "run_active" });
    await expect(replayTrace(f.env, other.tenantId, "owner", f.runId, { ...input, requestId: crypto.randomUUID() })).rejects.toMatchObject({ status: 404 });
    await database.pool.query("UPDATE app.runs SET state='succeeded' WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.runId]);
    expect(await replayTrace(f.env, f.tenantId, "owner", f.runId, { ...input, requestId: crypto.randomUUID() })).toMatchObject({ status: "unrecoverable", reason: "missing_artifact" });
    await f.upload(record("saved"));
    f.blobs.clear();
    expect(await replayTrace(f.env, f.tenantId, "owner", f.runId, { ...input, requestId: crypto.randomUUID() })).toMatchObject({ status: "unrecoverable", reason: "artifact_not_retained" });
    expect((await f.trace.page(f.runId)).items[0].id).toBe("saved");
  });

  it("persists mismatch evidence, rejects stale terminal generations, and makes failed replay resumable", async () => {
    const f = await fixture(), liveText = record("old"), bytes = new TextEncoder().encode(liveText);
    await f.live.append(f.runId, "codex", { generation: "file-1", expectedGeneration: null, startOffset: 0, chunkSha256: await hash(bytes), previousHash: zero, bytes }, "execution_stream");
    const stale = await issueArtifactUploadGrant({ tenantId: f.tenantId, runId: f.runId, path: "trace/stream.jsonl", contentType: "application/x-ndjson", provider: "codex", format: "jsonl", sourceKind: "execution_stream", traceGeneration: null, expiresAt: Date.now() + 60_000 }, secret);
    expect((await artifactUpload(new Request("https://app/upload", { method: "PUT", headers: { "Content-Type": "application/x-ndjson", "Content-Length": String(bytes.length), "X-Artifact-SHA256": await hash(bytes) }, body: bytes }), f.env, stale)).status).toBe(409);
    expect((await f.upload(record("new"))).status).toBe(201);
    expect((await new TraceProjectionRepository(database, f.tenantId).diagnostics(f.runId)).projection?.reconciliation).toMatchObject({ state: "mismatch", mismatches: 1 });
    await f.upload(JSON.stringify({ type: "response_item", payload: { type: "custom_tool_call", call_id: "call", name: "apply_patch", input: "reject" } }) + "\n", "native_session");
    await database.pool.query("UPDATE app.runs SET state='succeeded' WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.runId]);
    const input = { requestId: crypto.randomUUID(), source: "native_session" as const };
    await database.pool.query("ALTER TABLE app.run_trace_events ADD CONSTRAINT reject_replay CHECK (preview_text <> 'reject')");
    try { await expect(replayTrace(f.env, f.tenantId, "owner", f.runId, input)).rejects.toThrow("reject_replay"); }
    finally { await database.pool.query("ALTER TABLE app.run_trace_events DROP CONSTRAINT reject_replay"); }
    expect((await f.trace.page(f.runId)).items[0].id).toBe("new");
    expect(await replayTrace(f.env, f.tenantId, "owner", f.runId, input)).toMatchObject({ status: "projected" });
  });

  it("backfills an undeclared historical session and rejects missing checksums or cross-tenant keys", async () => {
    const f = await fixture();
    await database.pool.query("UPDATE app.runs SET state='succeeded',trace_sources=NULL WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.runId]);
    const text = JSON.stringify({ type: "response_item", payload: { type: "custom_tool_call", call_id: "historical", name: "apply_patch", input: "retained patch" } }) + "\n" + JSON.stringify({ type: "response_item", payload: { type: "custom_tool_call_output", call_id: "historical", output: "success" } }) + "\n";
    const bytes = new TextEncoder().encode(text), sha256 = await hash(bytes);
    const key = `tenants/${f.tenantId}/runs/${f.runId}/native/session.jsonl`;
    f.blobs.set(key, bytes);
    await f.artifacts.record({ runId: f.runId, kind: "native_session", provider: "codex", format: "jsonl", objectKey: key, byteSize: bytes.length, sha256 });
    const input = { requestId: crypto.randomUUID(), source: "primary" as const };
    const originalGet = f.env.RUN_ARTIFACTS.get;
    f.env.RUN_ARTIFACTS.get = async (key: string) => ({ ...await originalGet(key), checksums: {} });
    await expect(replayTrace(f.env, f.tenantId, "owner", f.runId, input)).rejects.toMatchObject({ status: 409, code: "invalid_artifact" });
    expect((await f.trace.page(f.runId)).items).toHaveLength(0);
    f.env.RUN_ARTIFACTS.get = originalGet;
    expect(await replayTrace(f.env, f.tenantId, "owner", f.runId, input)).toMatchObject({ status: "projected" });
    expect((await f.trace.page(f.runId)).items).toMatchObject([{ type: "tool_call", id: "historical", title: "apply_patch" }, { type: "tool_result", parentId: "historical", title: "apply_patch" }]);
    await database.pool.query("UPDATE app.run_artifacts SET object_key='tenants/another/runs/other/native/session.jsonl' WHERE tenant_id=$1 AND run_id=$2", [f.tenantId, f.runId]);
    await expect(replayTrace(f.env, f.tenantId, "owner", f.runId, { ...input, requestId: crypto.randomUUID() })).rejects.toMatchObject({ status: 409, code: "invalid_artifact" });
    expect((await f.trace.page(f.runId)).items).toHaveLength(2);
  });

  it("finalizes Pi native projection, rejects late chunks, and preserves immutable native snapshots", async () => {
    const f = await fixture();
    await database.pool.query("UPDATE app.runs SET trace_sources=$3 WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.runId, { primary: { kind: "native_session", provider: "pi" } }]);
    const text = JSON.stringify({ type: "message", id: "tool", message: { role: "assistant", content: [{ type: "toolCall", id: "pi-call", name: "bash", arguments: { command: "pwd" } }] } }) + "\n";
    const bytes = new TextEncoder().encode(text), chunk = { generation: "pi-session", expectedGeneration: null, startOffset: 0, chunkSha256: await hash(bytes), previousHash: zero, bytes };
    await f.live.append(f.runId, "pi", chunk, "native_session");
    const token = await issueArtifactUploadGrant({ tenantId: f.tenantId, runId: f.runId, provider: "pi", format: "jsonl", path: "native/session.jsonl", contentType: "application/x-ndjson", sourceKind: "native_session", primary: true, traceGeneration: "pi-session", expiresAt: Date.now() + 60_000 }, secret);
    const upload = async (bytes: Uint8Array) => artifactUpload(new Request("https://app/upload", { method: "PUT", headers: { "Content-Type": "application/x-ndjson", "Content-Length": String(bytes.length), "X-Artifact-SHA256": await hash(bytes) }, body: new Uint8Array(bytes) }), f.env, token);
    expect((await upload(bytes)).status).toBe(201);
    expect((await f.trace.page(f.runId)).items).toMatchObject([{ id: "tool", type: "tool_call", title: "bash", display: { toolCallId: "pi-call" } }]);
    await expect(f.live.append(f.runId, "pi", chunk, "native_session")).rejects.toThrow("already finalized");
    expect((await upload(new TextEncoder().encode(text + '{}\n'))).status).toBe(409);
    expect(await f.artifacts.list(f.runId)).toHaveLength(1);
    const retained = (await f.artifacts.list(f.runId))[0];
    expect(new TextDecoder().decode(f.blobs.get(retained.object_key))).toBe(text);
  });

});
