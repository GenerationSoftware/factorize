import { afterEach, describe, expect, it, vi } from "vitest";
import { ExeVmBackend } from "../src/exe-vm-backend";
import { HARNESS_LOG_LIMIT, safeDiagnosticText, terminalDiagnostics } from "../src/harness-diagnostics";
import { agentDriver } from "../src/agent-driver";

afterEach(() => vi.unstubAllGlobals());
const handle = { backendKind: "exe-vm", id: "factorize-test" };
const backend = () => new ExeVmBackend({ apiToken: "secret", tags: [] });

describe("harness diagnostics", () => {
  it.each(["codex", "claude", "pi"] as const)("separates %s stderr from stdout", async agentKind => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      requests.push(String(init.body));
      return new Response(requests.length === 1 ? "created" : "started");
    }));
    await new ExeVmBackend({ apiToken: "secret", tags: [], agentKind, model: "", effort: "" }).launch({ runId: "test", prompt: "work", harness: agentDriver(agentKind).launch("test", {}) });
    expect(requests[1]).toContain("StandardError=append:/tmp/factorize.stderr");
    expect(requests[1]).toContain("StandardOutput=append:/tmp/factorize.log");
  });

  it.each([503, 429, 408, 422])("keeps an inspection failure (%s) nonterminal", async status => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("password=do-not-store", { status })));
    expect(await backend().inspect(handle)).toEqual({ state: "running", detail: `VM inspection is temporarily unavailable (${status})` });
  });
  it("keeps transport and incomplete metadata failures nonterminal", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("connection reset")).mockResolvedValueOnce(new Response("LoadState=loaded")));
    expect((await backend().inspect(handle)).state).toBe("running");
    expect((await backend().inspect(handle)).state).toBe("running");
  });
  it("records missing supervisor metadata even when systemctl exits nonzero", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("LoadState=not-found\nActiveState=inactive\nSubState=dead", { headers: { "X-Exe-Exit": "1" } })));
    expect(await backend().inspect(handle)).toMatchObject({ state: "failed", systemd: { loadState: "not-found", activeState: "inactive", subState: "dead", execMainCode: null }, detail: expect.stringContaining("supervisor disappeared") });
  });
  it("retains stderr while redacting credentials and bounding bytes", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      expect(String(init.body)).toContain(`head -c ${HARNESS_LOG_LIMIT}`);
      return new Response('recognizable harness failure\nAuthorization: Bearer secret-value\n{"password": "long secret value"}\nhttps://example.test/?token=hidden\n');
    }));
    const log = await backend().readHarnessLog(handle);
    expect(log).toContain("recognizable harness failure");
    for (const secret of ["secret-value", "long secret value", "hidden"]) expect(log).not.toContain(secret);
    expect(new TextEncoder().encode(safeDiagnosticText("漢".repeat(HARNESS_LOG_LIMIT), HARNESS_LOG_LIMIT)).length).toBeLessThanOrEqual(HARNESS_LOG_LIMIT);
  });
  it("redacts quoted assignments before a generic scrubber can remove their key", () => {
    expect(safeDiagnosticText("password='a longer secret'\nAPI_KEY=secret with spaces\n-----BEGIN PRIVATE KEY-----\nprivate material")).not.toMatch(/longer|with spaces|private material/);
  });
  it("retains signal termination metadata", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("LoadState=loaded\nActiveState=failed\nSubState=failed\nResult=signal\nExecMainCode=2\nExecMainStatus=9")));
    expect(await backend().inspect(handle)).toMatchObject({ state: "failed", systemd: { result: "signal", execMainCode: 2, execMainStatus: 9 } });
  });
  it("drops a truncated last line that might contain a partial secret", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("first line\n" + "x".repeat(HARNESS_LOG_LIMIT))));
    expect(await backend().readHarnessLog(handle)).toBe("first line\n\n[Harness log truncated]\n");
  });
  it("does not persist backend commands or raw responses", () => {
    const value = terminalDiagnostics({ state: "failed", detail: "Bearer secret", command: { ok: false, status: 500, exitCode: 42, requestBody: "private command", body: "private response" } });
    expect(value).toEqual({ state: "failed", detail: "[REDACTED]", systemd: null });
  });
});
