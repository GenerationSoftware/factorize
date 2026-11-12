import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadingFixture } from "./helpers/loading-fixture";
import { RunScheduler } from "../src/postgres/run-scheduler";
import { protectedApiFetch } from "../src/protected-api";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {}, DurableObject: class {} }));
vi.mock("@cloudflare/workers-oauth-provider", () => ({ OAuthProvider: class {}, AuthorizationError: class extends Error {}, getOAuthApi: vi.fn() }));

const url = process.env.AUTH_TEST_DATABASE_URL;
describe.skipIf(!url)("proxy-gated scheduler lifecycle (PostgreSQL/API)", () => {
  let fixture: Awaited<ReturnType<typeof loadingFixture>>;
  beforeAll(async () => { fixture = await loadingFixture(url!); });
  afterAll(async () => { await fixture?.cleanup(); });

  it("keeps a blocked launch parked after unlock until the owner retries through the API", async () => {
    const { db, env, auth, tenantId, runId } = fixture;
    const proxyIdentity = `proxy-${crypto.randomUUID()}`;
    await db.pool.query(`INSERT INTO app.credential_proxy_states(tenant_id,proxy_identity,boot_epoch,unlocked)
      VALUES ($1,$2,$3,false)`, [tenantId, proxyIdentity, crypto.randomUUID()]);
    await db.pool.query(`UPDATE app.runs SET execution_config=$3
      WHERE tenant_id=$1 AND id=$2`, [tenantId, runId, {
      agentKind: "codex", connectionId: "local", executionProvider: "fly", executionType: "agent",
      modelAccess: "portable", modelAccountId: crypto.randomUUID(), portableIntegrationIds: [], runScopes: [],
    }]);

    await new RunScheduler(db, env).process();
    const blocked = (await db.pool.query<any>(`SELECT jr.state job_state,r.state run_state,r.failure_code,r.failure_reason,
        r.execution_handle,jr.launch_lease_expires_at
      FROM app.job_runs jr JOIN app.runs r USING (tenant_id,id) WHERE jr.tenant_id=$1 AND jr.id=$2`, [tenantId, runId])).rows[0];
    expect(blocked).toMatchObject({ job_state: "blocked", run_state: "blocked", failure_code: "proxy_launch_blocked", execution_handle: null, launch_lease_expires_at: null });
    expect(blocked.failure_reason).toContain("proxy_locked");
    expect((await db.pool.query<any>("SELECT action FROM app.run_activity WHERE tenant_id=$1 AND run_id=$2 ORDER BY created_at", [tenantId, runId])).rows).toEqual([{ action: "launch_blocked" }]);

    await db.pool.query("UPDATE app.credential_proxy_states SET unlocked=true,updated_at=now() WHERE tenant_id=$1", [tenantId]);
    await new RunScheduler(db, env).process();
    expect((await db.pool.query<any>("SELECT state FROM app.job_runs WHERE tenant_id=$1 AND id=$2", [tenantId, runId])).rows[0].state).toBe("blocked");
    expect((await db.pool.query<any>("SELECT action FROM app.run_activity WHERE tenant_id=$1 AND run_id=$2 ORDER BY created_at", [tenantId, runId])).rows).toEqual([{ action: "launch_blocked" }]);

    const request = () => protectedApiFetch(new Request(`${env.APP_ORIGIN}/api/v1/runs/${runId}/retry-launch`, {
      method: "POST", headers: { Origin: env.APP_ORIGIN },
    }), env, { ...auth, authMethod: "session", scopes: ["runs:cancel"] }, { waitUntil() {} } as any);
    const retried = await request();
    expect(retried.status).toBe(200);
    expect(await retried.json()).toEqual({ runId, retryRequested: true });
    expect((await db.pool.query<any>(`SELECT jr.state job_state,r.state run_state,r.failure_code,r.execution_handle
      FROM app.job_runs jr JOIN app.runs r USING (tenant_id,id) WHERE jr.tenant_id=$1 AND jr.id=$2`, [tenantId, runId])).rows[0]).toMatchObject({ job_state: "reserved", run_state: "reserved", failure_code: null, execution_handle: null });
    expect((await db.pool.query<any>("SELECT action FROM app.run_activity WHERE tenant_id=$1 AND run_id=$2 ORDER BY created_at", [tenantId, runId])).rows.map((row: any) => row.action)).toEqual(["launch_blocked", "launch_retry_requested"]);
    expect((await db.pool.query<any>("SELECT key FROM app.wake_hints WHERE key='global'")).rowCount).toBe(1);
    expect((await request()).status).toBe(409);
  }, 30_000);
});
