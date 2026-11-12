import { MachineJobExecutionBackend } from "./machine-job-execution-backend";
import { createFlyGuestTransport } from "./fly-guest-transport";
import { flyJobMachineConfig } from "./fly-job-machine";
export type { JobMachines as FlyJobMachines, JobGuest as FlyJobGuest, ProxyGuest as FlyProxyGuest } from "./machine-job-execution-backend";

type SharedOptions = ConstructorParameters<typeof MachineJobExecutionBackend>[0];

/** Preserves persisted Fly handles while sharing the complete guest lifecycle. */
export class FlyJobExecutionBackend extends MachineJobExecutionBackend {
  constructor(options: Omit<SharedOptions, "kind" | "machineConfig" | "vmIdentity" | "proxyAddress"> & { region: string; size: string }) {
    super({
      ...options,
      kind: "fly",
      machineConfig: request => flyJobMachineConfig(options.app, {
        runId: request.runId, operationId: request.runId,
        image: options.image, region: options.region, size: options.size,
      }),
      vmIdentity: machine => `fly:${options.app}:${machine.id}`,
      proxyAddress: { host: `${options.app}.internal`, port: 9090 },
    });
  }
}

/** CLI credentials stay in the scheduler process. */
export function flyJobGuest(options: { app: string; machine: string; token: string }) {
  return createFlyGuestTransport({ ...options, timeoutMs: 30_000, outputLimitBytes: 64 * 1024 });
}
