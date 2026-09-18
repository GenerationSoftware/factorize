import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { ApiService } from "../src/flow-service";
import { IdentityRepository } from "../src/postgres/identity-repository";
import { encrypt } from "../src/crypto";
import { isDeclaredApiOperation } from "../src/api-contract";

afterEach(() => vi.restoreAllMocks());
const execution = { state: "failed", detail: "Process exited with status 42", systemd: { loadState: "loaded", activeState: "failed", subState: "failed", result: "exit-code", execMainCode: 1, execMainStatus: 42 } };
const artifact = { id: "artifact", kind: "terminal_log", object_key: "tenants/tenant/runs/run/harness/stderr.txt", format: "text", state: "stored", byte_size: "27", sha256: "a".repeat(64) };

async function fixture(tenantId = "tenant", scopes = ["runs:read"]) {
  const key = btoa("a".repeat(32)), encryptedPrompt = await encrypt("private prompt", key);
  vi.spyOn(IdentityRepository.prototype, "member").mockResolvedValue({ role: "owner", sessionVersion: 1 } as any);
  const query = vi.fn(async (sql: string, values: any[]) => {
    if (values[0] !== "tenant") return { rows: [] };
    if (sql.includes("SELECT r.*")) return { rows: [{ id: "run", job_id: "job", state: "failed", encrypted_prompt: encryptedPrompt, execution_diagnostics: execution, execution_backend_kind: "exe-vm", artifact_state: "partial", artifact_error: "Native session upload failed" }] };
    if (sql.includes("app.run_artifacts")) return { rows: [artifact] };
    return { rows: [] };
  });
  return new ApiService({ DATABASE: { pool: { query } }, CREDENTIAL_ENCRYPTION_KEY: key } as any, { tenantId, userId: "user", sessionVersion: 1, scopes } as any);
}

describe("run diagnostics API boundary", () => {
  it("exposes durable evidence and artifact location through both declared versioned operations", async () => {
    const service = await fixture();
    expect(isDeclaredApiOperation("GET", "/api/v1/runs/run")).toBe(true);
    expect(isDeclaredApiOperation("GET", "/api/v1/runs/run/diagnostics")).toBe(true);
    expect(await service.getRun("run")).toMatchObject({ execution_diagnostics: execution, harness_log: artifact });
    const diagnostics = await service.getRunDiagnostics("run");
    expect(diagnostics).toMatchObject({ execution, harnessLog: artifact, artifact: { state: "partial", error: "Native session upload failed" } });
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
    expect(await service.getRunDiagnostics("old")).toMatchObject({ execution: null, harnessLog: null });
  });
  it("documents the externally visible fields and schema references", () => {
    const spec = readFileSync(new URL("../../docs/openapi.yaml", import.meta.url), "utf8");
    for (const field of ["execution_diagnostics", "harness_log", "execution:", "harnessLog:", "execMainCode", "execMainStatus", "activeState", "subState", "object_key"])
      expect(spec).toContain(field);
    expect(spec).toContain("$ref: '#/components/schemas/RunDetail'");
    expect(spec).toContain("$ref: '#/components/schemas/RunDiagnostics'");
  });
});
