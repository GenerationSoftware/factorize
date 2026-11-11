import { provisionCredentialProxy, type ProxyBootstrapProvisioning } from "./proxy-provisioner";
import type { ProxyControlRepository } from "./postgres/proxy-control-repository";
import type { FlyMachine, FlyMachineConfig } from "./fly-machines-client";
import { createFlyGuestTransport } from "./fly-guest-transport";

const IMAGE_DIGEST = /@sha256:[a-f0-9]{64}$/i;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type FlyCredentialProxyConfig = {
  tenantId: string;
  app: string;
  /** Only reviewed credential-proxy images pinned by digest are accepted. */
  image: string;
  region: string;
  size: string;
  memoryMb?: number;
  controlOrigin: string;
  /** Stable across retries of one provisioning operation. */
  operationId: string;
};

export type FlyCredentialProxyMachineClient = {
  createMachine(app: string, config: FlyMachineConfig, operationId: string): Promise<FlyMachine>;
  startMachine(app: string, machine: string): Promise<void>;
  destroyMachine(app: string, machine: string): Promise<void>;
};

export type FlyCredentialProxyGuest = {
  /** The reviewed image startup command consumes this payload from stdin only. */
  startProxy(input: ProxyBootstrapProvisioning & { credential: string }): Promise<void>;
};

/** Provider exec adapter: the bootstrap record is the command's stdin payload. */
export function createFlyCredentialProxyGuest(options: {
  app: string;
  machine: string;
  token: string;
  cliPath?: string;
  spawnProcess?: typeof import("node:child_process").spawn;
}): FlyCredentialProxyGuest {
  const transport = createFlyGuestTransport({ ...options, timeoutMs: 30_000, outputLimitBytes: 16 * 1024 });
  return {
    async startProxy(input) {
      const result = await transport.run(["/usr/local/bin/factorize-proxy-startup"], `${JSON.stringify({
        controlOrigin: input.controlOrigin,
        bootEpoch: input.bootEpoch,
        credential: input.credential,
      })}\n`);
      if (!result.ok) throw new Error("Credential proxy startup command failed");
      if (result.stdout.trim() !== "Credential proxy started") throw new Error("Credential proxy startup was not confirmed");
    },
  };
}

export type FlyCredentialProxyProvisionerOptions = {
  control: Pick<ProxyControlRepository, "provisionCredential" | "revokeCredential">;
  machines: FlyCredentialProxyMachineClient;
  guest: (machine: FlyMachine) => FlyCredentialProxyGuest;
  /** Injectable to keep boot identity deterministic in boundary tests. */
  newBootEpoch?: () => string;
};

function validate(input: FlyCredentialProxyConfig): void {
  if (!input.tenantId || !input.app || !input.operationId || input.operationId.length > 200) throw new TypeError("Invalid credential proxy provisioning identity");
  if (!IMAGE_DIGEST.test(input.image)) throw new TypeError("Credential proxy image must be pinned by sha256 digest");
  if (!/^[a-z0-9]{3}$/.test(input.region)) throw new TypeError("Invalid credential proxy region");
  if (!/^[a-z0-9-]{1,64}$/.test(input.size)) throw new TypeError("Invalid credential proxy size");
  if (input.memoryMb !== undefined && (!Number.isInteger(input.memoryMb) || input.memoryMb < 256 || input.memoryMb > 8192)) throw new TypeError("Credential proxy memory must be between 256 and 8192 MiB");
}

/**
 * Provisions one dedicated Fly Machine for the credential proxy and wires its
 * startup through the one-use bootstrap boundary. The bootstrap credential is
 * never part of the Machine config; the guest adapter must deliver it over its
 * private stdin startup channel.
 */
export function createFlyCredentialProxyProvisioner(options: FlyCredentialProxyProvisionerOptions) {
  return {
    async start(input: FlyCredentialProxyConfig): Promise<{ proxyIdentity: string; bootEpoch: string; machine: FlyMachine }> {
      validate(input);
      const origin = new URL(input.controlOrigin);
      if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) {
        throw new TypeError("controlOrigin must be an HTTPS origin");
      }
      const candidateBootEpoch = (options.newBootEpoch ?? (() => crypto.randomUUID()))();
      if (!UUID_V4.test(candidateBootEpoch)) throw new TypeError("boot epoch must be a UUID v4");
      const config: FlyMachineConfig = {
        image: input.image,
        region: input.region,
        cmd: ["/usr/local/bin/factorize-credential-proxy", "--boot-epoch", candidateBootEpoch],
        guest: { cpu_kind: "shared", cpus: 1, memory_mb: input.memoryMb ?? 512 },
        metadata: {
          factorize_role: "credential-proxy",
          factorize_tenant_id: input.tenantId,
          factorize_operation_id: input.operationId,
          factorize_boot_epoch: candidateBootEpoch,
        },
        // The proxy must be explicitly started and must not be restarted after
        // process failure with a stale one-use bootstrap credential.
        auto_start: false,
        auto_stop: false,
        restart: { policy: "no" },
      };
      const machine = await options.machines.createMachine(input.app, config, input.operationId);
      if (!machine.id) throw new Error("Fly returned a credential proxy Machine without an id");
      const bootEpoch = machine.config?.metadata?.factorize_boot_epoch ?? candidateBootEpoch;
      if (!UUID_V4.test(bootEpoch)) throw new Error("Fly returned a credential proxy Machine with an invalid boot epoch");
      const proxyIdentity = `fly:${input.app}:${machine.id}`;
      const bootstrap = {
        tenantId: input.tenantId,
        proxyIdentity,
        bootEpoch,
        controlOrigin: origin.origin,
      };
      try {
        await provisionCredentialProxy(bootstrap, {
          control: options.control,
          startProxy: async (request) => {
            // Fly Machine startup is explicit. Machine config and metadata only
            // hold public identity/configuration; the token crosses stdin.
            await options.machines.startMachine(input.app, machine.id);
            await options.guest(machine).startProxy(request);
          },
        });
      } catch (error) {
        // Preserve the sanitized original provisioning failure while making a
        // best-effort cleanup of a machine that never completed startup.
        await options.machines.destroyMachine(input.app, machine.id).catch(() => undefined);
        throw error;
      }
      return { proxyIdentity, bootEpoch, machine };
    },
  };
}
