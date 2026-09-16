import type { Env, OAuthProps } from "./types";
import type { JobInput, ManualInvocationInput } from "./flow-schemas";

export class ServiceError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

type Scope = "flows:read" | "flows:write" | "runs:read" | "runs:write";

export class ApiService {
  constructor(private env: Env, private auth: OAuthProps) {}

  private stub() { return this.env.TENANTS.get(this.env.TENANTS.idFromName(`tenant:${this.auth.tenantId}`)); }

  private async authorize(scope: Scope): Promise<void> {
    if (!this.auth.scopes.includes(scope)) throw new ServiceError(403, "insufficient_scope", `The ${scope} scope is required.`);
    const response = await this.stub().fetch(`https://tenant/members/${encodeURIComponent(this.auth.userId)}`);
    if (!response.ok) throw new ServiceError(401, "invalid_token", "The resource owner is no longer a member.");
    const member = await response.json() as { role?: string; session_version?: number };
    if (member.role !== "owner" || member.session_version !== this.auth.sessionVersion) throw new ServiceError(401, "invalid_token", "The resource owner's session has been revoked.");
    if (this.auth.accessTokenId) {
      const token = await this.stub().fetch(`https://tenant/access-tokens/${encodeURIComponent(this.auth.accessTokenId)}/active`);
      if (!token.ok) throw new ServiceError(401, "invalid_token", "The access token has expired or been revoked.");
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
  listTailIntegrations() { return this.call("flows:read", "/connections/cloudflare-tail"); }
  listRuns(query: URLSearchParams) { return this.call("runs:read", `/v1/runs?${query}`); }
  getRun(runId: string) { return this.call("runs:read", `/v1/runs/${encodeURIComponent(runId)}`); }
  stopRun(runId: string) { return this.call("runs:write", `/v1/runs/${encodeURIComponent(runId)}/stop`, { method: "POST" }); }
  async listJobs() { return (await this.call("flows:read", "/v1/jobs") as any[]).map(value => this.publicJob(value)); }
  async getJob(jobId: string) { return this.publicJob(await this.call("flows:read", `/v1/jobs/${encodeURIComponent(jobId)}`)); }
  listJobEvents(jobId: string, limit = 50) { return this.call("runs:read", `/v1/jobs/${encodeURIComponent(jobId)}/events?limit=${limit}`); }
  testJobHandler(input: { handlerCode: string; payload: Record<string, unknown> }) { return this.call("flows:write", "/v1/job-handlers/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }); }
  async createJob(input: JobInput) { return this.publicJob(await this.call("flows:write", "/v1/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) })); }
  async updateJob(jobId: string, input: JobInput) { return this.publicJob(await this.call("flows:write", `/v1/jobs/${encodeURIComponent(jobId)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) })); }
  deleteJob(jobId: string) { return this.call("flows:write", `/v1/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" }); }
  setJobEnabled(jobId: string, enabled: boolean) { return this.call("flows:write", `/v1/jobs/${encodeURIComponent(jobId)}/${enabled ? "enable" : "disable"}`, { method: "POST" }); }
  invokeJob(jobId: string, input: ManualInvocationInput) { return this.call("runs:write", `/v1/jobs/${encodeURIComponent(jobId)}/invocations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }); }
  listExecutionTargets() { return this.call("flows:read", "/v1/execution-targets"); }
}
