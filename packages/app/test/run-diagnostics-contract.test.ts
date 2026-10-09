import { afterEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { readFileSync } from "node:fs";
import { ApiService } from "../src/flow-service";
import { IdentityRepository } from "../src/postgres/identity-repository";
import { encrypt } from "../src/crypto";
import { isDeclaredApiOperation } from "../src/api-contract";

afterEach(() => vi.restoreAllMocks());
const execution = { state: "failed", detail: "Process exited with status 42", systemd: { loadState: "loaded", activeState: "failed", subState: "failed", result: "exit-code", execMainCode: 1, execMainStatus: 42 } };
const traceSources = { primary: { kind: "execution_stream", path: "/tmp/events.jsonl", mediaType: "application/x-ndjson", provider: "codex", formatVersion: "1", cliVersion: "test-cli", harnessVersion: "test-harness" } };
const artifact = { id: "artifact", kind: "terminal_log", object_key: "tenants/tenant/runs/run/harness/stderr.txt", format: "text", state: "stored", byte_size: "27", sha256: "a".repeat(64) };

async function fixture(tenantId = "tenant", scopes = ["runs:read"], authMethod?: "session") {
  const key = btoa("a".repeat(32)), encryptedPrompt = await encrypt("private prompt", key);
  vi.spyOn(IdentityRepository.prototype, "member").mockResolvedValue({ role: "owner", sessionVersion: 1 } as any);
  const query = vi.fn(async (sql: string, values: any[]) => {
    if (values[0] !== "tenant") return { rows: [] };
    if (sql.includes("SELECT r.*")) return { rows: [{ id: "run", job_id: "job", state: "failed", encrypted_prompt: encryptedPrompt, execution_diagnostics: execution, trace_sources: traceSources, execution_backend_kind: "exe-vm", artifact_state: "partial", artifact_error: "Canonical execution stream upload failed: /tmp/events.jsonl" }] };
    if (sql.includes("app.run_artifacts")) return { rows: [artifact] };
    return { rows: [] };
  });
  return new ApiService({ DATABASE: { pool: { query } }, CREDENTIAL_ENCRYPTION_KEY: key } as any, { tenantId, userId: "user", sessionVersion: 1, scopes, authMethod } as any);
}

describe("run diagnostics API boundary", () => {
  it("exposes durable evidence and artifact location through both declared versioned operations", async () => {
    const service = await fixture();
    expect(isDeclaredApiOperation("GET", "/api/v1/runs/run")).toBe(true);
    expect(isDeclaredApiOperation("GET", "/api/v1/runs/run/diagnostics")).toBe(true);
    expect(await service.getRun("run")).toMatchObject({ execution_diagnostics: execution, harness_log: artifact, trace_sources: traceSources });
    const diagnostics = await service.getRunDiagnostics("run");
    expect(diagnostics).toMatchObject({ trace: { provider: "codex", primarySource: "execution_stream", nativeArtifactState: "not_applicable" }, execution, traceSources, harnessLog: artifact, artifact: { state: "partial", error: "Canonical execution stream upload failed: /tmp/events.jsonl" } });
    expect(JSON.stringify(diagnostics)).not.toContain("private prompt");
    expect(JSON.stringify(diagnostics)).not.toContain("encrypted_prompt");
  });
  it("requires runs:read and isolates artifact lookup by tenant", async () => {
    await expect((await fixture("tenant", [])).getRunDiagnostics("run")).rejects.toMatchObject({ status: 403 });
    await expect((await fixture("other-tenant")).getRunDiagnostics("run")).rejects.toMatchObject({ status: 404 });
  });
  it("returns null evidence and log for older runs", async () => {
    const service = await fixture();
    const { RunQueryRepository } = await import("../src/postgres/run-query-repository");
    const { ArtifactRepository } = await import("../src/postgres/artifact-repository");
    const key = btoa("a".repeat(32));
    vi.spyOn(RunQueryRepository.prototype, "get").mockResolvedValue({ id: "old", encrypted_prompt: await encrypt("", key) });
    vi.spyOn(ArtifactRepository.prototype, "list").mockResolvedValue([]);
    expect(await service.getRunDiagnostics("old")).toMatchObject({ execution: null, harnessLog: null, traceSources: null });
  });
  it("requires write scope and an interactive owner session for replay before reading storage", async () => {
    const body = { requestId: crypto.randomUUID(), source: "native_session" };
    expect(isDeclaredApiOperation("POST", "/api/v1/runs/run/trace/replay")).toBe(true);
    await expect((await fixture("tenant", ["runs:read"])).replayRunTrace(crypto.randomUUID(), body)).rejects.toMatchObject({ status: 403, code: "insufficient_scope" });
    await expect((await fixture("tenant", ["runs:write"])).replayRunTrace(crypto.randomUUID(), body)).rejects.toMatchObject({ status: 403, code: "session_required" });
  });
  it("validates replay input after owner-session authorization", async () => {
    const service = await fixture("tenant", ["runs:write"], "session");
    await expect(service.replayRunTrace(crypto.randomUUID(), { requestId: "invalid", tenantId: "other" })).rejects.toMatchObject({ name: "ZodError" });
    await expect(service.replayRunTrace("not-a-run", { requestId: crypto.randomUUID() })).rejects.toMatchObject({ name: "ZodError" });
    vi.spyOn(IdentityRepository.prototype, "member").mockResolvedValue({ role: "owner", sessionVersion: 2 } as any);
    await expect(service.replayRunTrace(crypto.randomUUID(), { requestId: crypto.randomUUID() })).rejects.toMatchObject({ status: 401 });
  });
  it("documents the externally visible fields and schema references", () => {
    const spec = parse(readFileSync(new URL("../../docs/openapi.yaml", import.meta.url), "utf8"));
    const schemas = spec.components.schemas;
    for (const [name, fields] of Object.entries({
      RunDetail: ["trace_generation", "trace_projection", "trace_sources", "execution_diagnostics", "harness_log"],
      RunDiagnostics: ["traceSources", "execution", "harnessLog"],
      TraceSource: ["harnessVersion", "cliVersion"],
      TraceReplayRequest: ["requestId", "source"],
      TraceReplayResult: ["requestId", "runId", "status"],
      HarnessLog: ["object_key", "source_generation"],
    })) for (const field of fields) expect(schemas[name].properties[field]).toBeDefined();
    expect(schemas.TraceDiagnostics.properties.nativeArtifactState.enum).toContain("not_applicable");
    expect(schemas.ExecutionDiagnostics.properties.systemd.properties).toHaveProperty("execMainStatus");
    expect(spec.paths["/api/v1/runs/{runId}"].get.responses["200"].content["application/json"].schema.$ref).toBe("#/components/schemas/RunDetail");
    expect(spec.paths["/api/v1/runs/{runId}/diagnostics"].get.responses["200"].content["application/json"].schema.$ref).toBe("#/components/schemas/RunDiagnostics");
    expect(spec.paths["/api/v1/runs/{runId}/trace/replay"].post.requestBody.content["application/json"].schema.$ref).toBe("#/components/schemas/TraceReplayRequest");
  });
});
