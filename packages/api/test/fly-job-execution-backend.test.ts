import { describe, expect, it, vi } from "vitest";
import { FlyJobExecutionBackend } from "../src/fly-job-execution-backend";

const machine = { id: "machine-1", state: "created" };
function fixture() {
  const machines = {
    findMachineByOperationId: vi.fn(async () => machine),
    createMachine: vi.fn(async () => machine),
    inspectMachine: vi.fn(async () => machine),
    startMachine: vi.fn(async () => undefined),
    stopMachine: vi.fn(async () => undefined),
    destroyMachine: vi.fn(async () => undefined),
  };
  const guest = {
    run: vi.fn(async (_command: readonly string[], _input?: string | Uint8Array) => ({ ok: true, exitCode: 0, stdout: "started\n", stderr: "" })),
    download: vi.fn(async (path: string) => new TextEncoder().encode(path.endsWith("results.json") ? '{"status":"succeeded"}' : "saved log")),
  };
  const proxyGuest = { run: vi.fn(async () => ({ ok: true, exitCode: 0, stdout: "Run credential delivered to proxy memory\n", stderr: "" })) };
  const backend = new FlyJobExecutionBackend({ app: "factorize-test", image: "ghcr.io/acme/code:v1", region: "iad", size: "shared-cpu-1x", machines, guest: () => guest,
    proxyIdentity: "fly:factorize-test:proxy-1", proxyGuest });
  return { backend, machines, guest, proxyGuest };
}

describe("Fly job execution backend", () => {
  it("reserves a stable launch identity and delivers code payload after starting the Machine", async () => {
    const f = fixture();
    const runId = "11111111-1111-4111-8111-111111111111";
    const reservation = f.backend.reserve!(runId);
    const receipt = await f.backend.launch({ runId, reservation, prompt: "", code: { script: "echo ok", context: { value: 1 } } });
    expect(f.machines.createMachine).toHaveBeenCalledWith("factorize-test", expect.objectContaining({ auto_start: false, restart: { policy: "no" } }), runId);
    expect(f.machines.startMachine).toHaveBeenCalledWith("factorize-test", "machine-1");
    expect(f.guest.run).toHaveBeenNthCalledWith(1, ["/bin/sh", "-c", expect.stringContaining("factorize-job")], expect.stringContaining("#!/usr/bin/env python3"));
    expect(f.guest.run).toHaveBeenNthCalledWith(2, ["/usr/sbin/runuser", "-u", "exedev", "--", "/usr/local/bin/factorize-job", "launch"], expect.stringContaining('"script":"echo ok"'));
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

  it("delivers the scoped run credential to proxy memory before starting the VM and omits it from guest payload", async () => {
    const f = fixture();
    const runId = "11111111-1111-4111-8111-111111111111";
    const credential = `fzt_run_${Buffer.from(runId).toString("base64url")}_${"R".repeat(43)}`;
    await f.backend.launch({ runId, prompt: "task", runProxy: { targetOrigin: "https://factorize.example", credential } });
    expect(f.proxyGuest.run).toHaveBeenCalledOnce();
    expect(f.proxyGuest.run).toHaveBeenCalledWith(["/usr/local/bin/factorize-proxy-authorize-run"], expect.stringContaining(`"credential":"${credential}"`));
    expect(f.proxyGuest.run.mock.invocationCallOrder[0]).toBeLessThan(f.machines.startMachine.mock.invocationCallOrder[0]);
    const payload = String(f.guest.run.mock.calls.at(-1)?.[1] ?? "");
    expect(payload).not.toContain(credential);
    expect(payload).toContain(runId);
  });

  it("destroys a stopped Machine after confirming provider state", async () => {
    const f = fixture();
    f.machines.inspectMachine.mockResolvedValue({ ...machine, state: "stopped" });
    await expect(f.backend.stop({ backendKind: "fly", id: "factorize-test/machine-1" })).resolves.toEqual({ state: "stopped" });
    expect(f.machines.destroyMachine).toHaveBeenCalledWith("factorize-test", "machine-1");
  });

  it("collects structured results and logs through the guest transport", async () => {
    const f = fixture(), handle = { backendKind: "fly", id: "factorize-test/machine-1" };
    await expect(f.backend.readJobResult(handle)).resolves.toBe('{"status":"succeeded"}');
    await expect(f.backend.readHarnessLog(handle)).resolves.toBe("saved log");
    expect(f.guest.download).toHaveBeenCalledWith("/home/exedev/.factorize-job/results.json");
  });

  it("terminates a run without destroying its Machine before collection", async () => {
    const f = fixture(), handle = { backendKind: "fly", id: "factorize-test/machine-1" };
    f.machines.inspectMachine.mockResolvedValueOnce({ ...machine, state: "started" }).mockResolvedValueOnce({ ...machine, state: "stopped" });
    await expect(f.backend.terminate(handle)).resolves.toEqual({ state: "stopped" });
    expect(f.machines.stopMachine).toHaveBeenCalledWith("factorize-test", "machine-1");
    expect(f.machines.destroyMachine).not.toHaveBeenCalled();
  });

  it("resolves a persisted provisional operation handle after scheduler recovery", async () => {
    const f = fixture(), runId = "11111111-1111-4111-8111-111111111111";
    const handle = f.backend.reserve!(runId);
    await expect(f.backend.inspect(handle)).resolves.toEqual({ state: "starting" });
    expect(f.machines.findMachineByOperationId).toHaveBeenCalledWith("factorize-test", runId);
    expect(f.machines.inspectMachine).toHaveBeenCalledWith("factorize-test", "machine-1");
  });
});
