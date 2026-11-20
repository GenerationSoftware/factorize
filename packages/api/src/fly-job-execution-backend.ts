import { MachineTriggerExecutionBackend } from "./machine-job-execution-backend";
import { createFlyHttpGuestTransport } from "./fly-http-guest-transport";
import { flyTriggerMachineConfig } from "./fly-job-machine";
export type { TriggerMachines as FlyTriggerMachines, TriggerGuest as FlyTriggerGuest } from "./machine-job-execution-backend";

type SharedOptions = ConstructorParameters<typeof MachineTriggerExecutionBackend>[0];

/** Preserves persisted Fly handles while sharing the complete guest lifecycle. */
export class FlyTriggerExecutionBackend extends MachineTriggerExecutionBackend {
  constructor(options: Omit<SharedOptions, "kind" | "machineConfig"> & { region: string; size: string; organizationSlug?: string }) {
    super({
      ...options,
      kind: "fly",
      machineConfig: request => flyTriggerMachineConfig(options.app, {
        runId: request.runId, operationId: request.runId,
        image: options.image, region: options.region, size: options.size,
      }),
      ...(options.organizationSlug ? { vendorIdentityIssuer: `https://oidc.fly.io/${options.organizationSlug}` } : {}),
      vendorIdentityAudience: options.vendorIdentityAudience ?? (runId => `factorize://runs/${runId}`),
      ...(options.organizationSlug ? { vendorIdentitySubject: machine => machine.name ? `${options.organizationSlug}:${options.app}:${machine.name}` : "" } : {}),
    });
  }
}

/** Fly control credentials stay in the backend and never enter the guest. */
export function flyTriggerGuest(options: { app: string; machine: string; token: string }) {
  return createFlyHttpGuestTransport({ ...options, timeoutMs: 30_000, outputLimitBytes: 64 * 1024 });
}
