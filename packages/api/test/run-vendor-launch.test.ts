import { afterEach, describe, expect, it, vi } from "vitest";
import { RunScheduler } from "../src/postgres/run-scheduler";
import { RunRepository } from "../src/postgres/run-repository";
import { ExeVmBackend } from "../src/exe-vm-backend";
import { encrypt } from "../src/crypto";

import { RunCredentialRepairRequired } from "../src/run-credential-launch";

afterEach(() => vi.restoreAllMocks());

describe("vendor-authenticated run launch", () => {
  it("requires repair before provisioning when a selected credential is missing", async () => {
    const database = {pool: {query: vi.fn(async (sql: string) => {
      if (sql.includes("SELECT user_id,session_version")) return {rows: [{user_id: "owner", session_version: 1}]};
      if (sql.includes("INSERT INTO app.run_authorizations")) return {rows: []};
      if (sql.includes("run_credential_revocations")) return {rows: [], rowCount: 0};
      if (sql.includes("FROM app.integration_records")) return {rows: []};
      throw new Error("Unexpected query");
    })}};
    const scheduler: any = new RunScheduler(database as any, {CREDENTIAL_ENCRYPTION_KEY: btoa("a".repeat(32))} as any);
    const backend = vi.spyOn(scheduler, "backend");
    await expect(scheduler.launch({id: "00000000-0000-4000-8000-000000000001", tenantId: "tenant", executionConfig: {portableIntegrationIds: ["00000000-0000-4000-8000-000000000002"]}})).rejects.toBeInstanceOf(RunCredentialRepairRequired);
    expect(backend).not.toHaveBeenCalled();
  });

  it.each(["codex", "claude", "pi", "code"])("launches %s with public identity configuration and snapshotted scopes", async agentKind => {
    const runId = "00000000-0000-4000-8000-000000000001", key = btoa("a".repeat(32));
    let issuedScopes: unknown;
    const database = { pool: { query: async (sql: string, values: unknown[] = []) => {
      if (sql.includes("SELECT user_id,session_version")) return { rows: [{ user_id: "owner", session_version: 1 }] };
      if (sql.includes("INSERT INTO app.run_authorizations")) { issuedScopes = JSON.parse(String(values[4])); return { rows: [] }; }
      if (sql.includes("run_credential_revocations")) return {rows: [], rowCount: 0};
      throw new Error("Unexpected database operation");
    } } };
    const env = { DATABASE: database, APP_ORIGIN: "https://app.test", CREDENTIAL_ENCRYPTION_KEY: key } as any;
    const scheduler: any = new RunScheduler(database as any, env);
    const backend = new ExeVmBackend({ apiToken: "control-plane-token", agentKind: (agentKind === "code" ? "codex" : agentKind) as any, tags: [] });
    vi.spyOn(scheduler, "backend").mockResolvedValue(backend);
    const launch = vi.spyOn(backend, "launch").mockResolvedValue({ handle: { backendKind: "exe-vm", id: "factorize-run" }, observation: { state: "running" }, capabilities: [], destinationUrl: "https://vm.test" });
    vi.spyOn(RunRepository.prototype, "markLaunched").mockResolvedValue();
    const recordHandle = vi.spyOn(RunRepository.prototype, "recordLaunchHandle").mockResolvedValue();
    await scheduler.launch({ id: runId, tenantId: "tenant", executionConfig: { agentKind, runScopes: ["jobs:read", "jobs:write"], ...(agentKind === "code" ? { executionType: "code", script: "echo test", inputContext: {} } : {}) }, encryptedPrompt: await encrypt("Complete the task", key) });
    const request = launch.mock.calls[0][0];
    expect(recordHandle.mock.invocationCallOrder[0]).toBeLessThan(launch.mock.invocationCallOrder[0]);
    expect(request).not.toHaveProperty("runProxy");
    expect(request.runIdentity).toEqual({backendOrigin: env.APP_ORIGIN});
    expect(typeof request.verifyVendorIdentity).toBe("function");
    expect(issuedScopes).toEqual(["jobs:read", "jobs:write"]);
    if (agentKind === "code") { expect(request.code?.script).toBe("echo test"); return; }
    expect(request.harness?.env).toHaveProperty("FACTORIZE_RESULT_PATH");
    expect(request.harness?.env).not.toHaveProperty("FACTORIZE_API_URL");
    expect(request.harness?.env).not.toHaveProperty("FACTORIZE_RUN_TOKEN");
    expect(request.prompt).toContain("http://127.0.0.1:18180");
    expect(request.prompt).not.toContain("fzt_run_");
    expect(request.prompt).not.toContain(env.APP_ORIGIN);
  });
});
