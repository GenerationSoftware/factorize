import { describe, expect, it, vi } from "vitest";
import { FlyJobExecutionBackend } from "../src/fly-job-execution-backend";

const machine = { id: "machine-1", state: "created" };
function fixture() {
  const machines = {
    createMachine: vi.fn(async () => machine),
    inspectMachine: vi.fn(async () => machine),
    startMachine: vi.fn(async () => undefined),
    stopMachine: vi.fn(async () => undefined),
    destroyMachine: vi.fn(async () => undefined),
  };
  const guest = { run: vi.fn(async () => ({ ok: true, exitCode: 0, stdout: "started\n", stderr: "" })) };
  const backend = new FlyJobExecutionBackend({ app: "factorize-test", image: "ghcr.io/acme/code:v1", region: "iad", size: "shared-cpu-1x", machines, guest: () => guest });
  return { backend, machines, guest };
}

describe("Fly job execution backend", () => {
  it("reserves a stable launch identity and delivers code payload after starting the Machine", async () => {
    const f = fixture();
    const runId = "11111111-1111-4111-8111-111111111111";
    const reservation = f.backend.reserve!(runId);
    const receipt = await f.backend.launch({ runId, reservation, prompt: "", code: { script: "echo ok", context: { value: 1 } } });
    expect(f.machines.createMachine).toHaveBeenCalledWith("factorize-test", expect.objectContaining({ auto_start: false, restart: { policy: "no" } }), runId);
    expect(f.machines.startMachine).toHaveBeenCalledWith("factorize-test", "machine-1");
    expect(f.guest.run).toHaveBeenCalledWith(["/usr/local/bin/factorize-job", "launch"], expect.stringContaining('"script":"echo ok"'));
    expect(receipt).toMatchObject({ handle: { backendKind: "fly", id: "factorize-test/machine-1" }, observation: { state: "running" } });
    expect(JSON.stringify(f.machines.createMachine.mock.calls)).not.toContain("echo ok");
  });

  it("retains provider cleanup ownership when guest startup fails", async () => {
    const f = fixture();
    f.guest.run.mockResolvedValue({ ok: false, exitCode: 1, stdout: "", stderr: "failure" });
    const receipt = await f.backend.launch({ runId: "11111111-1111-4111-8111-111111111111", prompt: "" });
    expect(receipt.handle.id).toBe("factorize-test/machine-1");
    expect(receipt.observation).toMatchObject({ state: "failed", failure: { code: "launch_failed" } });
  });

  it("destroys a stopped Machine after confirming provider state", async () => {
    const f = fixture();
    f.machines.inspectMachine.mockResolvedValue({ ...machine, state: "stopped" });
    await expect(f.backend.stop({ backendKind: "fly", id: "factorize-test/machine-1" })).resolves.toEqual({ state: "stopped" });
    expect(f.machines.destroyMachine).toHaveBeenCalledWith("factorize-test", "machine-1");
  });
});
