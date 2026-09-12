import type { Env, OAuthProps } from "./types";
import type { FlowInput } from "./flow-schemas";

export class ServiceError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

type Scope = "flows:read" | "flows:write" | "runs:read" | "runs:write";

export class FlowService {
  constructor(private env: Env, private auth: OAuthProps) {}

  private stub() { return this.env.TENANTS.get(this.env.TENANTS.idFromName(`tenant:${this.auth.tenantId}`)); }

  private async authorize(scope: Scope): Promise<void> {
    if (!this.auth.scopes.includes(scope)) throw new ServiceError(403, "insufficient_scope", `The ${scope} scope is required.`);
    const response = await this.stub().fetch(`https://tenant/members/${encodeURIComponent(this.auth.userId)}`);
    if (!response.ok) throw new ServiceError(401, "invalid_token", "The resource owner is no longer a member.");
    const member = await response.json() as { role?: string; session_version?: number };
    if (member.role !== "owner" || member.session_version !== this.auth.sessionVersion) throw new ServiceError(401, "invalid_token", "The resource owner's session has been revoked.");
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

  private publicFlow(row: any) {
    let source: any = undefined;
    let matchRules: unknown = undefined;
    try { source = typeof row.source_config === "string" ? JSON.parse(row.source_config) : undefined; } catch { /* omit malformed internal config */ }
    try { matchRules = typeof row.match_rules === "string" ? JSON.parse(row.match_rules) : undefined; } catch { /* omit malformed internal config */ }
    if (source?.kind === "custom") source = { kind: "custom", origin: source.origin, handlerName: source.handlerName, deploymentState: source.handlerDeployment?.state };
    return {
      id: row.id, name: row.name, projectId: row.project_id, source,
      matchRules,
      maxConcurrency: row.max_concurrency, workspaceName: row.workspace_name,
      agentKind: row.agent_kind, cwd: row.cwd, contextTemplate: row.context_template,
      enabled: Boolean(row.enabled), createdAt: row.created_at,
    };
  }

  async listFlows() { return (await this.call("flows:read", "/pipes") as any[]).map(row => this.publicFlow(row)); }
  async getFlow(flowId: string) {
    const value = await this.call("flows:read", `/v1/flows/${encodeURIComponent(flowId)}`) as any;
    return this.publicFlow(value);
  }
  createFlow(input: FlowInput) { return this.call("flows:write", "/pipes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }); }
  updateFlow(flowId: string, input: FlowInput) { return this.call("flows:write", `/pipes/${encodeURIComponent(flowId)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }); }
  deleteFlow(flowId: string) { return this.call("flows:write", `/pipes/${encodeURIComponent(flowId)}`, { method: "DELETE" }); }
  listProjects() { return this.call("flows:read", "/linear/projects"); }
  listFlowOptions() { return this.call("flows:read", "/linear/options"); }
  listRuns(query: URLSearchParams) { return this.call("runs:read", `/v1/runs?${query}`); }
  getRun(runId: string) { return this.call("runs:read", `/v1/runs/${encodeURIComponent(runId)}`); }
  listFlowEvents(query: URLSearchParams) { return this.call("runs:read", `/v1/events?${query}`); }
  stopRun(runId: string) { return this.call("runs:write", `/v1/runs/${encodeURIComponent(runId)}/stop`, { method: "POST" }); }
}
