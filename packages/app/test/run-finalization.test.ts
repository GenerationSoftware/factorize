import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RunScheduler } from "../src/postgres/run-scheduler";
import { RunRepository } from "../src/postgres/run-repository";
import { ArtifactRepository } from "../src/postgres/artifact-repository";
import { ExeVmBackend } from "../src/exe-vm-backend";
import { terminalDiagnostics, type ExecutionDiagnostics } from "../src/harness-diagnostics";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function fixture(exit = 42) {
  const harness = spawnSync("bash", ["-c", `printf 'recognizable harness error\\n' >&2; exit ${exit}`], { encoding: "utf8" });
  const events: string[] = [], artifacts: any[] = [], blobs = new Map<string, string>();
  let saved: ExecutionDiagnostics | null = null;
  const backend = new ExeVmBackend({ apiToken: "secret", tags: [] });
  const run: any = { tenantId: "tenant", id: "run", jobId: "job", executionTarget: { agentKind: "codex" }, executionHandle: { backendKind: "exe-vm", id: "factorize-run" }, finalizationAttempt: 0 };
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => new Response(String(init.body).includes("systemctl")
    ? `LoadState=loaded\nActiveState=${exit ? "failed" : "active"}\nSubState=${exit ? "failed" : "exited"}\nResult=${exit ? "exit-code" : "success"}\nExecMainCode=1\nExecMainStatus=${harness.status}`
    : harness.stderr)));
  const recordObservation = vi.spyOn(RunRepository.prototype, "recordObservation").mockImplementation(async (_run, observation) => {
    events.push("observation"); saved ??= terminalDiagnostics(observation); return saved;
  });
  const terminal = vi.spyOn(RunRepository.prototype, "terminal").mockResolvedValue();
  const retry = vi.spyOn(RunRepository.prototype, "retryFinalization").mockImplementation(async () => { run.finalizationAttempt++; });
  const schedule = vi.spyOn(RunRepository.prototype, "schedulePoll").mockResolvedValue();
  vi.spyOn(ArtifactRepository.prototype, "list").mockImplementation(async () => artifacts);
  const put = vi.fn(async (key, bytes) => { events.push("log"); blobs.set(key, new TextDecoder().decode(bytes)); });
  const scheduler: any = new RunScheduler({} as any, { RUN_ARTIFACTS: { put } } as any);
  vi.spyOn(scheduler, "backend").mockResolvedValue(backend);
  const native = vi.spyOn(scheduler, "collectArtifact").mockImplementation(async () => { events.push("native"); artifacts.push({ kind: "native_session", state: "stored" }); return { ok: true }; });
  // Match the state returned by PostgreSQL for a recorded harness artifact.
  vi.spyOn(ArtifactRepository.prototype, "record").mockImplementation(async item => { artifacts.push({ ...item, state: "stored" }); });
  const stop = vi.spyOn(backend, "stop").mockImplementation(async () => { events.push("cleanup"); return { state: "stopped" }; });
  return { scheduler, run, backend, terminal, retry, schedule, stop, native, put, blobs, artifacts, events, recordObservation, saved: () => saved };
}

describe("durable run finalization", () => {
  it("stores real nonzero harness stderr and exit metadata before deleting the VM", async () => {
    const f = fixture();
    await f.scheduler.poll(f.run);
    expect(f.saved()).toMatchObject({ state: "failed", detail: expect.stringContaining("ExecMainStatus=42"), systemd: { result: "exit-code", execMainCode: 1, execMainStatus: 42, activeState: "failed", subState: "failed" } });
    expect([...f.blobs.values()]).toEqual(["recognizable harness error\n"]);
    expect(f.artifacts.find(a => a.kind === "terminal_log")).toMatchObject({ objectKey: "tenants/tenant/runs/run/harness/stderr.txt", format: "text", byteSize: 27, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(f.events).toEqual(["observation", "log", "native", "cleanup"]);
    expect(f.terminal).toHaveBeenCalledWith(f.run, "failed", "stored", undefined, true);
  });
  it("keeps successful native sessions and normal cleanup", async () => {
    const f = fixture(0);
    await f.scheduler.poll(f.run);
    expect(f.native).toHaveBeenCalledOnce();
    expect(f.stop).toHaveBeenCalledOnce();
    expect(f.terminal).toHaveBeenCalledWith(f.run, "succeeded", "stored", undefined, true);
  });
  it.each(["native", "put"] as const)("bounds %s upload retries without replacing the primary failure", async target => {
    const f = fixture();
    f[target].mockRejectedValue(new Error("Authorization: Bearer sensitive"));
    await f.scheduler.poll(f.run);
    const first = f.saved();
    expect(f.stop).not.toHaveBeenCalled();
    await f.scheduler.poll(f.run);
    await f.scheduler.poll(f.run);
    expect(f.saved()).toEqual(first);
    expect(f.retry).toHaveBeenCalledTimes(2);
    expect(f.stop).toHaveBeenCalledOnce();
    expect(f.terminal).toHaveBeenCalledWith(f.run, "failed", "partial", expect.stringContaining(target === "put" ? "Harness" : "Native"), true);
    expect(JSON.stringify(f.terminal.mock.calls)).not.toContain("sensitive");
  });
  it("retries cleanup using the original observation even if inspection later reports missing", async () => {
    const f = fixture();
    f.stop.mockResolvedValueOnce({ state: "failed", detail: "cleanup error" });
    await f.scheduler.poll(f.run);
    const first = f.saved();
    const inspect = vi.spyOn(f.backend, "inspect").mockResolvedValue({ state: "failed", detail: "supervisor missing" });
    await f.scheduler.poll(f.run);
    expect(inspect).not.toHaveBeenCalled();
    expect(f.saved()).toEqual(first);
    expect(f.put).toHaveBeenCalledOnce();
    expect(f.native).toHaveBeenCalledOnce();
    expect(f.terminal).toHaveBeenCalledWith(f.run, "failed", "stored", undefined, true);
  });
  it("persists missing supervisor as the original cause even if artifact collection also fails", async () => {
    const f = fixture();
    vi.spyOn(f.backend, "inspect").mockResolvedValue({ state: "failed", detail: "The run supervisor disappeared before recording a result." });
    f.native.mockRejectedValue(new Error("missing session"));
    f.run.finalizationAttempt = 2;
    await f.scheduler.poll(f.run);
    expect(f.saved()?.detail).toContain("supervisor disappeared");
    expect(f.terminal).toHaveBeenCalledWith(f.run, "failed", "partial", expect.any(String), true);
  });
  it("does not finalize or delete on a temporary inspection failure", async () => {
    const f = fixture();
    vi.spyOn(f.backend, "inspect").mockResolvedValue({ state: "running", detail: "temporarily unavailable" });
    vi.spyOn(f.scheduler, "collectTraceChunk").mockResolvedValue({ ok: true });
    await f.scheduler.poll(f.run);
    expect(f.schedule).toHaveBeenCalled();
    expect(f.recordObservation).not.toHaveBeenCalled();
    expect(f.stop).not.toHaveBeenCalled();
  });
});
