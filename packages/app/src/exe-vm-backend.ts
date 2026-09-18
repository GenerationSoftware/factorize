import type { BackendCommandResult, ExecutionBackend, ExecutionObservation, LaunchReceipt, LaunchRequest, RunHandle } from "./execution";
import { base64 } from "./crypto";
import { defaultAgentCommand, shellAtom, type ExeConnection, type ExeRunConnection } from "./exe";

const API = "https://exe.dev/exec";
const capabilities = ["output", "recovery", "stop"] as const;

export function vmNameFor(runId: string): string {
  const suffix = runId.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(-38) || "run";
  return `factorize-${suffix}`;
}

export function isOwnedVmName(vm: string): boolean {
  return /^factorize-[a-z0-9](?:[a-z0-9-]{0,47}[a-z0-9])?$/.test(vm);
}

function shellWords(value: string): string[] {
  const words: string[] = [];
  for (const match of value.matchAll(/(?:[^\s'\"]+|'[^']*'|\"[^\"]*\")+/g)) words.push(match[0].replace(/^'|'$/g, "").replace(/^\"|\"$/g, ""));
  return words;
}

function agentCommand(connection: ExeRunConnection): string {
  const args = shellWords(connection.agentCommand?.trim() || defaultAgentCommand(connection.agentKind));
  if (connection.agentKind === "codex") args.push(
    "--color", "always",
    "-c", "model_provider=exe-llm",
    "-c", 'model_providers.exe-llm.name="exe-llm"',
    "-c", 'model_providers.exe-llm.base_url="https://llm.int.exe.xyz/v1"',
  );
  if (connection.model?.trim()) args.push("--model", connection.model.trim());
  if (connection.effort?.trim() && connection.agentKind === "codex") args.push("-c", `model_reasoning_effort=${connection.effort.trim()}`);
  return args.map(shellAtom).join(" ");
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

export class ExeVmBackend implements ExecutionBackend {
  readonly kind = "exe-vm";
  readonly capabilities = capabilities;

  constructor(private readonly connection: Pick<ExeConnection, "apiToken" | "tags"> | ExeRunConnection) {}

  private async api(command: string): Promise<BackendCommandResult> {
    const response = await fetch(API, { method: "POST", headers: { Authorization: `Bearer ${this.connection.apiToken}`, "Content-Type": "text/plain" }, body: command });
    const body = await response.text(), exit = response.headers.get("X-Exe-Exit");
    const exitCode = exit && /^\d+$/.test(exit) ? Number(exit) : null;
    return { body, status: response.status, exitCode, ok: response.ok && (exitCode === null || exitCode === 0), requestBody: command };
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

  async validateAgentAndModels(agentKind: "codex" | "claude"): Promise<ExeAgentValidation> {
    const vm = vmNameFor(`validate-${crypto.randomUUID()}`);
    const tags = [...new Set(this.connection.tags)].map(tag => `--tag=${shellAtom(tag)}`).join(" ");
    const created = await this.api(`new --name=${shellAtom(vm)} --no-email --comment=${shellAtom(`Factorize VM ${vm}`)} ${tags}`.trim());
    if (!created.ok) throw new Error(`Could not create the validation VM (${created.status}): ${created.body.slice(0, 300)}`);
    try {
      const binary = agentKind === "codex" ? "codex" : "claude";
      const remote = `command -v ${binary} >/dev/null && curl --fail --silent --show-error https://llm.int.exe.xyz/v1/models | jq -cer '[.data[]?.id | strings] | unique'`;
      let result = await this.api(`ssh ${shellAtom(vm)} ${shellAtom(remote)}`);
      for (let attempt = 1; !result.ok && attempt < 5; attempt++) result = await this.api(`ssh ${shellAtom(vm)} ${shellAtom(remote)}`);
      if (!result.ok) throw new Error(`${binary} or its model integration is unavailable on a VM with these tags (${result.status}): ${result.body.slice(0, 300)}`);
      const parsed: unknown = JSON.parse(result.body);
      if (!Array.isArray(parsed) || parsed.some(model => typeof model !== "string")) throw new Error("The exe.dev model endpoint returned an invalid response");
      return { models: [...new Set(parsed.map(model => model.trim()).filter(Boolean))].sort(), command: result };
    } finally {
      const removed = await this.deleteVm(vm);
      if (!removed.ok) throw new Error(`The validation VM could not be deleted (${removed.status}): ${removed.body.slice(0, 300)}`);
    }
  }

  async launch(request: LaunchRequest): Promise<LaunchReceipt> {
    const connection = this.connection as ExeRunConnection;
    if (!connection.agentKind) throw new Error("The job is missing its agent configuration");
    const vm = vmNameFor(request.runId);
    const tags = [...new Set(this.connection.tags)].map(tag => `--tag=${shellAtom(tag)}`).join(" ");
    const created = await this.api(`new --name=${shellAtom(vm)} --no-email --comment=${shellAtom(`Factorize VM ${vm}`)} ${tags}`.trim());
    if (!created.ok) {
      await this.deleteVm(vm).catch(() => undefined);
      throw new Error(`exe.dev VM creation failed (${created.status}): ${created.body.slice(0, 500)}`);
    }

    const prompt = base64(request.prompt), output = "/tmp/factorize.log", status = "/tmp/factorize.status";
    const work = [
      "set -eu",
      "mkdir -p /home/exedev/workspace",
      "cd /home/exedev/workspace",
      `printf '%s' ${shellAtom(prompt)} | base64 -d > /tmp/factorize-prompt.md`,
      `setsid nohup sh -c ${shellAtom(`set +e; ${agentCommand(connection)} < /tmp/factorize-prompt.md > ${output} 2>&1; code=$?; printf '%s' "$code" > ${status}`)} >/dev/null 2>&1 & echo started`,
    ].join("; ");
    let started = await this.api(`ssh ${shellAtom(vm)} ${shellAtom(work)}`);
    const accepted = (result: BackendCommandResult) => result.ok && result.body.trim() === "started";
    for (let attempt = 1; !accepted(started) && attempt < 5; attempt++) started = await this.api(`ssh ${shellAtom(vm)} ${shellAtom(work)}`);
    if (!accepted(started)) {
      const cleanup = await this.deleteVm(vm);
      const detail = `VM provisioning failed (${started.status}): ${started.body.slice(0, 500)}${cleanup.ok ? "" : `; cleanup also failed: ${cleanup.body.slice(0, 200)}`}`;
      return { handle: { backendKind: this.kind, id: vm }, destinationUrl: `https://${vm}.exe.xyz/`, capabilities, observation: { state: "failed", detail, command: started }, command: started };
    }
    return { handle: { backendKind: this.kind, id: vm }, destinationUrl: `https://${vm}.exe.xyz/`, capabilities, observation: { state: "running", command: started }, command: started };
  }

  async inspect(handle: RunHandle): Promise<ExecutionObservation> {
    const vm = this.vm(handle);
    const result = await this.api(`ssh ${shellAtom(vm)} ${shellAtom('if [ -f /tmp/factorize.status ]; then code=$(cat /tmp/factorize.status); [ "$code" = 0 ] && printf succeeded || printf failed; else printf running; fi')}`);
    if (!result.ok) return result.status >= 500
      ? { state: "running", detail: `VM inspection is temporarily unavailable (${result.status})`, command: result }
      : { state: "failed", detail: `The run-owned VM is unavailable (${result.status}): ${result.body.slice(0, 300)}`, command: result };
    const state = result.body.trim();
    return { state: state === "succeeded" ? "succeeded" : state === "failed" ? "failed" : "running", command: result };
  }

  async readOutput(handle: RunHandle): Promise<string | null> {
    const result = await this.api(`ssh ${shellAtom(this.vm(handle))} ${shellAtom("cat /tmp/factorize.log")}`);
    return result.ok ? result.body : null;
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
