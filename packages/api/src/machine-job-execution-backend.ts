import type { ExecutionBackend, ExecutionObservation, LaunchReceipt, LaunchRequest, RunHandle } from "./execution";
export type JobMachine = { id: string; name?: string; state?: string; config?: { metadata?: Record<string, string> } };
export type JobMachineConfig = Record<string, unknown> & { metadata?: Record<string, string> };
import { safeDiagnosticText } from "./harness-diagnostics";
import type { TraceChunkCollectionRequest, ArtifactCollectionRequest, ArtifactCollector, ExecutionTerminator, HarnessLogReader, JobFileCollectionRequest, JobFileCollector, JobResultReader } from "./execution";
import { sourceCommand } from "./trace-source";
import { FACTORIZE_JOB_LAUNCHER } from "./factorize-job-launcher";
import { traceChunkCommand } from "./guest-artifact-commands";
import { runArtifactTarget } from "./run-artifact-target";
import { shellAtom } from "./exe";
import { RUN_IDENTITY_GUEST_HELPER } from "./run-identity-guest-helper";
import { acquireFlyMachineOidcToken } from "./vendor-run-token-sources";

const SUPPORTED_CODEX_CLI_VERSION = "codex-cli 0.167.1";

export type JobMachines = {
  findMachineByOperationId?(app: string, operationId: string): Promise<JobMachine | undefined>;
  createMachine(app: string, config: JobMachineConfig, operationId: string): Promise<JobMachine>;
  inspectMachine(app: string, machine: string): Promise<JobMachine>;
  startMachine(app: string, machine: string): Promise<void>;
  stopMachine(app: string, machine: string): Promise<void>;
  destroyMachine(app: string, machine: string): Promise<void>;
};

export type JobGuest = {
  run(command: readonly string[], input?: string | Uint8Array): Promise<{ ok: boolean; exitCode: number; stdout: string; stderr: string }>;
  upload?(path: string, bytes: Uint8Array): Promise<void>;
  download?(path: string): Promise<Uint8Array>;
};

const capabilities = ["stop", "recovery"] as const;

/** Shared Machine lifecycle orchestration. Machine creation is idempotent by run ID;
 * job payload delivery is a separate guest operation and never enters machine config. */
export class MachineJobExecutionBackend implements ExecutionBackend, JobResultReader, HarnessLogReader, JobFileCollector, ArtifactCollector, ExecutionTerminator {
  get kind(): string { return this.options.kind; }
  readonly capabilities = capabilities;

  constructor(
    private readonly options: {
      kind: "fly";
      prepare?: () => Promise<void>;
      machineConfig: (request: LaunchRequest) => JobMachineConfig;
      app: string;
      image: string;
      machines: JobMachines;
      guest: (machine: JobMachine) => JobGuest;
      destinationUrl?: (machine: JobMachine) => string;
      vendorIdentityAudience?: (runId: string) => string;
      vendorIdentitySubject?: (machine: JobMachine) => string;
      vendorIdentityIssuer?: string;
      verifyVendorIdentity?: (input: { provider: "exe.dev" | "fly.io"; vmId: string; token: string; integrationName?: string; expectedIssuer?: string; expectedSubject?: string }) => Promise<void>;
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
    const config = this.options.machineConfig(request);
    if (request.runIdentity && (this.kind !== "fly" || !(request.verifyVendorIdentity ?? this.options.verifyVendorIdentity))) throw new Error("Vendor identity is required for run access");
    await this.options.prepare?.();
    const machine = await this.options.machines.createMachine(this.options.app, config, operationId);
    if (!machine.id) throw new Error("Fly returned a Machine without an id");
    const actualHandle = { backendKind: this.kind, id: `${this.options.app}/${machine.id}`, operationId, ...(request.runIdentity ? {identityProxyOrigin: request.runIdentity.backendOrigin} : {}) };
    try {
      await this.options.machines.startMachine(this.options.app, machine.id);
      const guest = this.options.guest(machine);
      const verifyVendorIdentity = request.verifyVendorIdentity ?? this.options.verifyVendorIdentity;
      if (this.kind === "fly" && verifyVendorIdentity) {
        const audience = this.options.vendorIdentityAudience?.(request.runId);
        if (!audience) throw new Error("Fly vendor identity audience is unavailable");
        const token = await acquireFlyMachineOidcToken({ guest, audience });
        const expectedSubject = this.options.vendorIdentitySubject?.(machine);
        if (this.options.vendorIdentitySubject && !expectedSubject) throw new Error("Fly vendor identity subject is unavailable");
        await verifyVendorIdentity({ provider: "fly.io", vmId: machine.id, token, ...(this.options.vendorIdentityIssuer ? { expectedIssuer: this.options.vendorIdentityIssuer } : {}), ...(expectedSubject ? { expectedSubject } : {}) });
      }
      const tunnelPrerequisites = request.runIdentity ? " && command -v node >/dev/null && command -v curl >/dev/null" : "";
      const installed = await guest.run(["/bin/sh", "-c", `command -v python3 >/dev/null && command -v runuser >/dev/null${tunnelPrerequisites} && id exedev >/dev/null && mkdir -p /usr/local/bin && install -d -o exedev -g exedev -m 0700 /home/exedev/.factorize-job && cat > /usr/local/bin/factorize-job && chmod 0755 /usr/local/bin/factorize-job`], FACTORIZE_JOB_LAUNCHER);
      if (!installed.ok) throw new Error("Fly guest is missing the shared launcher or vendor identity helper prerequisites");
      if (request.harness?.executable === "codex") {
        const version = await guest.run(["/usr/sbin/runuser", "-u", "exedev", "--", "codex", "--version"]);
        if (!version.ok || version.stdout.trim() !== SUPPORTED_CODEX_CLI_VERSION) {
          throw new Error(`Fly guest requires ${SUPPORTED_CODEX_CLI_VERSION} for Codex jobs`);
        }
      }
      if (request.runIdentity) {
        if (!guest.upload) throw new Error("Fly guest cannot install the vendor identity helper");
        const directory = "/run/factorize-identity";
        const prepared = await guest.run(["/usr/bin/install", "-d", "-m", "0700", directory]);
        if (!prepared.ok) throw new Error("Fly guest could not prepare run identity access");
        await guest.upload(`${directory}/proxy.mjs`, new TextEncoder().encode(RUN_IDENTITY_GUEST_HELPER));
        await guest.upload(`${directory}/config.json`, new TextEncoder().encode(JSON.stringify({runId: request.runId, backendOrigin: request.runIdentity.backendOrigin, provider: "fly.io", localPort: 18180})));
        const started = await guest.run(["/bin/sh", "-c", "nohup node /run/factorize-identity/proxy.mjs >/tmp/factorize-identity-proxy.log 2>&1 </dev/null & echo $! > /run/factorize-identity/pid; n=0; until curl --fail --silent http://127.0.0.1:18180/_factorize/ready >/dev/null; do n=$((n+1)); test $n -lt 50 || exit 1; sleep 0.1; done"]);
        if (!started.ok) throw new Error("Fly guest vendor identity helper did not become ready");
      }
      const payload = JSON.stringify({ version: 1, runId: request.runId, ...(request.code ? { code: request.code } : { prompt: request.prompt, harness: request.harness }), ...(request.traceSources ? { traceSources: request.traceSources } : {}) });
      const launchCommand = request.runIdentity
        ? ["/usr/sbin/runuser", "-u", "exedev", "--", "/usr/bin/env", "FACTORIZE_PROXY_URL=http://127.0.0.1:18180", "/usr/local/bin/factorize-job", "launch"]
        : ["/usr/sbin/runuser", "-u", "exedev", "--", "/usr/local/bin/factorize-job", "launch"];
      const started = await guest.run(launchCommand, `${payload}\n`);
      if (!started.ok || started.stdout.trim() !== "started") throw new Error("Fly guest did not confirm job launch");
      return {
        handle: actualHandle,
        destinationUrl: this.options.destinationUrl?.(machine) ?? `${this.kind}://${this.options.app}/${machine.id}`,
        capabilities,
        observation: { state: "running" },
      };
    } catch (error) {
      // Keep the persisted machine handle available to scheduler cleanup when
      // guest startup fails after provider creation.
      return {
        handle: actualHandle,
        destinationUrl: this.options.destinationUrl?.(machine) ?? `${this.kind}://${this.options.app}/${machine.id}`,
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
      case "started": {
        const runId = handle.operationId;
        const audience = runId && this.options.vendorIdentityAudience?.(runId);
        if (runId && audience && this.options.verifyVendorIdentity) {
          try {
            const token = await acquireFlyMachineOidcToken({ guest: this.options.guest({ id }), audience });
            const expectedSubject = this.options.vendorIdentitySubject?.(machine);
            if (this.options.vendorIdentitySubject && !expectedSubject) throw new Error("Fly vendor identity subject is unavailable");
            await this.options.verifyVendorIdentity({ provider: "fly.io", vmId: id, token, ...(this.options.vendorIdentityIssuer ? { expectedIssuer: this.options.vendorIdentityIssuer } : {}), ...(expectedSubject ? { expectedSubject } : {}) });
          } catch {
            return { state: "failed", detail: "Fly Machine vendor identity renewal failed", failure: { source: "system", code: "vendor_identity_renewal_failed", reason: "Fly Machine vendor identity renewal failed" } };
          }
        }
        try {
          const result = await this.options.guest(machine).run(["/usr/sbin/runuser", "-u", "exedev", "--", "/usr/local/bin/factorize-job", "status"]);
          if (result.ok) {
            const process = JSON.parse(result.stdout) as { state?: string; exitCode?: number };
            if (process.state === "exited") return process.exitCode === 0 ? { state: "succeeded" } : { state: "failed", detail: "The guest job process exited unsuccessfully", failure: { source: "run", code: "process_failed", reason: "The guest job process exited unsuccessfully" } };
          }
        } catch { /* Guest status may be temporarily unavailable while booting. */ }
        return { state: "running" };
      }
      case "starting": return { state: "running" };
      case "stopped": case "destroyed": return { state: "succeeded" };
      case "created": case "scheduling": return { state: "starting" };
      default: return { state: "failed", detail: "Fly Machine entered an unexpected state", failure: { source: "system", code: "provider_state_invalid", reason: "Fly Machine entered an unexpected state" } };
    }
  }

  private async guestFor(handle: RunHandle): Promise<JobGuest> {
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
    const result = await guest.run(["/bin/sh", "-c", "if [ -s /tmp/factorize.stderr ]; then printf /tmp/factorize.stderr; elif [ -f /tmp/factorize.log ]; then printf /tmp/factorize.log; else exit 2; fi"]);
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
    const file = `/home/exedev/.factorize-job/${request.path}`;
    const command = `set -eu; file=${shellAtom(file)}; test -f "$file"; test ! -L "$file"; real=$(realpath -- "$file"); case "$real" in /home/exedev/.factorize-job/*) ;; *) exit 41;; esac; size=$(wc -c < "$file" | tr -d ' '); test "$size" -le 10485760; sha=$(sha256sum "$file" | cut -d' ' -f1); curl --fail --silent --show-error -X PUT -H 'Content-Type: application/octet-stream' -H "Content-Length: $size" -H "X-Artifact-SHA256: $sha" --data-binary @"$file" ${shellAtom(runArtifactTarget(handle, request.uploadUrl))}`;
    const result = await (await this.guestFor(handle)).run(["/bin/sh", "-c", command]);
    return {ok: result.ok, detail: result.ok ? undefined : "Fly job file upload failed"};
  }

  async collectArtifact(handle: RunHandle, request: ArtifactCollectionRequest) {
    const discover = request.source ? sourceCommand(request.source) : request.discoverCommand;
    if (!discover) throw new Error("Fly artifact source is unavailable");
    const command = `set -eu; file=$(${discover}); test -n "$file"; test -f "$file"; snapshot=$(mktemp); trap 'rm -f "$snapshot"' EXIT; cp "$file" "$snapshot"; size=$(wc -c < "$snapshot" | tr -d ' '); sha=$(sha256sum "$snapshot" | cut -d' ' -f1); curl --fail --silent --show-error -X PUT -H ${shellAtom(`Content-Type: ${request.contentType}`)} -H "Content-Length: $size" -H "X-Artifact-SHA256: $sha" --data-binary @"$snapshot" ${shellAtom(runArtifactTarget(handle, request.uploadUrl))}`;
    const result = await (await this.guestFor(handle)).run(["/bin/sh", "-c", command]);
    return {ok: result.ok, detail: result.ok ? undefined : "Fly artifact upload failed"};
  }

  async collectTraceChunk(handle: RunHandle, request: TraceChunkCollectionRequest) {
    const result = await (await this.guestFor(handle)).run(["/bin/sh", "-c", traceChunkCommand(request, runArtifactTarget(handle, request.uploadUrl))]);
    return {ok: result.ok, detail: result.ok ? undefined : "Fly trace chunk upload failed"};
  }

  async stop(handle: RunHandle): Promise<ExecutionObservation> {
    const id = await this.machineId(handle);
    if (!id) return { state: "stopped" };
    const machine = await this.options.machines.inspectMachine(this.options.app, id);
    if (["destroyed", "destroying"].includes(String(machine.state ?? "").toLowerCase())) return { state: "stopped" };
    if (String(machine.state ?? "").toLowerCase() !== "stopped") {
      await this.options.machines.stopMachine(this.options.app, id);
    }
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

