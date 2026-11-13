import { MachineJobExecutionBackend, type ProxyGuest } from "./machine-job-execution-backend";
import { createDockerJobInfrastructure } from "./docker-job-infrastructure";

/** Explicit host-runner construction; Docker is never selected by production API configuration. */
export function createDockerJobExecutionBackend(options: {
  beforeDestroy?: (id: string) => Promise<void>;
  observeGuestInput?: (command: readonly string[], input?: string | Uint8Array) => void;
  testMode: true; namespace: string; network: string; image: string;
  proxyHost: string; proxyServerName?: string; proxyPort: number; proxyIdentity: string; proxyBootEpoch: string; proxyGuest: ProxyGuest;
}) {
  const infrastructure = createDockerJobInfrastructure(options);
  return new MachineJobExecutionBackend({
    kind: "docker", app: options.namespace, image: options.image,
    machines: infrastructure.machines, guest: machine => infrastructure.guest(machine.id),
    machineConfig: request => ({ image: options.image, metadata: { factorize_operation_id: request.runId } }),
    vmIdentity: machine => `docker:${machine.id.slice(0, 32)}`,
    proxyAddress: { host: options.proxyHost, port: options.proxyPort, serverName: options.proxyServerName },
    proxyIdentity: options.proxyIdentity, proxyBootEpoch: options.proxyBootEpoch, proxyGuest: options.proxyGuest,
  });
}
