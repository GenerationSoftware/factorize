import { afterEach, describe, expect, it, vi } from "vitest";
import { terminalDiagnostics } from "../src/harness-diagnostics";
import { RunScheduler } from "../src/postgres/run-scheduler";
import { RunRepository } from "../src/postgres/run-repository";
import { ArtifactRepository } from "../src/postgres/artifact-repository";
import { FlyJobExecutionBackend } from "../src/fly-job-execution-backend";
import { FlyClientError, type FlyMachine } from "../src/fly-machines-client";

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

function localFlyFixture(options: { ambiguousCreate?: boolean; failFirstInspect?: boolean; failFirstResult?: boolean; failFirstDestroy?: boolean; jobFiles?: string[] } = {}) {
  const events: string[] = [];
  const runId = "11111111-1111-4111-8111-111111111111";
  let machine: FlyMachine | undefined = options.ambiguousCreate ? undefined : {
    id: "machine-1", state: "started", config: { metadata: { factorize_operation_id: runId } },
  };
  let resultReads = 0;
  let inspections = 0;
  let destroys = 0;
  const machines = {
    findMachineByOperationId: vi.fn(async (_app: string, operationId: string) =>
      machine?.config?.metadata?.factorize_operation_id === operationId ? machine : undefined),
    createMachine: vi.fn(async (_app: string, config: any, operationId: string) => {
      events.push("create");
      machine = { id: "machine-1", state: "created", config: { ...config, metadata: { ...config.metadata, factorize_operation_id: operationId } } };
      if (options.ambiguousCreate) throw new FlyClientError("Fly Machine creation outcome is ambiguous", "ambiguous_create");
      return machine;
    }),
    inspectMachine: vi.fn(async () => {
      if (options.failFirstInspect && inspections++ === 0) { events.push("inspect-timeout"); throw new FlyClientError("Fly request timed out", "timeout"); }
      if (!machine) throw new Error("Machine is missing");
      events.push(`inspect:${machine.state}`); return machine;
    }),
    startMachine: vi.fn(async () => { if (machine) machine.state = "started"; events.push("start"); }),
    stopMachine: vi.fn(async () => { if (machine) machine.state = "stopped"; events.push("stop"); }),
    destroyMachine: vi.fn(async () => {
      events.push("destroy");
      if (options.failFirstDestroy && destroys++ === 0) throw new Error("local Fly fixture destroy response timed out");
      if (machine) machine.state = "destroyed";
    }),
  };
  const guest = {
    run: vi.fn(async (command: readonly string[]) => {
      if (command.at(-1) === "status") return { ok: true, exitCode: 0, stdout: JSON.stringify({ state: "exited", exitCode: 0 }), stderr: "" };
      if (command.at(-1)?.startsWith("find ")) return { ok: true, exitCode: 0, stdout: (options.jobFiles ?? []).map(path => `${path}\t4`).join("\n"), stderr: "" };
      return { ok: true, exitCode: 0, stdout: "", stderr: "" };
    }),
    download: vi.fn(async (path: string) => {
      events.push(path.endsWith("results.json") ? "result" : "log");
      if (path.endsWith("results.json") && options.failFirstResult && resultReads++ === 0) throw new Error("local guest result transport timed out");
      if (path.endsWith("report.json")) events.push("download-job-file");
      return new TextEncoder().encode(path.endsWith("results.json") ? '{"status":"succeeded"}' : "local Fly guest log\n");
    }),
  };
  const backend = new FlyJobExecutionBackend({ app: "factorize-test", image: "local/image", region: "iad", size: "shared-cpu-1x", machines, guest: () => guest });
  return { backend, machines, guest, events };
}

function schedulerForLocalFly(backend: FlyJobExecutionBackend) {
  const stored: any[] = [], events: string[] = [];
  const run: any = {
    tenantId: "tenant", id: "11111111-1111-4111-8111-111111111111", jobId: "job", state: "running",
    executionConfig: { executionProvider: "fly", executionType: "code" },
    executionHandle: { backendKind: "fly", id: "factorize-test/machine-1", operationId: "11111111-1111-4111-8111-111111111111" },
    resultProtocolVersion: 1, finalizationAttempt: 0,
  };
  vi.spyOn(RunRepository.prototype, "recordObservation").mockImplementation(async (_run, value) => {
    events.push("observation");
    return terminalDiagnostics(value);
  });
  vi.spyOn(RunRepository.prototype, "recordJobResult").mockImplementation(async () => { events.push("persist-result"); });
  vi.spyOn(RunRepository.prototype, "terminal").mockImplementation(async () => { events.push("terminal"); });
  vi.spyOn(RunRepository.prototype, "retryFinalization").mockImplementation(async () => { run.finalizationAttempt++; events.push("retry"); });
  vi.spyOn(RunRepository.prototype, "markLaunched").mockImplementation(async (_run, handle) => { run.executionHandle = handle; events.push("mark-launched"); });
  vi.spyOn(RunRepository.prototype, "schedulePoll").mockImplementation(async () => { events.push("schedule-poll"); });
  vi.spyOn(ArtifactRepository.prototype, "list").mockImplementation(async () => stored);
  vi.spyOn(ArtifactRepository.prototype, "record").mockImplementation(async item => { stored.push({ ...item, state: "stored" }); });
  const scheduler: any = new RunScheduler({} as any, {
    SESSION_SIGNING_SECRET: "test-signing-secret", APP_ORIGIN: "https://app.example.test",
    RUN_ARTIFACTS: { put: async () => { events.push("store-log"); } },
  } as any);
  vi.spyOn(scheduler, "backend").mockResolvedValue(backend);
  return { scheduler, run, stored, events };
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

  it("recovers an ambiguously timed out create through the persisted scheduler operation handle", async () => {
    const fly = localFlyFixture({ ambiguousCreate: true });
    const f = schedulerForLocalFly(fly.backend);
    f.run.state = "starting";
    const reservation = fly.backend.reserve(f.run.id);
    vi.spyOn(RunRepository.prototype, "recordLaunchHandle").mockImplementation(async (_run, handle) => { f.run.executionHandle = handle; });

    await f.scheduler.runs.recordLaunchHandle(f.run, reservation);
    await expect(fly.backend.launch({ runId: f.run.id, reservation, prompt: "" })).rejects.toMatchObject({ kind: "ambiguous_create" });
    await f.scheduler.fail(f.run, new FlyClientError("Fly Machine creation outcome is ambiguous", "ambiguous_create"), "launch");
    await f.scheduler.poll(f.run);

    expect(fly.machines.createMachine).toHaveBeenCalledTimes(1);
    expect(fly.machines.findMachineByOperationId).toHaveBeenCalledWith("factorize-test", f.run.id);
    expect(f.run.executionHandle).toEqual(reservation);
    expect(f.events).toContain("schedule-poll");
  });

  it("retries a transient Fly inspection timeout without losing or destroying the Machine", async () => {
    const fly = localFlyFixture({ failFirstInspect: true });
    const f = schedulerForLocalFly(fly.backend);
    await f.scheduler.poll(f.run).catch((error: unknown) => f.scheduler.fail(f.run, error, "poll"));

    expect(f.events).toEqual(["schedule-poll"]);
    expect(fly.events).toEqual(["inspect-timeout"]);
    expect(fly.machines.destroyMachine).not.toHaveBeenCalled();

    await f.scheduler.poll(f.run);
    expect(fly.events).toContain("result");
    expect(fly.machines.destroyMachine).toHaveBeenCalledTimes(1);
    expect(f.events.at(-1)).toBe("terminal");
  });

  it("retries structured result collection on the same Fly Machine before cleanup", async () => {
    const fly = localFlyFixture({ failFirstResult: true });
    const f = schedulerForLocalFly(fly.backend);
    await f.scheduler.poll(f.run).catch((error: unknown) => f.scheduler.fail(f.run, error, "poll"));

    expect(fly.events).toEqual(["inspect:started", "result"]);
    expect(f.events).toEqual(["observation", "retry"]);
    expect(fly.machines.destroyMachine).not.toHaveBeenCalled();
    expect(f.run.finalizationAttempt).toBe(1);

    await f.scheduler.poll(f.run);
    expect(fly.events).toContain("destroy");
    expect(fly.events.filter(event => event === "result")).toHaveLength(2);
    expect(f.events).toContain("terminal");
  });

  it("recovers a timed out Fly destroy during finalization without losing collected results", async () => {
    const fly = localFlyFixture({ failFirstDestroy: true });
    const f = schedulerForLocalFly(fly.backend);
    await f.scheduler.poll(f.run);
    expect(fly.events.indexOf("result")).toBeLessThan(fly.events.indexOf("destroy"));
    expect(f.events).toEqual(["observation", "persist-result", "store-log", "retry"]);
    expect(f.run.finalizationAttempt).toBe(1);

    await f.scheduler.poll(f.run);
    expect(fly.machines.destroyMachine).toHaveBeenCalledTimes(2);
    expect(f.events.at(-1)).toBe("terminal");
  });

  it("collects and uploads Fly job files before destroying the Machine", async () => {
    const fly = localFlyFixture({ jobFiles: ["report.json"] });
    const f = schedulerForLocalFly(fly.backend);
    vi.stubGlobal("fetch", vi.fn(async () => {
      fly.events.push("upload-job-file");
      return new Response(null, { status: 200 });
    }));

    await f.scheduler.poll(f.run);

    expect(fly.events.indexOf("download-job-file")).toBeGreaterThanOrEqual(0);
    expect(fly.events.indexOf("download-job-file")).toBeLessThan(fly.events.indexOf("destroy"));
    expect(fly.events.indexOf("upload-job-file")).toBeLessThan(fly.events.indexOf("destroy"));
    expect(fly.guest.download).toHaveBeenCalledWith("/home/exedev/.factorize-job/report.json");
    expect(f.events.at(-1)).toBe("terminal");
  });
});
