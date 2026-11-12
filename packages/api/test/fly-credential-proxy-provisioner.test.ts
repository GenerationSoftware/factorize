import { describe, expect, it, vi } from "vitest";
import { createFlyCredentialProxyProvisioner, createFlyCredentialProxyGuest } from "../src/fly-credential-proxy-provisioner";

const epoch = "11111111-1111-4111-8111-111111111111";
const machine = { id: "machine-1", state: "created" };
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
    createMachine: vi.fn(async () => machine),
    startMachine: vi.fn(async () => undefined),
    destroyMachine: vi.fn(async () => undefined),
  };
  const guest = vi.fn(() => ({ run: vi.fn(async () => ({ ok: true, exitCode: 0, stdout: "", stderr: "" })), startProxy: vi.fn(async () => undefined), issueVmCertificate: vi.fn(async () => ({ certificate: "", trustBundle: "" })) }));
  const provisioner = createFlyCredentialProxyProvisioner({ control, machines, guest, newBootEpoch: () => epoch });
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
      env: { FACTORIZE_PROXY_TUNNEL_SERVER_NAME: "factorize-proxies.internal", FACTORIZE_PROXY_TUNNEL_PORT: "9090", FACTORIZE_PROXY_BROWSER_CAPABILITY_PUBLIC_KEY: input.browserCapabilityPublicKey },
      services: [
        { protocol: "tcp", internal_port: 8080, ports: [{ port: 443, handlers: ["tls", "http"] }], force_instance_key: true },
        { protocol: "tcp", internal_port: 9090, ports: [] },
      ],
      restart: { policy: "no" },
      auto_start: false,
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

  it("revokes bootstrap authority and removes a Machine when startup fails", async () => {
    const { control, machines, guest } = fixture();
    guest.mockReturnValue({ run: vi.fn(), startProxy: vi.fn().mockRejectedValue(new Error("private startup channel failed")), issueVmCertificate: vi.fn() });
    const provisioner = createFlyCredentialProxyProvisioner({ control, machines, guest, newBootEpoch: () => epoch });
    await expect(provisioner.start(input)).rejects.toThrow("private startup channel failed");
    expect(control.revokeCredential).toHaveBeenCalledWith(input.tenantId, "fly:factorize-proxies:machine-1");
    expect(machines.destroyMachine).toHaveBeenCalledWith(input.app, machine.id);
  });

  it("rejects mutable images and unsafe control origins before provisioning", async () => {
    const { machines, provisioner } = fixture();
    await expect(provisioner.start({ ...input, image: "ghcr.io/example/proxy:latest" })).rejects.toThrow("pinned by sha256 digest");
    await expect(provisioner.start({ ...input, controlOrigin: "http://factorize.example" })).rejects.toThrow("HTTPS origin");
    await expect(provisioner.start({ ...input, app: "invalid/app" })).rejects.toThrow("Fly app name");
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
