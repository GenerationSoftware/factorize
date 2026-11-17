import {afterAll, beforeAll, describe, expect, it, vi} from "vitest";
import {loadingFixture} from "./helpers/loading-fixture";
import {RunScheduler} from "../src/postgres/run-scheduler";
import {protectedApiFetch} from "../src/protected-api";
import {EncryptedIntegrationRepository} from "../src/postgres/encrypted-integration-repository";
import {RunRepository} from "../src/postgres/run-repository";

vi.mock("cloudflare:workers", () => ({WorkerEntrypoint: class {}, DurableObject: class {}}));
vi.mock("@cloudflare/workers-oauth-provider", () => ({OAuthProvider: class {}, AuthorizationError: class extends Error {}, getOAuthApi: vi.fn()}));
const url = process.env.AUTH_TEST_DATABASE_URL;
describe.skipIf(!url)("run credential repair and cancellation (PostgreSQL)", () => {
  let f: Awaited<ReturnType<typeof loadingFixture>>;
  beforeAll(async () => { f = await loadingFixture(url!); });
  afterAll(async () => { await f?.cleanup(); });
  const call = (path: string, body?: unknown) => protectedApiFetch(new Request(f.env.APP_ORIGIN+path, {method: "POST", headers: {Origin: f.env.APP_ORIGIN, "Content-Type": "application/json"}, ...(body === undefined ? {} : {body: JSON.stringify(body)})}), f.env, {...f.auth, scopes: ["jobs:read", "jobs:write", "runs:invoke", "runs:cancel"]}, {waitUntil() {}} as any);

  it("keeps unavailable selections intact, cancels an unprovisioned block, and launches a repaired future run", async () => {
    const missing = crypto.randomUUID(), replacement = crypto.randomUUID();
    const snapshot = {agentKind: "codex", connectionId: "local", portableIntegrationIds: [missing], modelAccess: "native", runScopes: []};
    await f.db.pool.query("UPDATE app.runs SET state='reserved',execution_config=$3 WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.runId, snapshot]);
    await f.db.pool.query("UPDATE app.job_runs SET state='reserved' WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.runId]);
    const launch = vi.fn(async (request: any) => ({handle: {backendKind: "exe-vm", id: `factorize-${request.runId}`}, observation: {state: "running" as const}, capabilities: [], destinationUrl: "https://vm.example.com"}));
    const scheduler = new RunScheduler(f.db, f.env, async () => ({kind: "exe-vm", capabilities: [], launch, inspect: async () => ({state: "running" as const}), stop: async () => ({state: "stopped" as const})}));
    await scheduler.process();
    expect(launch).not.toHaveBeenCalled();
    const blocked = (await f.db.pool.query("SELECT state,failure_code,execution_config,execution_handle FROM app.runs WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.runId])).rows[0];
    expect(blocked).toMatchObject({state: "blocked", failure_code: "credential_repair_required", execution_handle: null, execution_config: snapshot});
    const records = new EncryptedIntegrationRepository(f.db, f.tenantId, f.env.CREDENTIAL_ENCRYPTION_KEY);
    await records.write({id: replacement, kind: "bearer", name: "Re-entered", origin: "https://selected.example.com", description: null, managedSecret: "replacement-secret", expectedRevision: 0, idempotencyKey: crypto.randomUUID(), operation: "upsert"});
    await f.db.pool.query("UPDATE app.jobs SET execution_config=$3,run_scopes='[]' WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.jobIds[0], {...snapshot, portableIntegrationIds: [replacement]}]);
    expect(await new RunRepository(f.db).retryBlockedLaunch(f.tenantId, f.runId)).toBe(true);
    await scheduler.process();
    expect(launch).not.toHaveBeenCalled(); // Repair never mutates the old snapshot.
    expect((await call(`/api/v1/runs/${f.runId}/stop`)).status).toBe(200);
    const stopped = (await f.db.pool.query("SELECT state,claim_released,vm_cleanup_complete FROM app.runs WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.runId])).rows[0];
    expect(stopped).toEqual({state: "stopped", claim_released: true, vm_cleanup_complete: true});
    const invoked = await call(`/api/v1/jobs/${f.jobIds[0]}/invocations`, {prompt: "repaired run", idempotencyKey: "repaired-future-run"});
    expect(invoked.status).toBe(202);
    const next = await invoked.json() as {runId: string};
    await scheduler.process();
    expect(launch).toHaveBeenCalledTimes(1);
    expect(launch.mock.calls[0]![0].runIdentity).toEqual({backendOrigin: f.env.APP_ORIGIN});
    expect(launch.mock.calls[0]![0]).not.toHaveProperty("runProxy");
    const saved = (await f.db.pool.query("SELECT r.execution_config,a.scopes FROM app.runs r JOIN app.run_authorizations a ON a.tenant_id=r.tenant_id AND a.run_id=r.id WHERE r.tenant_id=$1 AND r.id=$2", [f.tenantId, next.runId])).rows[0];
    expect(saved.execution_config.portableIntegrationIds).toEqual([replacement]);
    expect(saved.scopes).toEqual([]);
  });
});
