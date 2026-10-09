import { describe, expect, it, vi } from "vitest";
import { artifactUpload, issueArtifactUploadGrant, readArtifactUploadGrant } from "../src/artifact-upload";

const secret = "test-secret";
const grant = { tenantId: "tenant-1", runId: "run-1", path: "native/session.jsonl", contentType: "application/x-ndjson", provider: "codex" as const, format: "jsonl" as const, expiresAt: Date.now() + 60_000 };

describe("artifact upload grants", () => {
  it("round trips and expires signed grants", async () => {
    const token = await issueArtifactUploadGrant(grant, secret);
    await expect(readArtifactUploadGrant(token, secret)).resolves.toEqual(grant);
    await expect(readArtifactUploadGrant(token, secret, grant.expiresAt + 1)).resolves.toBeNull();
    await expect(readArtifactUploadGrant(`${token}x`, secret)).resolves.toBeNull();
  });

  it("streams the request into its deterministic object key", async () => {
    const put = vi.fn(async (_key, body) => ({ httpEtag: "etag", size: 7, body }));
    const token = await issueArtifactUploadGrant(grant, secret);
    const query = vi.fn(async (sql: string) => ({ rows: sql.startsWith("SELECT id,trace_sources") ? [{ id: "run-1" }] : [], rowCount: 1 })), get = vi.fn(async () => ({ body: new Response(JSON.stringify({ type: "session_meta", payload: { id: "s1" } })).body }));
    const response = await artifactUpload(new Request(`https://app/internal/run-artifacts/${encodeURIComponent(token)}`, { method: "PUT", headers: { "Content-Type": grant.contentType, "X-Artifact-SHA256": "a".repeat(64) }, body: "session" }), { SESSION_SIGNING_SECRET: secret, RUN_ARTIFACTS: { put, get }, DATABASE: { pool: { query }, transaction: (work: any) => work({ query }) } } as any, token);
    expect(response.status).toBe(201);
    expect(put).toHaveBeenCalledWith(`tenants/tenant-1/runs/run-1/native/${"a".repeat(64)}.jsonl`, expect.any(ReadableStream), expect.objectContaining({ customMetadata: { tenantId: "tenant-1", runId: "run-1" } }));
  });

  it("rejects mismatched content types before storage", async () => {
    const token = await issueArtifactUploadGrant(grant, secret), put = vi.fn();
    const response = await artifactUpload(new Request("https://app/upload", { method: "PUT", headers: { "Content-Type": "text/plain" }, body: "session" }), { SESSION_SIGNING_SECRET: secret, RUN_ARTIFACTS: { put } } as any, token);
    expect(response.status).toBe(400);
    expect(put).not.toHaveBeenCalled();
  });
  it("stores and reprojects the primary copy while keeping native uploads separate", async () => {
    const query = vi.fn(async (sql: string, _values?: any[]) => ({ rows: sql.startsWith("SELECT id,trace_sources") ? [{ trace_sources: { primary: { kind: "execution_stream" } } }] : [], rowCount: 1 }));
    const jsonl = JSON.stringify({ version: 1, id: "a", type: "assistant_message", title: "Assistant", preview: "hello" }) + "\n{partial";
    const put = vi.fn(async (_key: string, _body: any, _options: any) => ({ httpEtag: "etag" })), get = vi.fn(async () => ({ body: new Response(jsonl).body }));
    const env = { SESSION_SIGNING_SECRET: secret, RUN_ARTIFACTS: { put, get }, DATABASE: { pool: { query }, transaction: (work: any) => work({ query }) } } as any;
    const primary = { ...grant, sourceKind: "execution_stream" as const, traceGeneration: null, sourcePath: "/tmp/events.jsonl", formatVersion: "1", harnessVersion: "h1", cliVersion: "p1", primary: true };
    const upload = async (value: typeof grant) => {
      const token = await issueArtifactUploadGrant(value, secret);
      return artifactUpload(new Request("https://app/upload", { method: "PUT", headers: { "Content-Type": grant.contentType, "Content-Length": String(new TextEncoder().encode(jsonl).length), "X-Artifact-SHA256": "b".repeat(64) }, body: jsonl }), env, token);
    };
    expect((await upload(primary)).status).toBe(201);
    expect(put.mock.calls[0][0]).toBe(`tenants/tenant-1/runs/run-1/trace/${"b".repeat(64)}.jsonl`);
    const inserts = query.mock.calls.filter(([sql]) => sql.startsWith("INSERT INTO app.run_trace_events"));
    expect(inserts).toHaveLength(1);
    const recorded = query.mock.calls.find(([sql]) => sql.startsWith("INSERT INTO app.run_artifacts"));
    expect((recorded as any)[1]).toEqual(expect.arrayContaining(["execution_stream", "/tmp/events.jsonl", "h1", "p1", "1"]));
    query.mockClear();
    expect((await upload({ ...grant, primary: false } as any)).status).toBe(201);
    expect(query.mock.calls.some(([sql]) => sql.startsWith("DELETE FROM app.run_trace_events"))).toBe(false);
    expect(put.mock.calls[1][0]).toBe(`tenants/tenant-1/runs/run-1/native/${"b".repeat(64)}.jsonl`);
  });
  it("rejects replacement of a terminal stream with different bytes", async () => {
    const query = vi.fn(async () => ({ rows: [{ kind: "execution_stream", state: "stored", sha256: "a".repeat(64) }], rowCount: 1 }));
    const put = vi.fn(), token = await issueArtifactUploadGrant({ ...grant, sourceKind: "execution_stream", traceGeneration: null }, secret);
    const response = await artifactUpload(new Request("https://app/upload", { method: "PUT", headers: { "Content-Type": grant.contentType, "X-Artifact-SHA256": "b".repeat(64), "Content-Length": "2" }, body: "{}" }), { SESSION_SIGNING_SECRET: secret, RUN_ARTIFACTS: { put }, DATABASE: { pool: { query } } } as any, token);
    expect(response.status).toBe(409);
    expect(put).not.toHaveBeenCalled();
  });

});
