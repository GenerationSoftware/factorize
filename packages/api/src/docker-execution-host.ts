import { createDockerJobInfrastructure } from "./docker-job-infrastructure";
import { createDockerJobExecutionBackend } from "./docker-job-execution-backend";
import { createCredentialProxyGuest, createMachineCredentialProxyProvisioner } from "./fly-credential-proxy-provisioner";
import { ProxyControlRepository } from "./postgres/proxy-control-repository";
import type { Database } from "./postgres/database";
import type { Env } from "./types";
import type { RunBackendFactory } from "./postgres/run-scheduler";

/** Test-only host implementation. Image IDs are verified locally, without registry publication. */
export function createDockerExecutionHost(options: {
  observeJobDestruction?: (id: string) => Promise<void>;
  observeJobInput?: (command: readonly string[], input?: string | Uint8Array) => void;
  testMode: true; database: Database; env: Env; namespace: string; jobNetwork: string; upstreamNetwork: string;
  jobImage: string; proxyImage: string; tlsDirectory: string; upstreamOrigin: string; upstreamAddress: string;
}) {
  if (options.testMode !== true || options.env.TEST_DOCKER_EXECUTION?.enabled !== true) throw new Error("Docker host requires an explicit test environment");
  for (const image of [options.proxyImage, options.jobImage]) if (!/^sha256:[a-f0-9]{64}$/.test(image)) throw new TypeError("Local images must be immutable Docker image IDs");
  const proxies = createDockerJobInfrastructure({ testMode: true, namespace: options.namespace, network: options.jobNetwork,
    additionalNetworks: [options.upstreamNetwork], mounts: [{ source: options.tlsDirectory, target: "/fixture-tls" }], publishBrowserPort: true });
  const control = new ProxyControlRepository(options.database);
  const provisioner = createMachineCredentialProxyProvisioner({
    control, machines: proxies.machines,
    guest: machine => createCredentialProxyGuest(proxies.guest(machine.id)), reviewedImage: options.proxyImage,
    infrastructure: {
      kind: "docker", validateImage: image => { if (image !== options.proxyImage) throw new Error("Unreviewed proxy image"); },
      identity: machine => `docker:${options.namespace}:${machine.id}`,
      browserOrigin: async machine => `https://localhost:${await proxies.browserPort(machine.id)}`,
      serverName: "proxy.local",
      environment: { NODE_ENV: "test", NODE_EXTRA_CA_CERTS: "/fixture-tls/ca.crt", FACTORIZE_APP_ORIGIN: options.env.APP_ORIGIN,
        FACTORIZE_PROXY_TEST_MODE: "true", FACTORIZE_PROXY_BROWSER_TLS_CERT: "/fixture-tls/server.crt", FACTORIZE_PROXY_BROWSER_TLS_KEY: "/fixture-tls/server.key",
        FACTORIZE_PROXY_TEST_TRANSPORT: JSON.stringify({ origin: options.upstreamOrigin, address: options.upstreamAddress, caFile: "/fixture-tls/ca.crt" }),
      },
    },
  });
  const pending = new Map<string, Promise<{ proxyIdentity: string; bootEpoch: string }>>();
  async function setup(tenantId: string, operationId: string) {
    const existing = await control.browserPairing(tenantId);
    if (existing) {
      const id = existing.proxyIdentity.split(":").at(-1)!;
      if ((await proxies.machines.inspectMachine(options.namespace, id)).state === "started") return { proxyIdentity: existing.proxyIdentity, bootEpoch: existing.bootEpoch };
    }
    const key = tenantId;
    if (!pending.has(key)) {
      const started = provisioner.start({ tenantId, operationId, app: options.namespace, image: options.proxyImage, region: "iad", size: "shared-cpu-1x",
        browserCapabilityPublicKey: options.env.MODEL_ACCOUNT_CAPABILITY_PUBLIC_KEY!, controlOrigin: options.env.APP_ORIGIN }).then(({ proxyIdentity, bootEpoch }) => ({ proxyIdentity, bootEpoch }));
      pending.set(key, started);
      void started.finally(() => pending.delete(key)).catch(() => {});
    }
    return pending.get(key)!;
  }
  const backendFactory: RunBackendFactory = async run => {
    if (run.executionConfig.executionProvider !== "docker" && run.backendKind !== "docker") return undefined;
    if (run.executionConfig.executionType !== "code") throw new Error("Docker supports code jobs only");
    const pairing = await control.browserPairing(run.tenantId);
    if (!pairing || !pairing.proxyIdentity.startsWith(`docker:${options.namespace}:`)) throw new Error("Docker credential proxy is not registered");
    const id = pairing.proxyIdentity.split(":").at(-1)!;
    const proxy = await proxies.machines.inspectMachine(options.namespace, id);
    if (proxy.state !== "started") throw new Error("Docker credential proxy is unavailable");
    // Container IP is reachable only within the job's isolated network; certificate uses proxy.local.
    return createDockerJobExecutionBackend({ testMode: true, namespace: `${options.namespace}-jobs`, network: options.jobNetwork, image: options.jobImage,
      beforeDestroy: options.observeJobDestruction, observeGuestInput: options.observeJobInput, proxyHost: await proxies.address(id, options.jobNetwork), proxyPort: 9090, proxyServerName: "proxy.local", proxyIdentity: pairing.proxyIdentity, proxyBootEpoch: pairing.bootEpoch,
      proxyGuest: createCredentialProxyGuest(proxies.guest(id)) });
  };
  return { setup, backendFactory };
}
