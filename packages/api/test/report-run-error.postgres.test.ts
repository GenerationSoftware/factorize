import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadingFixture } from "./helpers/loading-fixture";
import { RunRepository } from "../src/postgres/run-repository";

const url = process.env.AUTH_TEST_DATABASE_URL;
vi.mock("@cloudflare/workers-oauth-provider", () => ({ OAuthProvider: class {}, AuthorizationError: class extends Error {}, getOAuthApi: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {}, DurableObject: class {} }));
describe.skipIf(!url)("agent run error persistence (PostgreSQL)", () => {
  let f: Awaited<ReturnType<typeof loadingFixture>>;
  beforeAll(async () => { f = await loadingFixture(url!); });
  afterAll(async () => f?.cleanup());

  async function activate() {
    await f.db.pool.query("UPDATE app.job_runs SET state='running',started_at=now() WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.runId]);
    await f.db.pool.query("UPDATE app.runs SET state='running',failure_source=NULL,agent_error_reason=NULL,agent_error_reported_at=NULL,agent_error_reporter_user_id=NULL,agent_error_reporter_kind=NULL,agent_error_reporter_id=NULL,claim_released=false,vm_cleanup_complete=false WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.runId]);
  }

  it("isolates tenants and atomically keeps an accepted report when observer success finalizes", async () => {
    const runs = new RunRepository(f.db);
    await activate();
    const provenance = { userId: f.auth.userId, reporterKind: "oauth", reporterId: "stable-grant" };
    expect(await runs.reportAgentError({ tenantId: crypto.randomUUID(), runId: f.runId, reason: "safe failure", ...provenance })).toBe("missing");

    const [report, terminal] = await Promise.all([
      runs.reportAgentError({ tenantId: f.tenantId, runId: f.runId, reason: "safe failure", ...provenance }),
      runs.terminal({ tenantId: f.tenantId, id: f.runId } as any, "succeeded", "stored", undefined, true),
    ]);
    const final = (await f.db.pool.query<any>("SELECT jr.state job_state,r.state,r.failure_source,r.agent_error_reason,r.agent_error_reporter_user_id,r.agent_error_reporter_kind,r.agent_error_reporter_id FROM app.job_runs jr JOIN app.runs r USING (tenant_id,id) WHERE r.tenant_id=$1 AND r.id=$2", [f.tenantId, f.runId])).rows[0];
    if (report === "reported") {
      expect(final).toMatchObject({ job_state: "failed", state: "failed", failure_source: "agent", agent_error_reason: "safe failure", agent_error_reporter_user_id: f.auth.userId, agent_error_reporter_kind: "oauth", agent_error_reporter_id: "stable-grant" });
      expect(await runs.reportAgentError({ tenantId: f.tenantId, runId: f.runId, reason: "safe failure", ...provenance })).toBe("terminal");
    } else {
      expect(report).toBe("terminal");
      expect(final).toMatchObject({ job_state: "succeeded", state: "succeeded", failure_source: null, agent_error_reason: null });
    }
  });

  it("keeps system diagnostics authoritative on observer failure and preserves reports when stopped", async () => {
    const runs = new RunRepository(f.db), provenance = { userId: f.auth.userId, reporterKind: "api_key", reporterId: "stable-token" };
    await activate();
    expect(await runs.reportAgentError({ tenantId: f.tenantId, runId: f.runId, reason: "agent finding", ...provenance })).toBe("reported");
    await runs.terminal({ tenantId: f.tenantId, id: f.runId } as any, "failed", "partial", "artifact upload failed", true);
    let final = (await f.db.pool.query<any>("SELECT jr.state job_state,r.state,r.failure_source,r.agent_error_reason,r.agent_error_reporter_id,r.artifact_error FROM app.job_runs jr JOIN app.runs r USING (tenant_id,id) WHERE r.tenant_id=$1 AND r.id=$2", [f.tenantId, f.runId])).rows[0];
    expect(final).toMatchObject({ job_state: "failed", state: "failed", failure_source: "system", agent_error_reason: "agent finding", agent_error_reporter_id: "stable-token", artifact_error: "artifact upload failed" });

    await activate();
    expect(await runs.reportAgentError({ tenantId: f.tenantId, runId: f.runId, reason: "keep on stop", ...provenance })).toBe("reported");
    await f.db.pool.query("UPDATE app.job_runs SET state='stopping' WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.runId]);
    await f.db.pool.query("UPDATE app.runs SET state='stopping' WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.runId]);
    await runs.terminal({ tenantId: f.tenantId, id: f.runId } as any, "succeeded", "stored", undefined, true);
    final = (await f.db.pool.query<any>("SELECT jr.state job_state,r.state,r.failure_source,r.agent_error_reason FROM app.job_runs jr JOIN app.runs r USING (tenant_id,id) WHERE r.tenant_id=$1 AND r.id=$2", [f.tenantId, f.runId])).rows[0];
    expect(final).toEqual({ job_state: "stopped", state: "stopped", failure_source: null, agent_error_reason: "keep on stop" });
  });
});
