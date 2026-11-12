import { describe, expect, it, vi } from "vitest";
import { FlyJobExecutionBackend } from "../src/fly-job-execution-backend";
import { agentDriver } from "../src/agent-driver";

const machine = { id: "machine-1", state: "created" };
function fixture() {
  const machines = {
    findMachineByOperationId: vi.fn(async () => machine),
    createMachine: vi.fn(async (_app: string, _config: any, _operationId: string) => machine),
    inspectMachine: vi.fn(async () => machine),
    startMachine: vi.fn(async () => undefined),
    stopMachine: vi.fn(async () => undefined),
    destroyMachine: vi.fn(async () => undefined),
  };
  const guest = {
    run: vi.fn(async (command: readonly string[], _input?: string | Uint8Array) => ({
      ok: true, exitCode: 0,
      stdout: command.at(-1) === "--version" ? "codex-cli 0.167.1\n" : "started\n", stderr: "",
    })),
    upload: vi.fn(async () => undefined),
    download: vi.fn(async (path: string) => new TextEncoder().encode(path.endsWith("results.json") ? '{"status":"succeeded"}' : "saved log")),
  };
  const proxyGuest = {
    run: vi.fn(async () => ({ ok: true, exitCode: 0, stdout: "Run credential delivered to proxy memory\n", stderr: "" })),
    issueVmCertificate: vi.fn(async () => ({ certificate: "-----BEGIN CERTIFICATE-----\npublic\n-----END CERTIFICATE-----", trustBundle: "-----BEGIN CERTIFICATE-----\nroot\n-----END CERTIFICATE-----" })),
  };
  const backend = new FlyJobExecutionBackend({ app: "factorize-test", image: "ghcr.io/acme/code:v1", region: "iad", size: "shared-cpu-1x", machines, guest: () => guest,
    proxyIdentity: "fly:factorize-test:proxy-1", proxyBootEpoch: "22222222-2222-4222-8222-222222222222", proxyGuest });
  return { backend, machines, guest, proxyGuest };
}

describe("Fly job execution backend", () => {
  it("reserves a stable launch identity and delivers code payload after starting the Machine", async () => {
    const f = fixture();
    const runId = "11111111-1111-4111-8111-111111111111";
    const reservation = f.backend.reserve!(runId);
    const receipt = await f.backend.launch({ runId, reservation, prompt: "", code: { script: "echo ok", context: { value: 1 } } });
    expect(f.machines.createMachine).toHaveBeenCalledWith("factorize-test", expect.objectContaining({
      image: "ghcr.io/acme/code:v1",
      region: "iad",
      guest: { cpu_kind: "shared", cpus: 1, memory_mb: 1024 },
      auto_start: false,
      restart: { policy: "no" },
    }), runId);
    expect(f.machines.startMachine).toHaveBeenCalledWith("factorize-test", "machine-1");
    expect(f.guest.run).toHaveBeenNthCalledWith(1, ["/bin/sh", "-c", expect.stringContaining("factorize-job")], expect.stringContaining("#!/usr/bin/env python3"));
    expect(f.guest.run).toHaveBeenNthCalledWith(2, ["/usr/sbin/runuser", "-u", "exedev", "--", "/usr/local/bin/factorize-job", "launch"], expect.stringContaining('"script":"echo ok"'));
    expect(receipt).toMatchObject({ handle: { backendKind: "fly", id: "factorize-test/machine-1" }, observation: { state: "running" } });
    expect(JSON.stringify(f.machines.createMachine.mock.calls)).not.toContain("echo ok");
  });

  it("uses the selected custom image, region, and size for Codex launches", async () => {
    const f = fixture();
    const backend = new FlyJobExecutionBackend({
      app: "factorize-test", image: "registry.example/factorize-codex:reviewed",
      region: "ord", size: "performance-2x", machines: f.machines, guest: () => f.guest,
    });
    const runId = "11111111-1111-4111-8111-111111111111";
    const harness = agentDriver("codex").launch(runId, { model: "gpt-5.5" });

    const receipt = await backend.launch({ runId, prompt: "continue", harness });

    expect(f.guest.run).toHaveBeenCalledWith(["/usr/sbin/runuser", "-u", "exedev", "--", "codex", "--version"]);
    expect(f.machines.createMachine).toHaveBeenCalledWith("factorize-test", expect.objectContaining({
      image: "registry.example/factorize-codex:reviewed",
      region: "ord",
      guest: { cpu_kind: "performance", cpus: 2, memory_mb: 2048 },
      auto_start: false,
      restart: { policy: "no" },
    }), runId);
    expect(f.guest.run).toHaveBeenLastCalledWith(
      ["/usr/sbin/runuser", "-u", "exedev", "--", "/usr/local/bin/factorize-job", "launch"],
      expect.stringContaining('"executable":"codex"'),
    );
    expect(receipt.observation).toMatchObject({ state: "running" });
  });

  it.each([
    { ok: false, exitCode: 127, stdout: "", stderr: "codex: not found" },
    { ok: true, exitCode: 0, stdout: "codex-cli 0.166.0\n", stderr: "" },
  ])("rejects a custom Codex image without the supported CLI version", async version => {
    const f = fixture();
    f.guest.run.mockResolvedValueOnce({ ok: true, exitCode: 0, stdout: "", stderr: "" });
    f.guest.run.mockResolvedValueOnce(version);

    const receipt = await f.backend.launch({
      runId: "11111111-1111-4111-8111-111111111111",
      prompt: "continue",
      harness: agentDriver("codex").launch("11111111-1111-4111-8111-111111111111", {}),
    });

    expect(receipt).toMatchObject({
      handle: { backendKind: "fly", id: "factorize-test/machine-1" },
      observation: {
        state: "failed",
        detail: "Fly guest requires codex-cli 0.167.1 for Codex jobs",
        failure: { code: "launch_failed" },
      },
    });
    expect(f.guest.run).toHaveBeenCalledTimes(2);
    expect(f.guest.run.mock.calls[1]?.[0]).toEqual(["/usr/sbin/runuser", "-u", "exedev", "--", "codex", "--version"]);
    expect(receipt.observation.detail?.length).toBeLessThanOrEqual(120);
  });

  it("lets custom image setup finish before invoking the shared launcher without replacing its entrypoint", async () => {
    const f = fixture();
    const runId = "11111111-1111-4111-8111-111111111111";
    const backend = new FlyJobExecutionBackend({
      app: "factorize-test", image: "registry.example/custom-code:reviewed",
      region: "ord", size: "performance-2x", machines: f.machines, guest: () => f.guest,
    });

    const receipt = await backend.launch({
      runId,
      prompt: "",
      code: { script: "echo ready", context: {} },
    });

    const machineConfig = f.machines.createMachine.mock.calls[0]![1];
    expect(machineConfig).toMatchObject({
      image: "registry.example/custom-code:reviewed",
      region: "ord",
      guest: { cpu_kind: "performance", cpus: 2, memory_mb: 2048 },
      auto_start: false,
      restart: { policy: "no" },
    });
    // Leave cmd unset so Fly runs the image's own entrypoint during startup.
    expect(machineConfig).not.toHaveProperty("cmd");
    expect(f.machines.startMachine.mock.invocationCallOrder[0]).toBeLessThan(f.guest.run.mock.invocationCallOrder[0]!);
    expect(f.guest.run).toHaveBeenNthCalledWith(
      2,
      ["/usr/sbin/runuser", "-u", "exedev", "--", "/usr/local/bin/factorize-job", "launch"],
      expect.stringContaining('"script":"echo ready"'),
    );
    expect(receipt.observation).toMatchObject({ state: "running" });
  });

  it("retains provider cleanup ownership when guest startup fails", async () => {
    const f = fixture();
    f.guest.run.mockResolvedValue({ ok: false, exitCode: 1, stdout: "", stderr: "failure" });
    const receipt = await f.backend.launch({ runId: "11111111-1111-4111-8111-111111111111", prompt: "" });
    expect(receipt.handle.id).toBe("factorize-test/machine-1");
    expect(receipt.observation).toMatchObject({ state: "failed", failure: { code: "launch_failed" } });
  });

  it("returns a bounded prerequisite diagnosis and retains cleanup ownership for an incompatible custom image", async () => {
    const f = fixture();
    f.guest.run.mockResolvedValueOnce({ ok: false, exitCode: 1, stdout: "", stderr: "python3: not found" });

    const receipt = await f.backend.launch({
      runId: "11111111-1111-4111-8111-111111111111",
      prompt: "",
    });

    expect(receipt.handle).toMatchObject({ backendKind: "fly", id: "factorize-test/machine-1" });
    expect(receipt.observation).toMatchObject({
      state: "failed",
      detail: "Fly guest is missing python3, runuser, or the exedev user, or could not install the shared Factorize job launcher",
      failure: { code: "launch_failed", reason: "Fly guest launch failed" },
    });
    expect(f.guest.run).toHaveBeenCalledOnce();
    expect(receipt.observation.detail).not.toContain("python3: not found");
  });

  it("reports a bounded launcher error when a custom image entrypoint does not invoke factorize-job", async () => {
    const f = fixture();
    f.guest.run.mockResolvedValueOnce({ ok: true, exitCode: 0, stdout: "", stderr: "" });
    f.guest.run.mockResolvedValueOnce({ ok: false, exitCode: 127, stdout: "", stderr: "factorize-job: command not found" });

    const receipt = await f.backend.launch({
      runId: "11111111-1111-4111-8111-111111111111",
      prompt: "",
    });

    expect(f.machines.startMachine).toHaveBeenCalledOnce();
    expect(f.guest.run).toHaveBeenCalledTimes(2);
    expect(f.guest.run.mock.calls[1]?.[0]).toEqual([
      "/usr/sbin/runuser", "-u", "exedev", "--", "/usr/local/bin/factorize-job", "launch",
    ]);
    expect(receipt.observation).toMatchObject({
      state: "failed",
      detail: "Fly guest did not confirm job launch",
      failure: { code: "launch_failed", reason: "Fly guest launch failed" },
    });
    expect(receipt.observation.detail?.length).toBeLessThanOrEqual(120);
  });

  it("retains cleanup ownership when Fly starts a Machine but loses the start acknowledgement", async () => {
    const f = fixture();
    f.machines.startMachine.mockRejectedValueOnce(new Error("Fly start response timed out"));

    const receipt = await f.backend.launch({ runId: "11111111-1111-4111-8111-111111111111", prompt: "" });

    expect(receipt).toMatchObject({
      handle: { backendKind: "fly", id: "factorize-test/machine-1" },
      observation: { state: "failed", failure: { code: "launch_failed" } },
    });
    expect(f.guest.run).not.toHaveBeenCalled();

    f.machines.inspectMachine.mockResolvedValueOnce({ ...machine, state: "started" }).mockResolvedValueOnce({ ...machine, state: "stopped" });
    await expect(f.backend.stop(receipt.handle)).resolves.toEqual({ state: "stopped" });

    expect(f.machines.stopMachine).toHaveBeenCalledWith("factorize-test", "machine-1");
    expect(f.machines.destroyMachine).toHaveBeenCalledWith("factorize-test", "machine-1");
  });

  it("delivers the scoped run credential to proxy memory before starting the VM and omits it from guest payload", async () => {
    const f = fixture();
    const runId = "11111111-1111-4111-8111-111111111111";
    const credential = `fzt_run_${Buffer.from(runId).toString("base64url")}_${"R".repeat(43)}`;
    await f.backend.launch({ runId, prompt: "task", runProxy: { targetOrigin: "https://factorize.example", credential } });
    expect(f.proxyGuest.run).toHaveBeenCalledOnce();
    expect(f.proxyGuest.run).toHaveBeenCalledWith(["/usr/local/bin/factorize-proxy-authorize-run"], expect.stringContaining(`"credential":"${credential}"`));
    expect(f.proxyGuest.run.mock.invocationCallOrder[0]).toBeLessThan(f.machines.startMachine.mock.invocationCallOrder[0]);
    expect(f.proxyGuest.issueVmCertificate).toHaveBeenCalledWith(expect.objectContaining({
      bootEpoch: "22222222-2222-4222-8222-222222222222", vmIdentity: "fly:factorize-test:machine-1",
    }));
    expect(f.guest.upload).toHaveBeenCalledWith("/home/exedev/.factorize-job/proxy/tunnel.mjs", expect.any(Uint8Array));
    expect(f.guest.run.mock.calls.some(([command]) => command.includes("FACTORIZE_PROXY_URL=http://127.0.0.1:18180"))).toBe(true);
    const payload = String(f.guest.run.mock.calls.at(-1)?.[1] ?? "");
    expect(payload).not.toContain(credential);
    expect(payload).toContain(runId);
  });

  it("destroys a stopped Machine after confirming provider state", async () => {
    const f = fixture();
    f.machines.inspectMachine.mockResolvedValue({ ...machine, state: "stopped" });
    await expect(f.backend.stop({ backendKind: "fly", id: "factorize-test/machine-1" })).resolves.toEqual({ state: "stopped" });
    expect(f.machines.stopMachine).not.toHaveBeenCalled();
    expect(f.machines.destroyMachine).toHaveBeenCalledWith("factorize-test", "machine-1");
  });

  it("keeps a Machine when the provider has not confirmed it stopped", async () => {
    const f = fixture();
    f.machines.inspectMachine.mockResolvedValueOnce({ ...machine, state: "started" }).mockResolvedValueOnce({ ...machine, state: "stopping" });
    await expect(f.backend.stop({ backendKind: "fly", id: "factorize-test/machine-1" })).resolves.toEqual({ state: "stopping" });
    expect(f.machines.stopMachine).toHaveBeenCalledWith("factorize-test", "machine-1");
    expect(f.machines.destroyMachine).not.toHaveBeenCalled();
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
