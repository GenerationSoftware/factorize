import { afterEach, describe, expect, it, vi } from "vitest";
import { RunScheduler } from "../src/postgres/run-scheduler";
import { RunRepository } from "../src/postgres/run-repository";
import { ExeVmBackend } from "../src/exe-vm-backend";
import { encrypt } from "../src/crypto";
import { runProxyName } from "../src/run-credentials";

afterEach(() => vi.restoreAllMocks());

describe("control-plane run credential delivery", () => {
  it.each(["codex", "claude", "pi"])("keeps %s proxy credentials out of the guest environment and prompt", async agentKind => {
    const runId = "00000000-0000-4000-8000-000000000001", key = btoa("a".repeat(32));
    const database = { pool: { query: async (sql: string) => {
      if (sql.includes("SELECT user_id,session_version")) return { rows: [{ user_id: "owner", session_version: 1 }] };
      if (sql.includes("INSERT INTO app.run_credentials")) return { rows: [] };
      throw new Error("Unexpected database operation");
    } } };
    const env = { DATABASE: database, APP_ORIGIN: "https://app.test", CREDENTIAL_ENCRYPTION_KEY: key } as any;
    const scheduler: any = new RunScheduler(database as any, env);
    const backend = new ExeVmBackend({ apiToken: "control-plane-token", agentKind: agentKind as any, tags: [] });
    vi.spyOn(scheduler, "backend").mockResolvedValue(backend);
    const launch = vi.spyOn(backend, "launch").mockResolvedValue({ handle: { backendKind: "exe-vm", id: "factorize-run" }, observation: { state: "running" }, capabilities: [], destinationUrl: "https://vm.test" });
    vi.spyOn(RunRepository.prototype, "markLaunched").mockResolvedValue();
    const recordHandle = vi.spyOn(RunRepository.prototype, "recordLaunchHandle").mockResolvedValue();
    await scheduler.launch({ id: runId, tenantId: "tenant", executionConfig: { agentKind }, encryptedPrompt: await encrypt("Complete the task", key) });
    const request = launch.mock.calls[0][0];
    expect(recordHandle.mock.invocationCallOrder[0]).toBeLessThan(launch.mock.invocationCallOrder[0]);
    expect(request.runProxy?.credential).toMatch(/^fzt_run_/);
    expect(request.runProxy?.targetOrigin).toBe(env.APP_ORIGIN);
    expect(request.harness?.env).toHaveProperty("FACTORIZE_RESULT_PATH");
    expect(request.harness?.env).not.toHaveProperty("FACTORIZE_API_URL");
    expect(request.harness?.env).not.toHaveProperty("FACTORIZE_RUN_TOKEN");
    expect(request.prompt).toContain(runProxyName(runId));
    expect(request.prompt).toContain("reflection.int.exe.xyz/integrations");
    expect(request.prompt).not.toContain(request.runProxy!.credential);
    expect(request.prompt).not.toContain(env.APP_ORIGIN);
  });
});
