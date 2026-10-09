import { readFile, readdir } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Database } from "../src/postgres/database";
import { LiveTraceRepository } from "../src/postgres/live-trace-repository";
import { TraceRepository } from "../src/postgres/trace-repository";
import { ArtifactRepository } from "../src/postgres/artifact-repository";
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
      get: async (key: string) => blobs.has(key) ? { body: new Response(new Uint8Array(blobs.get(key)!)).body } : null,
    } } as any;
    const upload = async (text: string, kind: "execution_stream" | "native_session" = "execution_stream") => {
      const bytes = new TextEncoder().encode(text), sha256 = await hash(bytes);
      const token = await issueArtifactUploadGrant({ tenantId, runId, path: kind === "execution_stream" ? "trace/stream.jsonl" : "native/session.jsonl", contentType: "application/x-ndjson", provider, format: "jsonl", sourceKind: kind, sourcePath: "/tmp/trace.jsonl", formatVersion: "1", cliVersion: "p1", harnessVersion: "h1", primary: kind === "execution_stream", expiresAt: Date.now() + 60_000 }, secret);
      return artifactUpload(new Request("https://app/upload", { method: "PUT", headers: { "Content-Type": "application/x-ndjson", "Content-Length": String(bytes.length), "X-Artifact-SHA256": sha256 }, body: bytes }), env, token);
    };
    return { runId, upload, blobs, live: new LiveTraceRepository(database, tenantId), trace: new TraceRepository(database, tenantId), artifacts: new ArtifactRepository(database, tenantId) };
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
});
