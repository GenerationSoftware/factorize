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

  it("keeps launches blocked for missing, disabled, revoked, stale, or locked proxy state until the owner retries", async () => {
    const { db, env, auth, tenantId, runId } = fixture;
    const proxyIdentity = `proxy-${crypto.randomUUID()}`;
    await db.pool.query(`UPDATE app.runs SET execution_config=$3
      WHERE tenant_id=$1 AND id=$2`, [tenantId, runId, {
      agentKind: "codex", connectionId: "local", executionProvider: "fly", executionType: "agent",
      modelAccess: "portable", modelAccountId: crypto.randomUUID(), portableIntegrationIds: [], runScopes: [],
    }]);

    const cases = [
      { label: "no registered proxy", state: "missing", reason: "proxy_disabled" },
      { label: "disabled proxy", state: "disabled", reason: "proxy_disabled" },
      { label: "revoked proxy", state: "revoked", reason: "proxy_disabled" },
      { label: "stale unlock heartbeat", state: "stale", reason: "proxy_locked" },
      { label: "locked proxy", state: "locked", reason: "proxy_locked" },
    ] as const;
    for (const scenario of cases) {
      await db.pool.query("DELETE FROM app.run_activity WHERE tenant_id=$1 AND run_id=$2", [tenantId, runId]);
      await db.pool.query(`UPDATE app.job_runs SET state='reserved',launch_lease_expires_at=NULL,next_poll_at=NULL WHERE tenant_id=$1 AND id=$2`, [tenantId, runId]);
      await db.pool.query(`UPDATE app.runs SET state='reserved',failure_source=NULL,failure_code=NULL,failure_reason=NULL,execution_handle=NULL WHERE tenant_id=$1 AND id=$2`, [tenantId, runId]);
      if (scenario.state === "missing") {
        await db.pool.query("DELETE FROM app.credential_proxy_states WHERE tenant_id=$1", [tenantId]);
      } else {
        const disabled = scenario.state === "disabled" ? "now()" : "NULL";
        const revoked = scenario.state === "revoked" ? "now()" : "NULL";
        const unlocked = scenario.state === "stale" ? "true" : "false";
        const heartbeat = scenario.state === "stale" ? "now()-interval '1 minute'" : "now()";
        await db.pool.query(`INSERT INTO app.credential_proxy_states(tenant_id,proxy_identity,boot_epoch,disabled_at,revoked_at,unlocked,updated_at)
          VALUES ($1,$2,$3,${disabled},${revoked},${unlocked},${heartbeat})
          ON CONFLICT (tenant_id) DO UPDATE SET proxy_identity=excluded.proxy_identity,boot_epoch=excluded.boot_epoch,
            disabled_at=excluded.disabled_at,revoked_at=excluded.revoked_at,unlocked=excluded.unlocked,updated_at=excluded.updated_at`,
        [tenantId, proxyIdentity, crypto.randomUUID()]);
      }

      await new RunScheduler(db, env).process();
      const blocked = (await db.pool.query<any>(`SELECT jr.state job_state,r.state run_state,r.failure_code,r.failure_reason,
          r.execution_handle,jr.launch_lease_expires_at
        FROM app.job_runs jr JOIN app.runs r USING (tenant_id,id) WHERE jr.tenant_id=$1 AND jr.id=$2`, [tenantId, runId])).rows[0];
      expect(blocked, scenario.label).toMatchObject({ job_state: "blocked", run_state: "blocked", failure_code: "proxy_launch_blocked", execution_handle: null, launch_lease_expires_at: null });
      expect(blocked.failure_reason, scenario.label).toContain(scenario.reason);
      expect((await db.pool.query<any>("SELECT action FROM app.run_activity WHERE tenant_id=$1 AND run_id=$2 ORDER BY created_at", [tenantId, runId])).rows, scenario.label).toEqual([{ action: "launch_blocked" }]);
    }

    await db.pool.query("UPDATE app.credential_proxy_states SET unlocked=true,updated_at=now(),disabled_at=NULL,revoked_at=NULL WHERE tenant_id=$1", [tenantId]);
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
