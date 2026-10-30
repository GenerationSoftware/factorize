import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadingFixture } from "./helpers/loading-fixture";
import { ApiService } from "../src/flow-service";
import { RunQueryRepository } from "../src/postgres/run-query-repository";
import { RunRepository } from "../src/postgres/run-repository";

vi.mock("@cloudflare/workers-oauth-provider", () => ({ OAuthProvider: class {}, AuthorizationError: class extends Error {}, getOAuthApi: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {}, DurableObject: class {} }));

const url = process.env.AUTH_TEST_DATABASE_URL;
describe.skipIf(!url)("run rename persistence (PostgreSQL)", () => {
  let f: Awaited<ReturnType<typeof loadingFixture>>;
  beforeAll(async () => { f = await loadingFixture(url!); });
  afterAll(async () => f?.cleanup());

  it("updates both name copies without changing execution data or elapsed-time timestamps", async () => {
    const before = (await f.db.pool.query<any>("SELECT r.run_name,r.state,r.created_at,r.updated_at,jr.run_name job_run_name,jr.state job_run_state,jr.created_at job_created_at,jr.updated_at job_updated_at,jr.started_at,jr.encrypted_prompt FROM app.runs r JOIN app.job_runs jr USING (tenant_id,id) WHERE r.tenant_id=$1 AND r.id=$2", [f.tenantId, f.runId])).rows[0];
    const service = new ApiService(f.env, { ...f.auth, scopes: ["runs:write"] });
    expect(await service.renameRun(f.runId, { name: "  Persisted  ", expectedName: before.run_name })).toEqual({ run_name: "Persisted" });
    const after = (await f.db.pool.query<any>("SELECT r.run_name,r.state,r.created_at,r.updated_at,jr.run_name job_run_name,jr.state job_run_state,jr.created_at job_created_at,jr.updated_at job_updated_at,jr.started_at,jr.encrypted_prompt FROM app.runs r JOIN app.job_runs jr USING (tenant_id,id) WHERE r.tenant_id=$1 AND r.id=$2", [f.tenantId, f.runId])).rows[0];
    expect(after).toEqual({ ...before, run_name: "Persisted", job_run_name: "Persisted" });
    const concurrent = await Promise.all([
      new RunQueryRepository(f.db, f.tenantId).rename(f.runId, "Concurrent A", "Persisted"),
      new RunQueryRepository(f.db, f.tenantId).rename(f.runId, "Concurrent B", "Persisted"),
    ]);
    expect(concurrent.filter(result => result === "stale")).toHaveLength(1);
    const winner = concurrent.find(result => typeof result === "object");
    expect(winner).toBeDefined();
    await new RunQueryRepository(f.db, f.tenantId).rename(f.runId, "Persisted", winner!.run_name);
    await expect(service.renameRun(f.runId, { name: "Stale", expectedName: before.run_name })).rejects.toMatchObject({ status: 409, code: "stale_run_name" });
    await expect(service.renameRun(crypto.randomUUID(), { name: "Missing" })).rejects.toMatchObject({ status: 404, code: "not_found" });
    expect(await new RunQueryRepository(f.db, f.otherTenant).rename(f.runId, "Cross tenant")).toBe("missing");
  });

  it("keeps the renamed value through polling, completion, and finalization races", async () => {
    const run: any = { tenantId: f.tenantId, id: f.runId, jobId: (await f.db.pool.query<any>("SELECT job_id FROM app.job_runs WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.runId])).rows[0].job_id, invocationId: "", state: "running", encryptedPrompt: "", executionConfig: {}, executionHandle: null, backendKind: "", capabilities: [], artifactState: "pending", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await f.db.pool.query("UPDATE app.job_runs SET state='starting' WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.runId]);
    await f.db.pool.query("UPDATE app.runs SET state='starting' WHERE tenant_id=$1 AND id=$2", [f.tenantId, f.runId]);
    const repository = new RunRepository(f.db), renames = new RunQueryRepository(f.db, f.tenantId);
    await repository.markLaunched(run, { backendKind: "exe-vm", id: "fixture-handle" }, "https://example.test/run", []);
    await Promise.all([
      renames.rename(f.runId, "Lifecycle safe", "Persisted"),
      repository.schedulePoll(run, "blocked", 3),
    ]);
    expect((await f.db.pool.query<any>("SELECT r.run_name,jr.run_name job_run_name,jr.state FROM app.runs r JOIN app.job_runs jr USING (tenant_id,id) WHERE r.tenant_id=$1 AND r.id=$2", [f.tenantId, f.runId])).rows[0]).toMatchObject({ run_name: "Lifecycle safe", job_run_name: "Lifecycle safe", state: "blocked" });
    await repository.retryFinalization({ ...run, state: "running" }, "partial", "transient finalization failure");
    await repository.terminal({ ...run, state: "running" }, "succeeded", "stored", undefined, true);
    expect((await new ApiService(f.env, f.auth).getRunStatus(f.runId)).run_name).toBe("Lifecycle safe");
    expect((await new ApiService(f.env, f.auth).getRun(f.runId)).run_name).toBe("Lifecycle safe");
  });
});
