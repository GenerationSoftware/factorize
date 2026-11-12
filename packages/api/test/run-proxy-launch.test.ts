import { afterEach, describe, expect, it, vi } from "vitest";
import { RunScheduler } from "../src/postgres/run-scheduler";
import { RunRepository } from "../src/postgres/run-repository";
import { ExeVmBackend } from "../src/exe-vm-backend";
import { encrypt } from "../src/crypto";
import { runProxyName } from "../src/run-credentials";
import { ProxyLaunchBlockedError } from "../src/proxy-launch-policy";

afterEach(() => vi.restoreAllMocks());

describe("control-plane run credential delivery", () => {
  it("persists a pre-launch block when a credential-dependent job has no fresh unlocked proxy status", async () => {
    const database = { pool: { query: vi.fn() } };
    const scheduler: any = new RunScheduler(database as any, {} as any);
    vi.spyOn(scheduler, "proxyLaunchState").mockResolvedValue({ enabled: true, running: true, unlocked: false, pendingChanges: false });
    await expect(scheduler.launch({
      id: "00000000-0000-4000-8000-000000000001", tenantId: "tenant",
      executionConfig: { executionProvider: "fly", executionType: "agent", modelAccess: "portable", modelAccountId: "account" },
    })).rejects.toEqual(new ProxyLaunchBlockedError("proxy_locked"));
  });

  it.each(["codex", "claude", "pi", "code"])("keeps %s proxy credentials out of the guest environment and prompt", async agentKind => {
    const runId = "00000000-0000-4000-8000-000000000001", key = btoa("a".repeat(32));
    let issuedScopes: unknown;
    const database = { pool: { query: async (sql: string, values: unknown[] = []) => {
      if (sql.includes("SELECT user_id,session_version")) return { rows: [{ user_id: "owner", session_version: 1 }] };
      if (sql.includes("INSERT INTO app.run_credentials")) { issuedScopes = JSON.parse(String(values[6])); return { rows: [] }; }
      throw new Error("Unexpected database operation");
    } } };
    const env = { DATABASE: database, APP_ORIGIN: "https://app.test", CREDENTIAL_ENCRYPTION_KEY: key } as any;
    const scheduler: any = new RunScheduler(database as any, env);
    vi.spyOn(scheduler, "proxyLaunchState").mockResolvedValue({ enabled: true, running: true, unlocked: true, pendingChanges: false });
    const backend = new ExeVmBackend({ apiToken: "control-plane-token", agentKind: (agentKind === "code" ? "codex" : agentKind) as any, tags: [] });
    vi.spyOn(scheduler, "backend").mockResolvedValue(backend);
    const launch = vi.spyOn(backend, "launch").mockResolvedValue({ handle: { backendKind: "exe-vm", id: "factorize-run" }, observation: { state: "running" }, capabilities: [], destinationUrl: "https://vm.test" });
    vi.spyOn(RunRepository.prototype, "markLaunched").mockResolvedValue();
    const recordHandle = vi.spyOn(RunRepository.prototype, "recordLaunchHandle").mockResolvedValue();
    await scheduler.launch({ id: runId, tenantId: "tenant", executionConfig: { agentKind, runScopes: ["jobs:read", "jobs:write"], ...(agentKind === "code" ? { executionType: "code", script: "echo test", inputContext: {} } : {}) }, encryptedPrompt: await encrypt("Complete the task", key) });
    const request = launch.mock.calls[0][0];
    expect(recordHandle.mock.invocationCallOrder[0]).toBeLessThan(launch.mock.invocationCallOrder[0]);
    expect(request.runProxy?.credential).toMatch(/^fzt_run_/);
    expect(request.runProxy?.targetOrigin).toBe(env.APP_ORIGIN);
    expect(issuedScopes).toEqual(["jobs:read", "jobs:write"]);
    if (agentKind === "code") { expect(request.code?.script).toBe("echo test"); return; }
    expect(request.harness?.env).toHaveProperty("FACTORIZE_RESULT_PATH");
    expect(request.harness?.env).not.toHaveProperty("FACTORIZE_API_URL");
    expect(request.harness?.env).not.toHaveProperty("FACTORIZE_RUN_TOKEN");
    expect(request.prompt).toContain(runProxyName(runId));
    expect(request.prompt).toContain("reflection.int.exe.xyz/integrations");
    expect(request.prompt).not.toContain(request.runProxy!.credential);
    expect(request.prompt).not.toContain(env.APP_ORIGIN);
  });
});
