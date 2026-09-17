import type { ExecutionBackend, ExecutionObservation, LaunchReceipt, LaunchRequest, PromptDeliveryReceipt, RunHandle } from "./execution";
import { base64 } from "./crypto";
import { shellAtom, type ExeConnection } from "./exe";

/** Account credentials used to create and destroy run-owned VMs. */
export interface ExeVmConnection extends ExeConnection {
  /** Account-level exe.dev token; it must be allowed to run new, ssh and rm. */
  accountToken?: string;
  tags?: string[];
  repositoryUrl?: string;
  checkoutRef?: string;
}

const API = "https://exe.dev/exec";
const capabilities = ["output", "recovery", "stop"] as const;

function vmNameFor(runId: string): string {
  const suffix = runId.replace(/[^a-zA-Z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(-38) || "run";
  return `factorize-${suffix}`.slice(0, 63);
}

function commandResult(ok: boolean, status: number, body: string, requestBody: string, exitCode: number | null = null) {
  return { ok, status, body, requestBody, exitCode };
}

/** Adapter for the documented exe.dev HTTPS command API. Every run owns one VM. */
export class ExeVmBackend implements ExecutionBackend {
  readonly kind = "exe-vm";
  readonly capabilities = capabilities;
  constructor(private readonly connection: ExeVmConnection, private readonly launchContext?: { repositoryUrl?: string; checkoutRef?: string; cwd?: string; tags?: string[] }) {}

  private token(): string { return this.connection.accountToken || this.connection.apiToken; }
  private async api(command: string) {
    const response = await fetch(API, { method: "POST", headers: { Authorization: `Bearer ${this.token()}`, "Content-Type": "text/plain" }, body: command });
    const body = await response.text();
    const exit = response.headers.get("X-Exe-Exit");
    return { body, status: response.status, exitCode: exit && /^\d+$/.test(exit) ? Number(exit) : null, ok: response.ok && (!exit || exit === "0"), requestBody: command };
  }

  async launch(request: LaunchRequest): Promise<LaunchReceipt> {
    const vm = vmNameFor(request.runId), tags = [...new Set(this.launchContext?.tags || this.connection.tags || [])];
    const tagArgs = tags.map(tag => `--tag=${shellAtom(tag)}`).join(" ");
    const created = await this.api(`new --json --name=${shellAtom(vm)} --no-email ${tagArgs}`.trim());
    if (!created.ok) throw new Error(`exe.dev VM creation failed (${created.status}): ${created.body.slice(0, 500)}`);
    const cwd = this.launchContext?.cwd || this.connection.cwd || "/workspace";
    const repo = this.launchContext?.repositoryUrl || this.connection.repositoryUrl;
    const ref = this.launchContext?.checkoutRef || this.connection.checkoutRef;
    const clone = repo ? `git clone ${shellAtom(repo)} repo && cd repo${ref ? ` && git checkout ${shellAtom(ref)}` : ""} && ` : "";
    const prompt = base64(request.prompt);
    const agent = this.connection.agentKind === "claude" ? "claude --dangerously-skip-permissions" : "codex --dangerously-bypass-approvals-and-sandbox";
    const runKey = vm.slice(9), output = `/tmp/factorize-${runKey}.log`, status = `/tmp/factorize-${runKey}.status`;
    const work = `mkdir -p ${shellAtom(cwd)} && cd ${shellAtom(cwd)} && ${clone}printf '%s' ${shellAtom(prompt)} | base64 -d > /tmp/factorize-prompt.md && setsid nohup sh -c ${shellAtom(`${agent} < /tmp/factorize-prompt.md > ${output} 2>&1; printf '%s' "$?" > ${status}`)} >/dev/null 2>&1 & echo started`;
    const started = await this.api(`ssh ${shellAtom(vm)} ${shellAtom(work)}`);
    const command = commandResult(started.ok, started.status, started.body, started.requestBody, started.exitCode);
    if (!started.ok) { await this.deleteVm(vm); return { handle: { backendKind: this.kind, id: vm }, destinationUrl: `https://${vm}.exe.xyz/`, capabilities: this.capabilities, observation: { state: "failed", command }, command }; }
    return { handle: { backendKind: this.kind, id: vm }, destinationUrl: `https://${vm}.exe.xyz/`, capabilities: this.capabilities, observation: { state: "running", command }, command };
  }

  async inspect(handle: RunHandle): Promise<ExecutionObservation> {
    const vm = this.vm(handle), result = await this.api(`ssh ${shellAtom(vm)} ${shellAtom(`if [ -f /tmp/factorize-${vm.slice(9)}.status ]; then code=$(cat /tmp/factorize-${vm.slice(9)}.status); [ "$code" = 0 ] && printf succeeded || printf failed; else printf running; fi`)}`);
    if (!result.ok && result.status >= 500) return { state: "running", command: commandResult(false, result.status, result.body, result.requestBody, result.exitCode) };
    const state = result.body.trim() === "succeeded" ? "succeeded" : result.body.trim() === "failed" ? "failed" : "running";
    return { state, command: commandResult(result.ok, result.status, result.body, result.requestBody, result.exitCode) };
  }

  async readOutput(handle: RunHandle): Promise<string | null> { const vm = this.vm(handle), result = await this.api(`ssh ${shellAtom(vm)} ${shellAtom(`cat /tmp/factorize-${vm.slice(9)}.log`)}`); return result.ok ? result.body : null; }
  async stop(handle: RunHandle): Promise<ExecutionObservation> { const vm = this.vm(handle), result = await this.api(`ssh ${shellAtom(vm)} ${shellAtom("pkill -TERM -f factorize-prompt || true")}`); await this.deleteVm(vm); return { state: "stopped", command: commandResult(result.ok, result.status, result.body, result.requestBody, result.exitCode) }; }
  async deliverPrompt(_handle: RunHandle, _prompt: string): Promise<PromptDeliveryReceipt> { return { state: "failed" }; }
  private async deleteVm(vm: string) { for (let attempt = 0; attempt < 3; attempt++) { const result = await this.api(`rm ${shellAtom(vm)}`); if (result.ok || result.status === 404) return; } }
  private vm(handle: RunHandle) { if (handle.backendKind !== this.kind || !handle.id) throw new Error("Invalid exe-vm execution handle"); return handle.id; }
}

export { vmNameFor };
