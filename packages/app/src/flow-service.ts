import type { Env, OAuthProps } from "./types";
import type { JobInput, ManualInvocationInput } from "./flow-schemas";
import { nextOccurrence, validateScheduleConfig } from "./schedule";

export class ServiceError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

type Scope = "flows:read" | "flows:write" | "runs:read" | "runs:write";

export class ApiService {
  constructor(private env: Env, private auth: OAuthProps) {}

  private stub() { return this.env.TENANTS.get(this.env.TENANTS.idFromName(`tenant:${this.auth.tenantId}`)); }

  private async authorize(scope: Scope): Promise<void> {
    if (!this.auth.scopes.includes(scope)) throw new ServiceError(403, "insufficient_scope", `The ${scope} scope is required.`);
    const response = await this.stub().fetch("https://tenant/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: this.auth.userId, sessionVersion: this.auth.sessionVersion, accessTokenId: this.auth.accessTokenId }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      throw new ServiceError(401, "invalid_token", body.error ?? "The request is not authorized.");
    }
  }

  private async call(scope: Scope, path: string, init?: RequestInit): Promise<unknown> {
    await this.authorize(scope);
    const response = await this.stub().fetch(`https://tenant${path}`, init);
    let body: unknown = null;
    const text = await response.text();
    if (text) { try { body = JSON.parse(text); } catch { body = { error: text }; } }
    if (!response.ok) throw new ServiceError(response.status, response.status === 404 ? "not_found" : "operation_failed", (body as any)?.error ?? "Operation failed");
    return body;
  }

  private publicJob(value: any) {
    for (const trigger of value?.triggers ?? []) {
      const provider = trigger.kind === "webhook" ? trigger.config?.provider : undefined;
      if (provider === "cloudflareTail") trigger.config.destination = `${this.env.APP_ORIGIN}/webhooks/cloudflare/${encodeURIComponent(this.auth.tenantId)}/${encodeURIComponent(value.id)}`;
    }
    return value;
  }

  listExeConnections() { return this.call("flows:read", "/connections/status").then((value: any) => value.exeConnections ?? []); }
  listGitHubInstallations() { return this.call("flows:read", "/github/installations"); }
  listTailIntegrations() { return this.call("flows:read", "/connections/cloudflare-tail"); }
  listRuns(query: URLSearchParams) { return this.call("runs:read", `/v1/runs?${query}`); }
  search(query: string) { return this.call("runs:read", `/v1/search?q=${encodeURIComponent(query)}`); }
  getRun(runId: string) { return this.call("runs:read", `/v1/runs/${encodeURIComponent(runId)}`); }
  getRunDiagnostics(runId: string) { return this.call("runs:read", `/v1/runs/${encodeURIComponent(runId)}/diagnostics`); }
  stopRun(runId: string) { return this.call("runs:write", `/v1/runs/${encodeURIComponent(runId)}/stop`, { method: "POST" }); }
  async listJobs() { return (await this.call("flows:read", "/v1/jobs") as any[]).map(value => this.publicJob(value)); }
  async getJob(jobId: string) { return this.publicJob(await this.call("flows:read", `/v1/jobs/${encodeURIComponent(jobId)}`)); }
  listJobEvents(jobId: string, limit = 50) { return this.call("runs:read", `/v1/jobs/${encodeURIComponent(jobId)}/events?limit=${limit}`); }
  listWebhookDeliveries(query: URLSearchParams) { return this.call("runs:read", `/v1/webhooks/deliveries?${query}`); }
  getWebhookDelivery(deliveryId: string) { return this.call("runs:read", `/v1/webhooks/deliveries/${encodeURIComponent(deliveryId)}`); }
  testJobHandler(input: { handlerCode: string; payload: Record<string, unknown> }) { return this.call("flows:write", "/v1/job-handlers/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }); }
  async createJob(input: JobInput) { return this.publicJob(await this.call("flows:write", "/v1/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) })); }
  async updateJob(jobId: string, input: JobInput) { return this.publicJob(await this.call("flows:write", `/v1/jobs/${encodeURIComponent(jobId)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) })); }
  deleteJob(jobId: string) { return this.call("flows:write", `/v1/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" }); }
  setJobEnabled(jobId: string, enabled: boolean) { return this.call("flows:write", `/v1/jobs/${encodeURIComponent(jobId)}/${enabled ? "enable" : "disable"}`, { method: "POST" }); }
  invokeJob(jobId: string, input: ManualInvocationInput) { return this.call("runs:write", `/v1/jobs/${encodeURIComponent(jobId)}/invocations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }); }
  listExecutionTargets() { return this.call("flows:read", "/v1/execution-targets"); }
  diagnoseExeIntegration(connectionId: string) { return this.call("flows:write", `/v1/integrations/exe/${encodeURIComponent(connectionId)}/diagnostics`, { method: "POST" }); }
  listJobTriggerAvailability() { return this.call("flows:read", "/v1/job-trigger-availability"); }
  async previewSchedule(input: unknown) {
    await this.authorize("flows:read");
    try {
      const config = validateScheduleConfig(input);
      return { nextRunAt: nextOccurrence(config, new Date()).toISOString() };
    } catch (error) {
      throw new ServiceError(400, "invalid_request", error instanceof Error ? error.message : "Invalid schedule");
    }
  }
}
