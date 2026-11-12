import type { ExecutionBackend, ExecutionObservation, LaunchReceipt, LaunchRequest, RunHandle } from "./execution";
import type { FlyMachine, FlyMachineConfig } from "./fly-machines-client";
import { flyJobMachineConfig } from "./fly-job-machine";
import { createFlyGuestTransport } from "./fly-guest-transport";

export type FlyJobMachines = {
  createMachine(app: string, config: FlyMachineConfig, operationId: string): Promise<FlyMachine>;
  inspectMachine(app: string, machine: string): Promise<FlyMachine>;
  startMachine(app: string, machine: string): Promise<void>;
  stopMachine(app: string, machine: string): Promise<void>;
  destroyMachine(app: string, machine: string): Promise<void>;
};

export type FlyJobGuest = { run(command: readonly string[], input?: string | Uint8Array): Promise<{ ok: boolean; exitCode: number; stdout: string; stderr: string }> };

const capabilities = ["stop", "recovery"] as const;

/** Fly Machine lifecycle adapter. Machine creation is idempotent by run ID;
 * job payload delivery is a separate guest operation and never enters machine config. */
export class FlyJobExecutionBackend implements ExecutionBackend {
  readonly kind = "fly";
  readonly capabilities = capabilities;

  constructor(
    private readonly options: {
      app: string;
      image: string;
      region: string;
      size: string;
      machines: FlyJobMachines;
      guest: (machine: FlyMachine) => FlyJobGuest;
      destinationUrl?: (machine: FlyMachine) => string;
    },
  ) {}

  reserve(runId: string): RunHandle {
    return { backendKind: this.kind, id: `${this.options.app}/${runId}` };
  }

  private machineId(handle: RunHandle): string {
    if (handle.backendKind !== this.kind || !handle.id.startsWith(`${this.options.app}/`)) throw new TypeError("Invalid Fly execution handle");
    const id = handle.id.slice(this.options.app.length + 1);
    if (!id || id.includes("/")) throw new TypeError("Invalid Fly execution handle");
    return id;
  }

  async launch(request: LaunchRequest): Promise<LaunchReceipt> {
    const operationId = request.runId;
    const handle = request.reservation ?? this.reserve(request.runId);
    this.machineId(handle);
    const config = flyJobMachineConfig(this.options.app, {
      runId: request.runId,
      operationId,
      image: this.options.image,
      region: this.options.region,
      size: this.options.size,
    });
    const machine = await this.options.machines.createMachine(this.options.app, config, operationId);
    if (!machine.id) throw new Error("Fly returned a Machine without an id");
    const actualHandle = { backendKind: this.kind, id: `${this.options.app}/${machine.id}` };
    try {
      await this.options.machines.startMachine(this.options.app, machine.id);
      const payload = JSON.stringify({ version: 1, runId: request.runId, ...(request.code ? { code: request.code } : { prompt: request.prompt, harness: request.harness }), ...(request.traceSources ? { traceSources: request.traceSources } : {}) });
      const started = await this.options.guest(machine).run(["/usr/local/bin/factorize-job", "launch"], `${payload}\n`);
      if (!started.ok || started.stdout.trim() !== "started") throw new Error("Fly guest did not confirm job launch");
      return {
        handle: actualHandle,
        destinationUrl: this.options.destinationUrl?.(machine) ?? `fly://${this.options.app}/${machine.id}`,
        capabilities,
        observation: { state: "running" },
      };
    } catch (error) {
      // Keep the persisted machine handle available to scheduler cleanup when
      // guest startup fails after provider creation.
      return {
        handle: actualHandle,
        destinationUrl: this.options.destinationUrl?.(machine) ?? `fly://${this.options.app}/${machine.id}`,
        capabilities,
        observation: { state: "failed", detail: error instanceof Error ? error.message : "Fly guest launch failed", failure: { source: "system", code: "launch_failed", reason: "Fly guest launch failed" } },
      };
    }
  }

  async inspect(handle: RunHandle): Promise<ExecutionObservation> {
    const machine = await this.options.machines.inspectMachine(this.options.app, this.machineId(handle));
    switch (String(machine.state ?? "").toLowerCase()) {
      case "started": case "starting": return { state: "running" };
      case "stopped": case "destroyed": return { state: "succeeded" };
      case "created": case "scheduling": return { state: "starting" };
      default: return { state: "failed", detail: "Fly Machine entered an unexpected state", failure: { source: "system", code: "provider_state_invalid", reason: "Fly Machine entered an unexpected state" } };
    }
  }

  async stop(handle: RunHandle): Promise<ExecutionObservation> {
    const id = this.machineId(handle);
    const machine = await this.options.machines.inspectMachine(this.options.app, id);
    if (["destroyed", "destroying"].includes(String(machine.state ?? "").toLowerCase())) return { state: "stopped" };
    await this.options.machines.stopMachine(this.options.app, id);
    const after = await this.options.machines.inspectMachine(this.options.app, id);
    if (!["stopped", "destroyed"].includes(String(after.state ?? "").toLowerCase())) return { state: "stopping" };
    await this.options.machines.destroyMachine(this.options.app, id);
    return { state: "stopped" };
  }
}

/** Production guest adapter; CLI credentials stay in the scheduler process. */
export function flyJobGuest(options: { app: string; machine: string; token: string }) {
  return createFlyGuestTransport({ ...options, timeoutMs: 30_000, outputLimitBytes: 64 * 1024 });
}
