import type { ExecutionBackend, ExecutionObservation, LaunchReceipt, LaunchRequest, RunHandle } from "./execution";
import type { FlyMachine, FlyMachineConfig } from "./fly-machines-client";
import { flyJobMachineConfig } from "./fly-job-machine";
import { createFlyGuestTransport } from "./fly-guest-transport";
import { createHash } from "node:crypto";
import { safeDiagnosticText } from "./harness-diagnostics";
import type { ArtifactCollectionRequest, ArtifactCollector, ExecutionTerminator, HarnessLogReader, JobFileCollectionRequest, JobFileCollector, JobResultReader } from "./execution";
import { sourceCommand } from "./trace-source";

export type FlyJobMachines = {
  findMachineByOperationId?(app: string, operationId: string): Promise<FlyMachine | undefined>;
  createMachine(app: string, config: FlyMachineConfig, operationId: string): Promise<FlyMachine>;
  inspectMachine(app: string, machine: string): Promise<FlyMachine>;
  startMachine(app: string, machine: string): Promise<void>;
  stopMachine(app: string, machine: string): Promise<void>;
  destroyMachine(app: string, machine: string): Promise<void>;
};

export type FlyJobGuest = {
  run(command: readonly string[], input?: string | Uint8Array): Promise<{ ok: boolean; exitCode: number; stdout: string; stderr: string }>;
  download?(path: string): Promise<Uint8Array>;
};

const capabilities = ["stop", "recovery"] as const;

/** Fly Machine lifecycle adapter. Machine creation is idempotent by run ID;
 * job payload delivery is a separate guest operation and never enters machine config. */
export class FlyJobExecutionBackend implements ExecutionBackend, JobResultReader, HarnessLogReader, JobFileCollector, ArtifactCollector, ExecutionTerminator {
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
    return { backendKind: this.kind, id: `${this.options.app}/${runId}`, operationId: runId };
  }

  private handleParts(handle: RunHandle): { id: string; operationId?: string } {
    if (handle.backendKind !== this.kind || !handle.id.startsWith(`${this.options.app}/`)) throw new TypeError("Invalid Fly execution handle");
    const id = handle.id.slice(this.options.app.length + 1);
    if (!id || id.includes("/")) throw new TypeError("Invalid Fly execution handle");
    return { id, ...(handle.operationId ? { operationId: handle.operationId } : {}) };
  }

  private async machineId(handle: RunHandle): Promise<string | null> {
    const parts = this.handleParts(handle);
    if (parts.operationId && parts.id === parts.operationId) {
      const machine = await this.options.machines.findMachineByOperationId?.(this.options.app, parts.operationId);
      return machine?.id ?? null;
    }
    return parts.id;
  }

  async launch(request: LaunchRequest): Promise<LaunchReceipt> {
    const operationId = request.runId;
    const handle = request.reservation ?? this.reserve(request.runId);
    this.handleParts(handle);
    const config = flyJobMachineConfig(this.options.app, {
      runId: request.runId,
      operationId,
      image: this.options.image,
      region: this.options.region,
      size: this.options.size,
    });
    const machine = await this.options.machines.createMachine(this.options.app, config, operationId);
    if (!machine.id) throw new Error("Fly returned a Machine without an id");
    const actualHandle = { backendKind: this.kind, id: `${this.options.app}/${machine.id}`, operationId };
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
    const id = await this.machineId(handle);
    if (!id) return { state: "stopped" };
    const machine = await this.options.machines.inspectMachine(this.options.app, id);
    switch (String(machine.state ?? "").toLowerCase()) {
      case "started": case "starting": return { state: "running" };
      case "stopped": case "destroyed": return { state: "succeeded" };
      case "created": case "scheduling": return { state: "starting" };
      default: return { state: "failed", detail: "Fly Machine entered an unexpected state", failure: { source: "system", code: "provider_state_invalid", reason: "Fly Machine entered an unexpected state" } };
    }
  }

  private async guestFor(handle: RunHandle): Promise<FlyJobGuest> {
    const machine = await this.machineId(handle);
    if (!machine) throw new Error("Fly Machine for the persisted run operation was not found");
    return this.options.guest({ id: machine });
  }

  private async download(handle: RunHandle, path: string): Promise<Uint8Array> {
    const guest = await this.guestFor(handle);
    if (!guest.download) throw new Error("Fly guest transport cannot collect files");
    return guest.download(path);
  }

  async readJobResult(handle: RunHandle): Promise<string | null> {
    const guest = await this.guestFor(handle);
    const exists = await guest.run(["/bin/sh", "-c", "test -f /home/exedev/.factorize-job/results.json && printf present || printf missing"]);
    if (!exists.ok) throw new Error("Fly structured result availability check failed");
    if (exists.stdout.trim() === "missing") return null;
    const bytes = await this.download(handle, "/home/exedev/.factorize-job/results.json");
    if (bytes.byteLength > 65_536) return "OVERSIZE";
    try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { throw new Error("Fly structured result is not valid UTF-8"); }
  }

  async readHarnessLog(handle: RunHandle): Promise<string> {
    const guest = await this.guestFor(handle);
    const result = await guest.run(["/bin/sh", "-c", "if [ -f /tmp/factorize.stderr ]; then printf /tmp/factorize.stderr; elif [ -f /tmp/factorize.log ]; then printf /tmp/factorize.log; else exit 2; fi"]);
    if (!result.ok) throw new Error("Fly harness log is unavailable");
    return safeDiagnosticText(new TextDecoder().decode(await this.download(handle, result.stdout.trim())), 256 * 1024);
  }

  async listJobFiles(handle: RunHandle): Promise<string[]> {
    const result = await (await this.guestFor(handle)).run(["/bin/sh", "-c", "find /home/exedev/.factorize-job -mindepth 1 -type f ! -name results.json -printf '%P\\t%s\\n'"]);
    if (!result.ok) throw new Error("Fly job output directory collection failed");
    const paths: string[] = []; let total = 0;
    for (const line of result.stdout.split("\n").filter(Boolean)) {
      const match = /^([^\t\r\0]+)\t(\d+)$/.exec(line);
      if (!match || match[1]!.startsWith("/") || match[1]!.split("/").some(part => !part || part === "." || part === "..") || /[\\\r\n]/.test(match[1]!)) throw new Error("Fly job output directory contains an unsafe path");
      const size = Number(match[2]);
      if (!Number.isSafeInteger(size) || size > 10 * 1024 * 1024) throw new Error("A Fly job output file exceeds the 10 MiB per-file limit");
      total += size; if (total > 50 * 1024 * 1024) throw new Error("Fly job output directory exceeds the 50 MiB total limit");
      paths.push(match[1]!);
    }
    if (paths.length > 100) throw new Error("Fly job output directory exceeds the 100 file limit");
    return paths;
  }

  async collectJobFile(handle: RunHandle, request: JobFileCollectionRequest) {
    if (request.path.split("/").some(part => !part || part === "." || part === "..") || /[\\\r\n\0]/.test(request.path)) throw new TypeError("Unsafe Fly job output path");
    const bytes = await this.download(handle, `/home/exedev/.factorize-job/${request.path}`);
    if (bytes.byteLength > 10 * 1024 * 1024) throw new Error("Fly job output file exceeds the 10 MiB limit");
    return this.upload(request.uploadUrl, bytes, "application/octet-stream");
  }

  async collectArtifact(handle: RunHandle, request: ArtifactCollectionRequest) {
    const guest = await this.guestFor(handle);
    const discover = request.source ? sourceCommand(request.source) : request.discoverCommand;
    if (!discover) throw new Error("Fly artifact source is unavailable");
    const found = await guest.run(["/bin/sh", "-c", discover]);
    if (!found.ok || !found.stdout.trim().startsWith("/")) throw new Error("Fly artifact source could not be resolved");
    return this.upload(request.uploadUrl, await this.download(handle, found.stdout.trim()), request.contentType);
  }

  private async upload(uploadUrl: string, bytes: Uint8Array, contentType: string) {
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const response = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": contentType, "Content-Length": String(bytes.byteLength), "X-Artifact-SHA256": sha256 }, body: Buffer.from(bytes) });
    return { ok: response.ok, detail: response.ok ? undefined : `Fly artifact upload failed (${response.status})` };
  }

  async stop(handle: RunHandle): Promise<ExecutionObservation> {
    const id = await this.machineId(handle);
    if (!id) return { state: "stopped" };
    const machine = await this.options.machines.inspectMachine(this.options.app, id);
    if (["destroyed", "destroying"].includes(String(machine.state ?? "").toLowerCase())) return { state: "stopped" };
    await this.options.machines.stopMachine(this.options.app, id);
    const after = await this.options.machines.inspectMachine(this.options.app, id);
    if (!["stopped", "destroyed"].includes(String(after.state ?? "").toLowerCase())) return { state: "stopping" };
    await this.options.machines.destroyMachine(this.options.app, id);
    return { state: "stopped" };
  }

  async terminate(handle: RunHandle): Promise<ExecutionObservation> {
    const id = await this.machineId(handle);
    if (!id) return { state: "stopped" };
    const machine = await this.options.machines.inspectMachine(this.options.app, id);
    if (["destroyed", "destroying", "stopped"].includes(String(machine.state ?? "").toLowerCase())) return { state: "stopped" };
    await this.options.machines.stopMachine(this.options.app, id);
    const after = await this.options.machines.inspectMachine(this.options.app, id);
    return ["stopped", "destroyed"].includes(String(after.state ?? "").toLowerCase()) ? { state: "stopped" } : { state: "stopping" };
  }
}

/** Production guest adapter; CLI credentials stay in the scheduler process. */
export function flyJobGuest(options: { app: string; machine: string; token: string }) {
  return createFlyGuestTransport({ ...options, timeoutMs: 30_000, outputLimitBytes: 64 * 1024 });
}
