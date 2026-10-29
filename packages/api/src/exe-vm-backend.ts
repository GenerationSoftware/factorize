import { sourceCommand, validateTraceSources } from "./trace-source";
import type { ArtifactCollectionRequest, TraceChunkCollectionRequest } from "./execution";
import type { BackendCommandResult, ExecutionBackend, ExecutionObservation, LaunchReceipt, LaunchRequest, RunHandle } from "./execution";
import { base64 } from "./crypto";
import { shellAtom, type ExeConnection, type ExeRunConnection } from "./exe";

import { HARNESS_LOG_LIMIT, safeDiagnosticText } from "./harness-diagnostics";

const API = "https://exe.dev/exec";
const capabilities = ["output", "recovery", "stop"] as const;

export function vmNameFor(runId: string): string {
  const suffix = runId.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(-38) || "run";
  return `factorize-${suffix}`;
}

export function isOwnedVmName(vm: string): boolean {
  return /^factorize-[a-z0-9](?:[a-z0-9-]{0,47}[a-z0-9])?$/.test(vm);
}

function harnessCommand(harness: NonNullable<LaunchRequest["harness"]>): string {
  const environment = Object.entries(harness.env).map(([name, value]) => `${name}=${shellAtom(value)}`);
  return [...environment, harness.executable, ...harness.args].map((value, index) => index < environment.length ? value : shellAtom(value)).join(" ");
}

export class ExeIntegrationError extends Error {}
export class ExeImageVerificationError extends ExeIntegrationError {
  constructor(public kind: "image_pull" | "permission" | "capacity" | "timeout", message: string) { super(message); }
}

export interface ExePermissionTest { ok: boolean; missingPermissions: string[]; tags: string[]; checks: BackendCommandResult[] }
export interface ExeAgentValidation { models: string[]; command: BackendCommandResult }

export function tagsFromInventory(inventory: unknown): string[] {
  const tags = new Set<string>();
  const visit = (value: unknown, key?: string): void => {
    if (typeof value === "string" && value.startsWith("tag:") && value.length > 4) { tags.add(value.slice(4)); return; }
    if (Array.isArray(value)) { if (key === "tags") value.forEach(tag => typeof tag === "string" && tags.add(tag)); else value.forEach(item => visit(item)); return; }
    if (!value || typeof value !== "object") return;
    Object.entries(value as Record<string, unknown>).forEach(([name, item]) => visit(item, name));
  };
  visit(inventory);
  return [...tags].sort((a, b) => a.localeCompare(b));
}

function inventoryHasOwnedVm(body: string, vm: string): boolean {
  try {
    const value: unknown = JSON.parse(body);
    const visit = (item: unknown): boolean => Array.isArray(item) ? item.some(visit) : !!item && typeof item === "object" && ((item as any).name === vm || (item as any).vm_name === vm) && (item as any).comment === `Factorize VM ${vm}` || !!item && typeof item === "object" && Object.values(item as Record<string, unknown>).some(visit);
    return visit(value);
  } catch { return false; }
}

export class ExeVmBackend implements ExecutionBackend {
  readonly kind = "exe-vm";
  readonly capabilities = capabilities;

  constructor(private readonly connection: Pick<ExeConnection, "apiToken" | "tags"> & { image?: string } | ExeRunConnection) {}

  private async api(command: string): Promise<BackendCommandResult> {
    const response = await fetch(API, { method: "POST", headers: { Authorization: `Bearer ${this.connection.apiToken}`, "Content-Type": "text/plain" }, body: command });
    const body = await response.text(), exit = response.headers.get("X-Exe-Exit");
    const exitCode = exit && /^\d+$/.test(exit) ? Number(exit) : null;
    return { body, status: response.status, exitCode, ok: response.ok && (exitCode === null || exitCode === 0), requestBody: command };
  }

  private validationFailure(message: string, result: BackendCommandResult): ExeIntegrationError {
    const detail = safeDiagnosticText(result.body.split(this.connection.apiToken).join("[REDACTED]"), 300);
    return new ExeIntegrationError(`${message} (HTTP ${result.status}${result.exitCode === null ? "" : `, exit ${result.exitCode}`}): ${detail}`);
  }

  async testPermissions(): Promise<ExePermissionTest> {
    const commands = ["ls --json", "integrations list --json", "new --help", "ssh --help", "rm --help"];
    const checks = await Promise.all(commands.map(command => this.api(command)));
    let tags: string[] = [];
    for (const check of checks.slice(0, 2)) if (check.ok) try { tags.push(...tagsFromInventory(JSON.parse(check.body))); } catch { /* use the remaining tag source */ }
    tags = [...new Set(tags)].sort((a, b) => a.localeCompare(b));
    const missingPermissions = checks.filter(check => check.status === 403).map(check => String(check.requestBody).split(" ")[0]);
    // exe.dev uses 403 specifically for a command excluded by token permissions.
    // A help probe may return 422 when its command parser wants an argument; that
    // still proves the token was authorized to invoke that command.
    const ok = !missingPermissions.length && checks.every((check, index) => check.ok || (index >= 2 && ((check.status >= 200 && check.status < 300) || check.status === 422)));
    return { ok, missingPermissions, tags, checks };
  }

  async test(): Promise<BackendCommandResult> { return this.api("ls --json"); }

  async validateAgentAndModels(agentKind: "codex" | "claude" | "pi"): Promise<ExeAgentValidation> {
    const vm = vmNameFor(`validate-${crypto.randomUUID()}`);
    const tags = [...new Set(this.connection.tags)].map(tag => `--tag=${shellAtom(tag)}`).join(" ");
    const created = await this.api(`new --name=${shellAtom(vm)} --no-email --comment=${shellAtom(`Factorize VM ${vm}`)} ${tags}`.trim());
    if (!created.ok) throw this.validationFailure("Could not create the validation VM. Check your exe.dev VM capacity and token permissions", created);
    try {
      const binary = agentKind;
      const remote = `command -v ${binary} >/dev/null && curl --fail --silent --show-error https://llm.int.exe.xyz/v1/models | jq -cer '[.data[]?.id | strings] | unique'`;
      let result = await this.api(`ssh ${shellAtom(vm)} ${shellAtom(remote)}`);
      for (let attempt = 1; !result.ok && attempt < 5; attempt++) result = await this.api(`ssh ${shellAtom(vm)} ${shellAtom(remote)}`);
      if (!result.ok) throw this.validationFailure(`${binary} or its model integration is unavailable. Check that the agent is installed and the llm integration is attached to VMs with the selected tags`, result);
      let parsed: unknown;
      try { parsed = JSON.parse(result.body); } catch { throw new ExeIntegrationError("The exe.dev model endpoint returned invalid JSON"); }
      if (!Array.isArray(parsed) || parsed.some(model => typeof model !== "string")) throw new ExeIntegrationError("The exe.dev model endpoint returned an invalid response");
      return { models: [...new Set(parsed.map(model => model.trim()).filter(Boolean))].sort(), command: result };
    } finally {
      const removed = await this.deleteVm(vm);
      if (!removed.ok) throw this.validationFailure(`The validation VM ${vm} could not be deleted. Remove it in exe.dev and check the token rm permission`, removed);
    }
  }

  async verifyImage(verificationId: string, image: string, agentKind: "codex" | "claude" | "pi", progress: (phase: string) => Promise<void> = async () => {}): Promise<void> {
    const vm = vmNameFor(`verify-${verificationId}`);
    const tags = [...new Set(this.connection.tags)].map(tag => `--tag=${shellAtom(tag)}`).join(" ");
    const command = `new --name=${shellAtom(vm)} --no-email --comment=${shellAtom(`Factorize VM ${vm}`)}${tags ? ` ${tags}` : ""} --image=${shellAtom(image)}`;
    let created: BackendCommandResult | undefined, vmMayExist = false;
    try { created = await this.api(command); }
    catch {
      // The HTTPS API has a 30-second timeout. Reconcile by the deterministic
      // Factorize name and ownership marker before reporting an ambiguous create.
      const inventory = await this.api("ls --json").catch(() => null);
      vmMayExist = Boolean(inventory?.ok && inventoryHasOwnedVm(inventory.body, vm));
      if (!vmMayExist) throw new ExeImageVerificationError("timeout", "Image creation timed out and no owned VM was found during reconciliation. Retry verification after checking exe.dev.");
    }
    if (created?.ok) vmMayExist = true;
    else if (created && !created.ok) {
      const inventory = await this.api("ls --json").catch(() => null);
      vmMayExist = Boolean(inventory?.ok && inventoryHasOwnedVm(inventory.body, vm));
      if (!vmMayExist) {
        const kind = created.status === 403 ? "permission" : [429, 507].includes(created.status) ? "capacity" : [408, 504].includes(created.status) ? "timeout" : created.status === 503 && /capacity/i.test(created.body) ? "capacity" : "image_pull";
        const detail = this.validationFailure("Image creation or pull failed. Check that the image is public, its reference is correct, and exe.dev has VM capacity and new permission", created);
        throw new ExeImageVerificationError(kind, detail.message);
      }
    }
    try {
      await progress("checking_ssh");
      let ssh = await this.api(`ssh ${shellAtom(vm)} ${shellAtom("true")}`).catch(() => null);
      for (let attempt = 1; (!ssh || !ssh.ok) && attempt < 6; attempt++) ssh = await this.api(`ssh ${shellAtom(vm)} ${shellAtom("true")}`).catch(() => null);
      if (!ssh?.ok) throw new ExeIntegrationError(`ssh: VM was created from the image, but SSH access failed (${ssh?.status ?? "timeout"}). Ensure the image boots an exe.dev-compatible system with SSH enabled.`);
      await progress("checking_agent");
      const check = `command -v ${shellAtom(agentKind)} >/dev/null 2>&1 && command -v curl >/dev/null 2>&1 && command -v jq >/dev/null 2>&1`;
      const agent = await this.api(`ssh ${shellAtom(vm)} ${shellAtom(check)}`).catch(() => null);
      if (!agent?.ok) throw new ExeIntegrationError(`agent: SSH works, but the selected ${agentKind} harness prerequisites are missing. Use an image with ${agentKind}, curl, and jq installed.`);
    } finally {
      await progress("cleaning_up");
      const removed = await this.deleteVm(vm);
      if (!removed.ok) throw new ExeIntegrationError(`cleanup: Temporary VM ${vm} could not be deleted. It will be retried; remove it in exe.dev if it remains.`);
    }
  }

  async launch(request: LaunchRequest): Promise<LaunchReceipt> {
    const connection = this.connection as ExeRunConnection;
    if (!connection.agentKind) throw new Error("The job is missing its agent configuration");
    if (!request.harness) throw new Error("The run is missing its agent harness launch plan");
    if (request.traceSources) validateTraceSources(request.traceSources);
    const vm = vmNameFor(request.runId);
    const tags = [...new Set(this.connection.tags)].map(tag => `--tag=${shellAtom(tag)}`).join(" ");
    const image = connection.image;
    const created = await this.api(`new --name=${shellAtom(vm)} --no-email --comment=${shellAtom(`Factorize VM ${vm}`)} ${tags}${image ? ` --image=${shellAtom(image)}` : ""}`.trim());
    if (!created.ok) {
      await this.deleteVm(vm).catch(() => undefined);
      throw new Error(`exe.dev VM creation failed (${created.status}): ${created.body.slice(0, 500)}`);
    }

    const prompt = base64(request.prompt), output = request.traceSources?.primary.formatVersion === "codex-exec-jsonl" ? request.traceSources.primary.path : "/tmp/factorize.log", unit = vm;
    const work = [
      "set -eu",
      "mkdir -p /home/exedev/workspace",
      "cd /home/exedev/workspace",
      ...(request.traceSources?.primary.kind === "execution_stream" ? [`mkdir -p -- ${shellAtom(request.traceSources.primary.path.slice(0, request.traceSources.primary.path.lastIndexOf("/")) || "/")}`, `touch -- ${shellAtom(request.traceSources.primary.path)}`] : []),
      `printf '%s' ${shellAtom(prompt)} | base64 -d > /tmp/factorize-prompt.md`,
      `if [ "$(sudo systemctl show ${shellAtom(unit)} --property=LoadState --value 2>/dev/null || true)" != loaded ]; then sudo systemd-run --quiet --uid=exedev --gid=exedev --unit=${shellAtom(unit)} --property=Type=exec --property=RemainAfterExit=yes --property=WorkingDirectory=/home/exedev/workspace --property=StandardInput=file:/tmp/factorize-prompt.md --property=StandardOutput=${output === "/tmp/factorize.log" ? `append:${output}` : shellAtom(`append:${output}`)} --property=StandardError=append:/tmp/factorize.stderr ${harnessCommand(request.harness)}; fi`,
      "echo started",
    ].join("; ");
    if (request.traceSources?.primary.formatVersion === "codex-exec-jsonl") {
      const version = await this.api(`ssh ${shellAtom(vm)} ${shellAtom("codex --version")}`).catch(() => null);
      if (version?.ok && /^codex-cli [0-9][0-9A-Za-z.+-]*$/.test(version.body.trim())) request.traceSources.primary.cliVersion = version.body.trim();
    }
    let started = await this.api(`ssh ${shellAtom(vm)} ${shellAtom(work)}`);
    const accepted = (result: BackendCommandResult) => result.ok && result.body.trim() === "started";
    for (let attempt = 1; !accepted(started) && attempt < 5; attempt++) started = await this.api(`ssh ${shellAtom(vm)} ${shellAtom(work)}`);
    if (!accepted(started)) {
      const detail = `VM provisioning failed (${started.status}): ${safeDiagnosticText(started.body, 500)}`;
      return { handle: { backendKind: this.kind, id: vm }, destinationUrl: `https://${vm}.exe.xyz/`, capabilities, observation: { state: "failed", detail, command: started }, command: started };
    }
    return { handle: { backendKind: this.kind, id: vm }, destinationUrl: `https://${vm}.exe.xyz/`, capabilities, observation: { state: "running", command: started }, command: started };
  }

  async inspect(handle: RunHandle): Promise<ExecutionObservation> {
    const vm = this.vm(handle);
    const inspect = `sudo systemctl show ${shellAtom(vm)} --property=LoadState,ActiveState,SubState,Result,ExecMainCode,ExecMainStatus`;
    let response: BackendCommandResult;
    try { response = await this.api(`ssh ${shellAtom(vm)} ${shellAtom(inspect)}`); }
    catch { return { state: "running", detail: "VM inspection is temporarily unavailable" }; }
    // systemctl can return nonzero for a missing unit, but still emits LoadState.
    if (!response.ok && !response.body.includes("LoadState=not-found")) return ![404, 410].includes(response.status)
      ? { state: "running", detail: `VM inspection is temporarily unavailable (${response.status})` }
      : { state: "failed", detail: `The run-owned VM is unavailable (${response.status})` };
    const properties = Object.fromEntries(response.body.split("\n").filter(line => /^[A-Za-z]+=/.test(line)).map(line => { const index = line.indexOf("="); return [line.slice(0, index), line.slice(index + 1).trim()]; }));
    const label = (name: string) => /^[a-z-]{1,64}$/.test(properties[name] ?? "") ? properties[name] : "";
    const number = (name: string) => /^\d{1,10}$/.test(properties[name] ?? "") ? Number(properties[name]) : null;
    const systemd = { loadState: label("LoadState"), activeState: label("ActiveState"), subState: label("SubState"), result: label("Result"), execMainCode: number("ExecMainCode"), execMainStatus: number("ExecMainStatus") };
    if (!systemd.loadState) return { state: "running", detail: "VM inspection returned incomplete supervisor metadata" };
    if (systemd.loadState !== "loaded") return { state: "failed", systemd, detail: "The run supervisor disappeared before recording a result." };
    if (["running", "start"].includes(systemd.subState) || ["activating", "deactivating"].includes(systemd.activeState)) return { state: "running", systemd };
    if (!systemd.activeState || !systemd.subState || !systemd.result || systemd.execMainStatus === null || systemd.execMainCode === null) return { state: "running", detail: "VM inspection returned incomplete supervisor metadata" };
    if (systemd.result === "success" && systemd.execMainStatus === 0) return { state: "succeeded", systemd };
    return { state: "failed", systemd, detail: `The supervised agent process exited unsuccessfully (Result=${systemd.result}, ExecMainCode=${systemd.execMainCode}, ExecMainStatus=${systemd.execMainStatus}).` };
  }

  /** Stop the writer but preserve the guest until terminal artifacts are retained. */
  async terminate(handle: RunHandle): Promise<ExecutionObservation> {
    const result = await this.api(`ssh ${shellAtom(this.vm(handle))} ${shellAtom(`sudo systemctl stop ${shellAtom(this.vm(handle))}`)}`);
    if (!result.ok) return { state: "stopping", detail: "Agent process termination is temporarily unavailable" };
    return { ...await this.inspect(handle), state: "stopped" };
  }

  async readHarnessLog(handle: RunHandle): Promise<string> {
    // Read the first bounded bytes: starting in the middle of a credential could evade redaction.
    // Old VMs have only the combined log.
    const remote = `if [ -f /tmp/factorize.stderr ]; then head -c ${HARNESS_LOG_LIMIT} /tmp/factorize.stderr; else head -c ${HARNESS_LOG_LIMIT} /tmp/factorize.log; fi`;
    const response = await this.api(`ssh ${shellAtom(this.vm(handle))} ${shellAtom(remote)}`);
    if (!response.ok) throw new Error(`Harness log collection failed (${response.status})`);
    // Drop a possibly cut final line before redaction. Never retain a partial credential.
    const text = new TextEncoder().encode(response.body).length >= HARNESS_LOG_LIMIT
      ? response.body.slice(0, response.body.lastIndexOf("\n") + 1) + "\n[Harness log truncated]\n" : response.body;
    return safeDiagnosticText(text, HARNESS_LOG_LIMIT);
  }

  async readOutput(handle: RunHandle): Promise<string | null> {
    const result = await this.api(`ssh ${shellAtom(this.vm(handle))} ${shellAtom("cat /tmp/factorize.log")}`);
    return result.ok ? result.body : null;
  }

  async collectArtifact(handle: RunHandle, request: ArtifactCollectionRequest) {
    const remote = `set -eu; file=$(${request.source ? sourceCommand(request.source) : request.discoverCommand}); test -n "$file"; test -f "$file"; snapshot=$(mktemp); trap 'rm -f "$snapshot"' EXIT; cp "$file" "$snapshot"; size=$(wc -c < "$snapshot" | tr -d ' '); sha=$(sha256sum "$snapshot" | cut -d' ' -f1); curl --fail --silent --show-error -X PUT -H ${shellAtom(`Content-Type: ${request.contentType}`)} -H "Content-Length: $size" -H "X-Artifact-SHA256: $sha" --data-binary @"$snapshot" ${shellAtom(request.uploadUrl)}`;
    const result = await this.api(`ssh ${shellAtom(this.vm(handle))} ${shellAtom(remote)}`);
    return { ok: result.ok, detail: result.ok ? undefined : `Artifact upload failed (${result.status}): ${result.body.slice(0, 300)}`, command: result };
  }

  async collectTraceChunk(handle: RunHandle, request: TraceChunkCollectionRequest) {
    const expectedGeneration = request.generation ?? "", zeroHash = "0".repeat(64);
    const remote = `set -eu; file=$(${request.source ? sourceCommand(request.source) : request.discoverCommand}); test -n "$file"; test -f "$file"; exec 3<"$file"; file=/proc/$$/fd/3; identity=$(stat -Lc '%d:%i:%W' "$file"); generation="$identity"; case ${shellAtom(expectedGeneration)} in "$identity":*) generation=${shellAtom(expectedGeneration)};; esac; start=${request.offset}; previous=${shellAtom(request.previousHash)}; if [ -n ${shellAtom(expectedGeneration)} ] && [ "$generation" != ${shellAtom(expectedGeneration)} ]; then start=0; previous=${shellAtom(zeroHash)}; fi; total=$(wc -c < "$file" | tr -d ' '); if [ "$total" -lt "$start" ]; then generation="$identity:$(date +%s%N)"; start=0; previous=${shellAtom(zeroHash)}; fi; if [ "$total" -le "$start" ]; then printf 'no-change'; exit 0; fi; count=$((total-start)); if [ "$count" -gt 4194304 ]; then count=4194304; fi; chunk=$(mktemp); trap 'rm -f "$chunk"' EXIT; dd if="$file" of="$chunk" iflag=skip_bytes,count_bytes skip="$start" count="$count" status=none; size=$(wc -c < "$chunk" | tr -d ' '); sha=$(sha256sum "$chunk" | cut -d' ' -f1); curl --fail --silent --show-error -X PUT -H "Content-Length: $size" -H "X-Trace-Generation: $generation" -H ${shellAtom(`X-Trace-Expected-Generation: ${expectedGeneration}`)} -H "X-Trace-Start: $start" -H "X-Trace-SHA256: $sha" -H "X-Trace-Previous-Hash: $previous" --data-binary @"$chunk" ${shellAtom(request.uploadUrl)}`;
    const result = await this.api(`ssh ${shellAtom(this.vm(handle))} ${shellAtom(remote)}`);
    return { ok: result.ok, detail: result.ok ? undefined : `Live trace upload failed (${result.status}): ${result.body.slice(0, 300)}`, command: result };
  }

  async stop(handle: RunHandle): Promise<ExecutionObservation> {
    const result = await this.deleteVm(this.vm(handle));
    return { state: result.ok ? "stopped" : "failed", detail: result.ok ? undefined : `VM deletion failed (${result.status}): ${result.body.slice(0, 300)}`, command: result };
  }

  private async deleteVm(vm: string): Promise<BackendCommandResult> {
    if (!isOwnedVmName(vm)) throw new Error("Refusing to delete a VM that is not owned by Factorize");
    const listed = await this.api("ls --json");
    if (!listed.ok) return listed;
    let inventory: unknown;
    try { inventory = JSON.parse(listed.body); }
    catch { return { ...listed, ok: false, status: 502, body: "exe.dev returned an invalid VM inventory" }; }
    const objects: Record<string, unknown>[] = [];
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) return value.forEach(visit);
      if (!value || typeof value !== "object") return;
      objects.push(value as Record<string, unknown>);
      Object.values(value).forEach(visit);
    };
    visit(inventory);
    const found = objects.find(item => item.name === vm || item.vm_name === vm);
    if (!found) return { ...listed, ok: true, status: 404, body: "VM is already absent" };
    if (found.comment !== `Factorize VM ${vm}`) return { ...listed, ok: false, status: 409, body: "VM ownership marker does not match" };
    let result: BackendCommandResult | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      result = await this.api(`rm ${shellAtom(vm)}`);
      if (result.ok || result.status === 404) return { ...result, ok: true };
    }
    return result!;
  }

  private vm(handle: RunHandle): string {
    if (handle.backendKind !== this.kind || !isOwnedVmName(handle.id)) throw new Error("Invalid exe-vm execution handle");
    return handle.id;
  }
}
