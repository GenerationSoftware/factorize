import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiService, ServiceError } from "../src/flow-service";
import { ProtectedApiHandler, protectedApiFetch } from "../src/protected-api";
import { RunRepository } from "../src/postgres/run-repository";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class { constructor(public ctx: any, public env: any) {} } }));
afterEach(() => vi.restoreAllMocks());

const runId = "00000000-0000-4000-8000-000000000001";
async function call(transport: "REST" | "MCP", input: Record<string, unknown>, auth: any = { tenantId: "tenant", userId: "owner", authMethod: "oauth", oauthGrantId: "grant-1", scopes: ["runs:write"] }) {
  const url = transport === "REST" ? `https://example.com/api/v1/runs/${runId}/report-error` : "https://example.com/mcp";
  const body = transport === "REST" ? input : { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "report_run_error", arguments: { runId, ...input } } };
  return protectedApiFetch(new Request(url, { method: "POST", headers: { Host: "example.com", Origin: "https://example.com", "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify(body) }), { APP_ORIGIN: "https://example.com", DATABASE: {} } as any, auth, {} as any);
}

describe.each(["REST", "MCP"] as const)("%s report run error boundary", transport => {
  it("routes a bounded validated reason through the same service and requires runs:write", async () => {
    vi.spyOn(ApiService.prototype as any, "authorize").mockImplementation(function(this: any, scope: any) { if (!this.auth.scopes.includes(scope)) throw new ServiceError(403, "insufficient_scope", "Missing scope"); });
    const report = vi.spyOn(ApiService.prototype, "reportRunError").mockImplementation(async function(this: any) { await this.authorize("runs:write"); return { reported: true, reason: "Problem", retry: false }; });
    const response = await call(transport, { reason: "  Problem  " });
    expect(response.status).toBe(200);
    if (transport === "REST") expect(await response.json()).toEqual({ reported: true, reason: "Problem", retry: false });
    else expect(await response.text()).toContain('"reason":"Problem"');
    expect(report).toHaveBeenCalledWith(runId, { reason: "Problem" });

    const unauthorized = await call(transport, { reason: "Problem" }, { tenantId: "tenant", userId: "owner", scopes: ["runs:read"] });
    if (transport === "REST") expect(unauthorized.status).toBe(403);
    else expect(await unauthorized.text()).toContain("insufficient_scope");
    const callsBeforeInvalid = report.mock.calls.length;
    const invalid = await call(transport, { reason: "   ", token: "must-not-be-accepted" });
    if (transport === "REST") expect(invalid.status).toBe(400);
    else expect(await invalid.text()).toContain("Input validation error");
    expect(report).toHaveBeenCalledTimes(callsBeforeInvalid);
  });

  it("maps terminal and replacement conflicts without overwriting the first report", async () => {
    vi.spyOn(ApiService.prototype, "reportRunError").mockRejectedValueOnce(new ServiceError(409, "terminal_run", "terminal"));
    const terminal = await call(transport, { reason: "Problem" });
    if (transport === "REST") expect(terminal.status).toBe(409);
    else expect(await terminal.text()).toContain("terminal_run");
    vi.spyOn(ApiService.prototype, "reportRunError").mockRejectedValueOnce(new ServiceError(409, "error_already_reported", "conflict"));
    const conflict = await call(transport, { reason: "Different" });
    if (transport === "REST") expect(conflict.status).toBe(409);
    else expect(await conflict.text()).toContain("error_already_reported");
  });
});

describe("report persistence lock and retry behavior", () => {
  it("locks job_runs before runs, records provenance once, and distinguishes identical and conflicting retries", async () => {
    let existing: string | null = null;
    const query = vi.fn(async (sql: string, values: unknown[]) => {
      if (sql.includes("SELECT state FROM app.job_runs")) return { rows: [{ state: "running" }] };
      if (sql.includes("SELECT agent_error_reason")) return { rows: [{ agent_error_reason: existing }] };
      if (sql.startsWith("UPDATE app.runs SET agent_error_reason")) { existing = values[2] as string; return { rows: [] }; }
      return { rows: [] };
    });
    const repo = new RunRepository({ transaction: (work: any) => work({ query }) } as any);
    const input = { tenantId: "tenant", runId, reason: "safe reason", userId: "owner", reporterKind: "oauth", reporterId: "grant-stable" };
    expect(await repo.reportAgentError(input)).toBe("reported");
    expect(await repo.reportAgentError(input)).toBe("identical");
    expect(await repo.reportAgentError({ ...input, reason: "replacement" })).toBe("conflict");
    expect(query.mock.calls[0][0]).toContain("FROM app.job_runs");
    expect(query.mock.calls[1][0]).toContain("FROM app.runs");
    expect(query.mock.calls[2][1]).toEqual(["tenant", runId, "safe reason", "owner", "oauth", "grant-stable"]);
    expect(query.mock.calls.filter(([sql]) => String(sql).startsWith("UPDATE app.runs SET agent_error_reason"))).toHaveLength(1);
  });

  it.each([
    ["succeeded", "running", "reported problem", "failed", "agent"],
    ["failed", "running", "reported problem", "failed", "system"],
    ["succeeded", "stopping", "reported problem", "stopped", null],
  ] as const)("finalizes observer %s from %s with report precedence", async (observation, existingState, reason, expectedState, expectedSource) => {
    const calls: Array<[string, unknown[]]> = [];
    const query = vi.fn(async (sql: string, values: unknown[] = []) => {
      calls.push([sql, values]);
      if (sql.includes("FROM app.job_runs") && sql.includes("FOR UPDATE")) return { rows: [{ state: existingState }] };
      if (sql.includes("SELECT agent_error_reason")) return { rows: [{ agent_error_reason: reason }] };
      return { rows: [] };
    });
    const repo = new RunRepository({ transaction: (work: any) => work({ query }) } as any);
    await repo.terminal({ tenantId: "tenant", id: runId } as any, observation, "partial", "artifact failed", true);
    const runUpdate = calls.find(([sql]) => sql.startsWith("UPDATE app.runs SET state="))!;
    expect(runUpdate[0]).toContain("failure_source=$4");
    expect(runUpdate[1].slice(2, 7)).toEqual([expectedState, expectedSource, "partial", "artifact failed", true]);
  });
});

describe("report authenticated provenance and sanitization", () => {
  it.each([
    [{ authMethod: "oauth", oauthGrantId: "stable-grant", oauthClientId: "client" }, "oauth", "client:stable-grant"],
    [{ authMethod: "access_token", accessTokenId: "stable-token" }, "api_key", "stable-token"],
  ] as const)("derives safe %s provenance from the authenticated request", async (identity, kind, identifier) => {
    vi.spyOn(ApiService.prototype as any, "authorize").mockResolvedValue(undefined);
    const report = vi.spyOn(RunRepository.prototype, "reportAgentError").mockResolvedValue("reported");
    const auth = { tenantId: "tenant", userId: "owner", scopes: ["runs:write"], ...identity } as any;
    const result = await new ApiService({ DATABASE: {} } as any, auth).reportRunError(runId, { reason: "token=do-not-store" });
    expect(result.reason).not.toContain("do-not-store");
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant", runId, userId: "owner", reporterKind: kind, reporterId: identifier }));
  });

  it("accepts an identical retry and rejects missing OAuth grant provenance", async () => {
    vi.spyOn(ApiService.prototype as any, "authorize").mockResolvedValue(undefined);
    vi.spyOn(RunRepository.prototype, "reportAgentError").mockResolvedValue("identical");
    const auth = { tenantId: "tenant", userId: "owner", scopes: ["runs:write"], authMethod: "oauth", oauthGrantId: "stable-grant", oauthClientId: "client" } as any;
    await expect(new ApiService({ DATABASE: {} } as any, auth).reportRunError(runId, { reason: "same" })).resolves.toMatchObject({ retry: true });
    const missing = { ...auth, oauthGrantId: undefined };
    await expect(new ApiService({ DATABASE: {} } as any, missing).reportRunError(runId, { reason: "same" })).rejects.toMatchObject({ status: 403 });
  });

  it("uses the validated OAuth token summary for legacy grant reporter identity", async () => {
    const credential = "never-persist-this-token-value", unwrapToken = vi.fn().mockResolvedValue({ userId: "owner", grantId: "real-grant-id", grant: { clientId: "real-client-id" } });
    const report = vi.spyOn(ApiService.prototype, "reportRunError").mockImplementation(async function(this: any) {
      expect(this.auth).toMatchObject({ oauthGrantId: "real-grant-id", oauthClientId: "real-client-id" });
      return { reported: true, reason: "safe", retry: false };
    });
    const handler = new ProtectedApiHandler({ props: { tenantId: "tenant", userId: "owner", scopes: ["runs:write"], authMethod: "oauth" } } as any, { APP_ORIGIN: "https://example.com", OAUTH_PROVIDER: { unwrapToken } } as any);
    const response = await handler.fetch(new Request(`https://example.com/api/v1/runs/${runId}/report-error`, { method: "POST", headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" }, body: JSON.stringify({ reason: "safe" }) }));
    expect(response.status).toBe(200);
    expect(unwrapToken).toHaveBeenCalledWith(credential);
    expect(report).toHaveBeenCalledOnce();
    expect(JSON.stringify(await response.json())).not.toContain(credential);
  });
});
