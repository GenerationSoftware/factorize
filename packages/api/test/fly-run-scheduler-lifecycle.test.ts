import { afterEach, describe, expect, it, vi } from "vitest";
import { terminalDiagnostics } from "../src/harness-diagnostics";
import { RunScheduler } from "../src/postgres/run-scheduler";
import { RunRepository } from "../src/postgres/run-repository";
import { ArtifactRepository } from "../src/postgres/artifact-repository";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function fixture() {
  const events: string[] = [], stored: any[] = [];
  let observation: any;
  const machine = { backendKind: "fly", id: "factorize-test/machine-1" };
  const backend = {
    kind: "fly", capabilities: ["stop", "recovery"],
    inspect: vi.fn(async () => ({ state: "succeeded" })),
    terminate: vi.fn(async () => { events.push("terminate"); return { state: "stopped" }; }),
    stop: vi.fn(async () => { events.push("destroy"); return { state: "stopped" }; }),
    readJobResult: vi.fn(async () => { events.push("result"); return '{"status":"succeeded"}'; }),
    readHarnessLog: vi.fn(async () => { events.push("log"); return "Fly guest log\n"; }),
    listJobFiles: vi.fn(async () => []),
    collectJobFile: vi.fn(),
    collectArtifact: vi.fn(),
  };
  const run: any = {
    tenantId: "tenant", id: "run", jobId: "job", state: "stopping",
    executionConfig: { executionProvider: "fly", executionType: "code" },
    executionHandle: machine, resultProtocolVersion: 1, finalizationAttempt: 0,
  };
  vi.spyOn(RunRepository.prototype, "recordStopAttempt").mockResolvedValue();
  vi.spyOn(RunRepository.prototype, "recordObservation").mockImplementation(async (_run, value) => {
    events.push("observation"); observation ??= terminalDiagnostics(value); return observation;
  });
  vi.spyOn(RunRepository.prototype, "recordJobResult").mockImplementation(async () => { events.push("persist-result"); });
  vi.spyOn(RunRepository.prototype, "terminal").mockImplementation(async () => { events.push("terminal"); });
  vi.spyOn(RunRepository.prototype, "retryFinalization").mockImplementation(async () => { run.finalizationAttempt++; events.push("retry"); });
  vi.spyOn(ArtifactRepository.prototype, "list").mockImplementation(async () => stored);
  vi.spyOn(ArtifactRepository.prototype, "record").mockImplementation(async item => { stored.push({ ...item, state: "stored" }); });
  const scheduler: any = new RunScheduler({} as any, {
    SESSION_SIGNING_SECRET: "test-signing-secret", APP_ORIGIN: "https://app.example.test",
    RUN_ARTIFACTS: { put: async () => { events.push("store-log"); } },
  } as any);
  vi.spyOn(scheduler, "backend").mockResolvedValue(backend);
  return { scheduler, run, backend, events, stored };
}

describe("Fly scheduler lifecycle", () => {
  it("collects a cancelled guest's log before destroying its Machine", async () => {
    const f = fixture();
    await f.scheduler.poll(f.run).catch((error: unknown) => f.scheduler.fail(f.run, error, "poll"));
    expect(f.events).toEqual(["terminate", "observation", "log", "store-log", "destroy", "terminal"]);
    expect(f.backend.stop).toHaveBeenCalledWith(f.run.executionHandle);
    expect(f.scheduler.runs.terminal).toHaveBeenCalledWith(f.run, "stopped", "stored", undefined, true, undefined);
  });

  it("keeps a Fly Machine available when result collection needs a retry", async () => {
    const f = fixture();
    f.run.state = "running";
    f.backend.readJobResult.mockImplementationOnce(async () => { f.events.push("result"); throw new Error("guest transport unavailable"); });
    await f.scheduler.poll(f.run).catch((error: unknown) => f.scheduler.fail(f.run, error, "poll"));
    expect(f.events).toEqual(["observation", "result", "retry"]);
    expect(f.backend.stop).not.toHaveBeenCalled();
    expect(f.run.finalizationAttempt).toBe(1);
  });
});
