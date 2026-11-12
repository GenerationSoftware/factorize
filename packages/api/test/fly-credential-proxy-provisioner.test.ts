import { describe, expect, it, vi } from "vitest";
import { createFlyCredentialProxyProvisioner, createFlyCredentialProxyGuest } from "../src/fly-credential-proxy-provisioner";

const epoch = "11111111-1111-4111-8111-111111111111";
const machine = {
  id: "machine-1",
  state: "created",
  config: { metadata: {
    factorize_role: "credential-proxy",
    factorize_tenant_id: "11111111-1111-4111-8111-111111111112",
    factorize_operation_id: "tenant-proxy-start-1",
    factorize_boot_epoch: "11111111-1111-4111-8111-111111111111",
  } },
};
const input = {
  tenantId: "11111111-1111-4111-8111-111111111112",
  app: "factorize-proxies",
  image: `ghcr.io/generationsoftware/credential-proxy@sha256:${"a".repeat(64)}`,
  region: "iad",
  size: "shared-cpu-1x",
  browserCapabilityPublicKey: "-----BEGIN PUBLIC KEY-----\nfixture\n-----END PUBLIC KEY-----",
  controlOrigin: "https://factorize.example",
  operationId: "tenant-proxy-start-1",
};

function fixture() {
  const control = {
    provisionCredential: vi.fn(async () => `fzc_${"b".repeat(43)}`),
    revokeCredential: vi.fn(async () => true),
  };
  const machines = {
    createMachine: vi.fn(async (_app: string, _config: any, _operationId: string) => machine),
    startMachine: vi.fn(async () => undefined),
    destroyMachine: vi.fn(async () => undefined),
  };
  const guest = vi.fn(() => ({ run: vi.fn(async () => ({ ok: true, exitCode: 0, stdout: "", stderr: "" })), startProxy: vi.fn(async () => undefined), issueVmCertificate: vi.fn(async () => ({ certificate: "", trustBundle: "" })) }));
  const provisioner = createFlyCredentialProxyProvisioner({ control, machines, guest, reviewedImage: input.image, newBootEpoch: () => epoch });
  return { control, machines, guest, provisioner };
}

describe("Fly credential proxy startup", () => {
  it("creates a digest-pinned dedicated Machine and delivers bootstrap only through startup", async () => {
    const { control, machines, guest, provisioner } = fixture();
    const started = await provisioner.start(input);
    expect(started).toMatchObject({ proxyIdentity: "fly:factorize-proxies:machine-1", bootEpoch: epoch, machine });
    expect(machines.createMachine).toHaveBeenCalledWith(input.app, expect.objectContaining({
      image: input.image,
      region: input.region,
      cmd: ["/usr/local/bin/factorize-credential-proxy", "--boot-epoch", epoch],
      guest: { cpu_kind: "shared", cpus: 1, memory_mb: 512 },
      env: { FACTORIZE_PROXY_TUNNEL_SERVER_NAME: "factorize-proxies.internal", FACTORIZE_PROXY_TUNNEL_PORT: "9090", FACTORIZE_PROXY_BROWSER_CAPABILITY_PUBLIC_KEY: input.browserCapabilityPublicKey },
      services: [
        { protocol: "tcp", internal_port: 8080, ports: [{ port: 443, handlers: ["tls", "http"] }], force_instance_key: true },
        { protocol: "tcp", internal_port: 9090, ports: [] },
      ],
      restart: { policy: "no" },
      auto_start: false,
      auto_stop: false,
      metadata: expect.objectContaining({ factorize_role: "credential-proxy", factorize_tenant_id: input.tenantId }),
    }), input.operationId);
    expect(JSON.stringify(machines.createMachine.mock.calls[0])).not.toContain("fzc_");
    expect(machines.startMachine).toHaveBeenCalledWith(input.app, machine.id);
    expect(control.provisionCredential).toHaveBeenCalledWith(input.tenantId, "fly:factorize-proxies:machine-1", epoch);
    expect(guest).toHaveBeenCalledWith(machine);
    const guestAdapter = guest.mock.results[0]!.value;
    expect(guestAdapter.startProxy).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: input.tenantId,
      proxyIdentity: "fly:factorize-proxies:machine-1",
      bootEpoch: epoch,
      controlOrigin: input.controlOrigin,
      browserOrigin: `https://${input.app}.fly.dev`,
      credential: `fzc_${"b".repeat(43)}`,
    }));
  });

  it.each([
    ["shared-cpu-1x", "shared", 1],
    ["shared-cpu-2x", "shared", 2],
    ["shared-cpu-4x", "shared", 4],
    ["performance-1x", "performance", 1],
    ["performance-2x", "performance", 2],
    ["performance-4x", "performance", 4],
  ] as const)("uses the requested region, %s size and memory without enabling suspension", async (size, cpuKind, cpus) => {
    const { machines, provisioner } = fixture();
    await provisioner.start({ ...input, region: "ord", size, memoryMb: 2048 });

    const [, config, operationId] = machines.createMachine.mock.calls[0]!;
    expect(config).toMatchObject({
      image: input.image,
      region: "ord",
      guest: { cpu_kind: cpuKind, cpus, memory_mb: 2048 },
      auto_start: false,
      auto_stop: false,
      restart: { policy: "no" },
    });
    expect(operationId).toBe(input.operationId);
    expect(config).not.toHaveProperty("suspend");
    expect(config).not.toHaveProperty("auto_suspend");
  });

  it("revokes bootstrap authority and removes a Machine when startup fails", async () => {
    const { control, machines, guest } = fixture();
    guest.mockReturnValue({ run: vi.fn(), startProxy: vi.fn().mockRejectedValue(new Error("private startup channel failed")), issueVmCertificate: vi.fn() });
    const provisioner = createFlyCredentialProxyProvisioner({ control, machines, guest, reviewedImage: input.image, newBootEpoch: () => epoch });
    await expect(provisioner.start(input)).rejects.toThrow("private startup channel failed");
    expect(control.revokeCredential).toHaveBeenCalledWith(input.tenantId, "fly:factorize-proxies:machine-1");
    expect(machines.destroyMachine).toHaveBeenCalledWith(input.app, machine.id);
  });

  it("removes a created Machine when Fly returns an invalid boot epoch", async () => {
    const f = fixture();
    f.machines.createMachine.mockResolvedValue({
      ...machine,
      config: { metadata: { ...machine.config.metadata, factorize_boot_epoch: "not-a-uuid" } },
    } as any);

    await expect(f.provisioner.start(input)).rejects.toThrow("mismatched provisioning identity");

    expect(f.machines.destroyMachine).toHaveBeenCalledWith(input.app, machine.id);
    expect(f.control.provisionCredential).not.toHaveBeenCalled();
    expect(f.guest).not.toHaveBeenCalled();
  });

  it("rejects a valid but different returned boot epoch before granting bootstrap authority", async () => {
    const f = fixture();
    f.machines.createMachine.mockResolvedValue({
      ...machine,
      config: { metadata: { ...machine.config.metadata, factorize_boot_epoch: "22222222-2222-4222-8222-222222222222" } },
    } as any);

    await expect(f.provisioner.start(input)).rejects.toThrow("mismatched provisioning identity");

    expect(f.control.provisionCredential).not.toHaveBeenCalled();
    expect(f.guest).not.toHaveBeenCalled();
    expect(f.machines.destroyMachine).toHaveBeenCalledWith(input.app, machine.id);
  });

  it("rejects returned tenant or operation metadata that belongs to another provisioning request", async () => {
    for (const metadata of [
      { ...machine.config.metadata, factorize_tenant_id: "another-tenant" },
      { ...machine.config.metadata, factorize_operation_id: "another-operation" },
      { ...machine.config.metadata, factorize_role: "job" },
    ]) {
      const f = fixture();
      f.machines.createMachine.mockResolvedValue({ ...machine, config: { metadata } } as any);

      await expect(f.provisioner.start(input)).rejects.toThrow("mismatched provisioning identity");

      expect(f.control.provisionCredential).not.toHaveBeenCalled();
      expect(f.guest).not.toHaveBeenCalled();
      expect(f.machines.destroyMachine).toHaveBeenCalledWith(input.app, machine.id);
    }
  });

  it("fails closed when Fly omits any returned provisioning identity metadata", async () => {
    for (const key of ["factorize_boot_epoch", "factorize_role", "factorize_tenant_id", "factorize_operation_id"]) {
      const f = fixture();
      const metadata = { ...machine.config.metadata };
      delete (metadata as Record<string, string>)[key];
      f.machines.createMachine.mockResolvedValue({ ...machine, config: { metadata } } as any);

      await expect(f.provisioner.start(input)).rejects.toThrow("mismatched provisioning identity");

      expect(f.control.provisionCredential).not.toHaveBeenCalled();
      expect(f.guest).not.toHaveBeenCalled();
      expect(f.machines.destroyMachine).toHaveBeenCalledWith(input.app, machine.id);
    }
  });

  it("revokes bootstrap authority and attempts Machine cleanup when explicit start fails", async () => {
    const f = fixture();
    const startupFailure = new Error("local Fly fixture start failed");
    f.machines.startMachine.mockRejectedValue(startupFailure);
    // Cleanup failure must not replace the original provisioning diagnosis.
    f.machines.destroyMachine.mockRejectedValue(new Error("local Fly fixture cleanup failed"));

    await expect(f.provisioner.start(input)).rejects.toBe(startupFailure);

    expect(f.control.provisionCredential).toHaveBeenCalledOnce();
    expect(f.control.revokeCredential).toHaveBeenCalledWith(input.tenantId, "fly:factorize-proxies:machine-1");
    expect(f.control.revokeCredential.mock.invocationCallOrder[0]).toBeLessThan(f.machines.destroyMachine.mock.invocationCallOrder[0]!);
    expect(f.machines.destroyMachine).toHaveBeenCalledWith(input.app, machine.id);
    expect(f.guest).not.toHaveBeenCalled();
  });

  it("rejects mutable images and unsafe control origins before provisioning", async () => {
    const { machines, provisioner } = fixture();
    await expect(provisioner.start({ ...input, image: "ghcr.io/example/proxy:latest" })).rejects.toThrow("pinned by sha256 digest");
    await expect(provisioner.start({ ...input, controlOrigin: "http://factorize.example" })).rejects.toThrow("HTTPS origin");
    await expect(provisioner.start({ ...input, app: "invalid/app" })).rejects.toThrow("Fly app name");
    expect(machines.createMachine).not.toHaveBeenCalled();
  });

  it("rejects unsupported Fly sizes before provisioning", async () => {
    const { machines, provisioner } = fixture();
    await expect(provisioner.start({ ...input, size: "custom-3x" })).rejects.toThrow("Invalid credential proxy size");
    expect(machines.createMachine).not.toHaveBeenCalled();
  });

  it.each([255, 8193, 512.5])("rejects unsupported proxy memory %s MiB before provisioning", async memoryMb => {
    const { machines, provisioner } = fixture();
    await expect(provisioner.start({ ...input, memoryMb })).rejects.toThrow("between 256 and 8192 MiB");
    expect(machines.createMachine).not.toHaveBeenCalled();
  });

  it("rejects a different digest-pinned image instead of treating any immutable image as reviewed", async () => {
    const { machines, provisioner } = fixture();
    await expect(provisioner.start({ ...input, image: `ghcr.io/generationsoftware/credential-proxy@sha256:${"c".repeat(64)}` }))
      .rejects.toThrow("configured reviewed image");
    expect(machines.createMachine).not.toHaveBeenCalled();
  });
});

describe("Fly credential proxy guest adapter", () => {
  it("sends the bootstrap credential as stdin to the reviewed startup command", async () => {
    const calls: unknown[][] = [];
    const spawnProcess = ((command: string, args: string[], options: { stdio: string[] }) => {
      calls.push([command, args, options]);
      const stdoutHandlers: Array<(chunk: Buffer) => void> = [];
      const child: any = { pid: undefined, stdin: { end: (value: string) => { calls.push(["stdin", value]); } },
        stdout: { on: (_event: string, callback: (chunk: Buffer) => void) => stdoutHandlers.push(callback) },
        stderr: { on: () => undefined }, on: (event: string, callback: (code: number) => void) => {
          if (event === "close") queueMicrotask(() => { stdoutHandlers.forEach(handler => handler(Buffer.from("Credential proxy started\n"))); callback(0); });
        }, kill: () => undefined };
      return child;
    }) as any;
    const guest = createFlyCredentialProxyGuest({ app: input.app, machine: machine.id, token: "server-token-fixture", spawnProcess });
    await guest.startProxy({ tenantId: input.tenantId, proxyIdentity: "fly:factorize-proxies:machine-1", bootEpoch: epoch, controlOrigin: input.controlOrigin, browserOrigin: `https://${input.app}.fly.dev`, credential: `fzc_${"c".repeat(43)}` });
    expect(calls[0]?.[1]).toContain("/usr/local/bin/factorize-proxy-startup");
    expect(String(calls[1]?.[1])).toContain(`"type":"register-boot"`);
    expect(String(calls[1]?.[1])).toContain(`"credential":"fzc_${"c".repeat(43)}"`);
  });

  it("requests a VM CSR signature through the private guest channel and verifies both bindings", async () => {
    const calls: unknown[][] = [];
    const spawnProcess = ((command: string, args: string[], options: { stdio: string[] }) => {
      calls.push([command, args, options]);
      const stdoutHandlers: Array<(chunk: Buffer) => void> = [];
      const child: any = { pid: undefined, stdin: { end: (value: string) => { calls.push(["stdin", value]); } },
        stdout: { on: (_event: string, callback: (chunk: Buffer) => void) => stdoutHandlers.push(callback) },
        stderr: { on: () => undefined }, on: (event: string, callback: (code: number) => void) => {
          if (event === "close") queueMicrotask(() => { stdoutHandlers.forEach(handler => handler(Buffer.from(JSON.stringify({
            bootEpoch: epoch, vmIdentity: "fly:job-1", certificate: "-----BEGIN CERTIFICATE-----cert", trustBundle: "-----BEGIN CERTIFICATE-----ca",
          }) + "\n"))); callback(0); });
        }, kill: () => undefined };
      return child;
    }) as any;
    const guest = createFlyCredentialProxyGuest({ app: input.app, machine: machine.id, token: "server-token-fixture", spawnProcess });
    await expect(guest.issueVmCertificate({ bootEpoch: epoch, vmIdentity: "fly:job-1", csr: `-----BEGIN CERTIFICATE REQUEST-----\n${"A".repeat(120)}\n-----END CERTIFICATE REQUEST-----` }))
      .resolves.toEqual({ certificate: "-----BEGIN CERTIFICATE-----cert", trustBundle: "-----BEGIN CERTIFICATE-----ca" });
    expect(calls[0]?.[1]).toContain("/usr/local/bin/factorize-proxy-certify-vm");
    expect(String(calls[1]?.[1])).toContain("\"vmIdentity\":\"fly:job-1\"");
    await expect(guest.issueVmCertificate({ bootEpoch: epoch, vmIdentity: "fly:job-1", csr: "bad" })).rejects.toThrow("Invalid VM certificate provisioning request");
  });
});
