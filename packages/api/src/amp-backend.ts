import type { BackendCommandResult, ExecutionBackend, ExecutionObservation, ExecutionState, LaunchReceipt, LaunchRequest, RunHandle } from "./execution";

export interface AmpConnection { accessToken: string; project: string; apiBaseUrl?: string; }

export function mapAmpState(value: unknown): ExecutionState {
  switch (String(value ?? "").toLowerCase()) {
    case "queued": case "pending": return "queued";
    case "creating": case "provisioning": case "starting": return "starting";
    case "running": case "working": case "active": return "running";
    case "waiting": case "waiting_for_input": case "blocked": return "blocked";
    case "stopping": case "cancelling": case "canceling": return "stopping";
    case "stopped": case "cancelled": case "canceled": case "archived": return "stopped";
    case "complete": case "completed": case "done": case "succeeded": case "success": return "succeeded";
    case "failed": case "error": return "failed";
    default: return "running";
  }
}

export class AmpBackend implements ExecutionBackend {
  readonly kind = "amp";
  readonly capabilities = ["stop"] as const;
  private base: string;
  constructor(private connection: AmpConnection, private request: typeof fetch = fetch) { this.base = (connection.apiBaseUrl || "https://ampcode.com/api/cloud/v1").replace(/\/$/, ""); }
  private async call(path: string, init: RequestInit = {}) {
    const requestBody = typeof init.body === "string" ? init.body : "";
    const response = await this.request(`${this.base}${path}`, { ...init, headers: { Authorization: `Bearer ${this.connection.accessToken}`, "Content-Type": "application/json", ...init.headers } });
    const body = await response.text(); let data: any = {}; try { data = body ? JSON.parse(body) : {}; } catch { /* retain raw body */ }
    const command: BackendCommandResult = { ok: response.ok, status: response.status, exitCode: null, body, requestBody };
    return { data, command };
  }
  async test() { return (await this.call("/projects?limit=1")).command.ok; }
  async launch(request: LaunchRequest): Promise<LaunchReceipt> {
    const result = await this.call("/runs", { method: "POST", body: JSON.stringify({ prompt: request.prompt, executor: "orb", project: this.connection.project, title: `Factorize ${request.runId}`, externalId: request.runId }) });
    if (!result.command.ok) throw new Error(`Amp launch failed (${result.command.status}): ${result.command.body.slice(0, 500)}`);
    const threadId = String(result.data.threadId ?? result.data.threadID ?? result.data.id ?? "");
    if (!threadId) throw new Error("Amp launch response did not include a thread ID.");
    return { handle: { backendKind: this.kind, id: threadId }, destinationUrl: String(result.data.url ?? `https://ampcode.com/threads/${encodeURIComponent(threadId)}`), capabilities: this.capabilities, observation: { state: mapAmpState(result.data.status ?? "starting") }, command: result.command };
  }
  async inspect(handle: RunHandle): Promise<ExecutionObservation> {
    const result = await this.call(`/runs/${encodeURIComponent(handle.id)}`);
    if (!result.command.ok) return { state: result.command.status === 404 ? "failed" : "running", detail: result.command.body, command: result.command };
    return { state: mapAmpState(result.data.status ?? result.data.state), detail: result.data.detail, command: result.command };
  }
  async stop(handle: RunHandle): Promise<ExecutionObservation> {
    const result = await this.call(`/runs/${encodeURIComponent(handle.id)}/stop`, { method: "POST", body: "{}" });
    return { state: result.command.ok ? mapAmpState(result.data.status ?? "stopped") : "running", detail: result.data.detail ?? result.command.body, command: result.command };
  }
}
