import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Database } from "../src/postgres/database";
import { PostgresJobRepository } from "../src/postgres/job-repository";
import { InvocationService, type InvocationSource } from "../src/job-domain";
import { RunRepository } from "../src/postgres/run-repository";

// Run against an isolated PostgreSQL database with the repository migrations applied.
const url = process.env.QUEUE_TEST_DATABASE_URL;
describe.skipIf(!url)("PostgreSQL queue admission", () => {
  let database: Database;
  const tenants: string[] = [];
  const identity = async (value: string) => value;
  beforeAll(() => { database = new Database({ connectionString: url, max: 20, maxUses: Infinity }); });
  afterAll(async () => {
    if (!database) return;
    for (const id of tenants) await database.pool.query("DELETE FROM app.tenants WHERE id=$1", [id]);
    await database.close();
  });

  async function fixture(jobId = crypto.randomUUID()) {
    const tenantId = crypto.randomUUID(), triggerId = crypto.randomUUID();
    tenants.push(tenantId);
    await database.pool.query("INSERT INTO app.tenants(id) VALUES ($1)", [tenantId]);
    await database.pool.query("INSERT INTO app.jobs(tenant_id,id,name,slug,encrypted_prompt_template,execution_target,concurrency_limit) VALUES ($1,$2,'Queue test','queue-test','{{manual.prompt}}',$3,1)", [tenantId, jobId, { agentKind: "codex" }]);
    await database.pool.query("INSERT INTO app.triggers(tenant_id,id,job_id,kind,slug) VALUES ($1,$2,$3,'manual','manual')", [tenantId, triggerId, jobId]);
    const service = new InvocationService(new PostgresJobRepository(database, tenantId, identity, identity), identity);
    const invoke = (claimKey: string, source: InvocationSource = "manual") => service.invoke(jobId, { source, triggerId, claimKey, context: { manual: { prompt: claimKey } } });
    const counts = async () => (await database.pool.query("SELECT (SELECT count(*)::int FROM app.invocations WHERE tenant_id=$1) invocations,(SELECT count(*)::int FROM app.job_runs WHERE tenant_id=$1 AND state='queued') queued,(SELECT count(*)::int FROM app.runs WHERE tenant_id=$1) runs", [tenantId])).rows[0];
    return { tenantId, jobId, invoke, counts };
  }

  it("admits only one simultaneous occurrence across all sources without orphan rows", async () => {
    const f = await fixture();
    const sources: InvocationSource[] = ["manual", "webhook", "schedule", "jobLifecycle"];
    const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => f.invoke(`event:${i}`, sources[i % 4])));
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    for (const result of results) if (result.status === "rejected") expect(result.reason.code).toBe("queue_full");
    expect(await f.counts()).toEqual({ invocations: 1, queued: 1, runs: 1 });
    const otherTenant = await fixture(f.jobId);
    await expect(otherTenant.invoke("other")).resolves.toMatchObject({ duplicate: false });
  });

  it("returns the same canonical run for concurrent duplicate claims even when full", async () => {
    const f = await fixture();
    const results = await Promise.all(Array.from({ length: 12 }, () => f.invoke("same")));
    expect(new Set(results.map(result => result.run.id)).size).toBe(1);
    expect(results.filter(result => !result.duplicate)).toHaveLength(1);
    expect(await f.counts()).toEqual({ invocations: 1, queued: 1, runs: 1 });
  });

  it("allows one waiting run beside an active run and recovers expired launches without requeuing", async () => {
    // Other fixtures are disabled so the global scheduler only sees this job.
    await database.pool.query("UPDATE app.jobs SET enabled=false WHERE tenant_id=ANY($1::uuid[])", [tenants]);
    const f = await fixture(), runs = new RunRepository(database);
    const first = await f.invoke("first");
    const active = await runs.claimNext();
    expect(active?.id).toBe(first.run.id);
    const waiting = await f.invoke("waiting");
    await expect(f.invoke("overflow")).rejects.toMatchObject({ code: "queue_full" });
    expect(await runs.claimNext()).toBeNull();
    await database.pool.query("UPDATE app.job_runs SET launch_lease_expires_at=now()-interval '1 minute' WHERE tenant_id=$1 AND id=$2", [f.tenantId, first.run.id]);
    const retries = await Promise.all([runs.claimNext(), runs.claimNext()]);
    expect(retries.filter(Boolean).map(run => run!.id)).toEqual([first.run.id]);
    expect((await f.counts()).queued).toBe(1);
    await runs.terminal(active!, "succeeded", "stored");
    expect((await runs.claimNext())?.id).toBe(waiting.run.id);
    await expect(f.invoke("next")).resolves.toMatchObject({ duplicate: false });
    expect((await f.counts()).queued).toBe(1);
  });
});
