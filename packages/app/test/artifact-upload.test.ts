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
    const query = vi.fn(async () => ({ rows: [], rowCount: 1 })), get = vi.fn(async () => ({ body: new Response(JSON.stringify({ type: "session_meta", payload: { id: "s1" } })).body }));
    const response = await artifactUpload(new Request(`https://app/internal/run-artifacts/${encodeURIComponent(token)}`, { method: "PUT", headers: { "Content-Type": grant.contentType, "X-Artifact-SHA256": "a".repeat(64) }, body: "session" }), { SESSION_SIGNING_SECRET: secret, RUN_ARTIFACTS: { put, get }, DATABASE: { pool: { query }, transaction: (work: any) => work({ query }) } } as any, token);
    expect(response.status).toBe(201);
    expect(put).toHaveBeenCalledWith("tenants/tenant-1/runs/run-1/native/session.jsonl", expect.any(ReadableStream), expect.objectContaining({ customMetadata: { tenantId: "tenant-1", runId: "run-1" } }));
  });

  it("rejects mismatched content types before storage", async () => {
    const token = await issueArtifactUploadGrant(grant, secret), put = vi.fn();
    const response = await artifactUpload(new Request("https://app/upload", { method: "PUT", headers: { "Content-Type": "text/plain" }, body: "session" }), { SESSION_SIGNING_SECRET: secret, RUN_ARTIFACTS: { put } } as any, token);
    expect(response.status).toBe(400);
    expect(put).not.toHaveBeenCalled();
  });
});
