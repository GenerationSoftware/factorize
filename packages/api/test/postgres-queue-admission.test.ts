import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Database } from "../src/postgres/database";
import { PostgresTriggerRepository } from "../src/postgres/job-repository";
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

  async function fixture(triggerId = crypto.randomUUID(), concurrency = 1) {
    const tenantId = crypto.randomUUID(), eventId = crypto.randomUUID();
    tenants.push(tenantId);
    await database.pool.query("INSERT INTO app.tenants(id) VALUES ($1)", [tenantId]);
    await database.pool.query("INSERT INTO app.projects(tenant_id,id,name) VALUES ($1,md5(($1::uuid)::text || ':default')::uuid,'Default')", [tenantId]);
    await database.pool.query("INSERT INTO app.triggers(tenant_id,id,project_id,name,slug,encrypted_prompt,execution_config,concurrency_limit) VALUES ($1,$2,md5(($1::uuid)::text || ':default')::uuid,'Queue test','queue-test','{{manual.prompt}}',$3,$4)", [tenantId, triggerId, { agentKind: "codex" }, concurrency]);
    await database.pool.query("INSERT INTO app.events(tenant_id,id,trigger_id,kind,slug) VALUES ($1,$2,$3,'manual','manual')", [tenantId, eventId, triggerId]);
    const service = new InvocationService(new PostgresTriggerRepository(database, tenantId, identity, identity), identity);
    const invoke = (claimKey: string, source: InvocationSource = "manual") => service.invoke(triggerId, { source, eventId, claimKey, context: { manual: { prompt: claimKey } } });
    const counts = async () => (await database.pool.query("SELECT (SELECT count(*)::int FROM app.invocations WHERE tenant_id=$1) invocations,(SELECT count(*)::int FROM app.trigger_runs WHERE tenant_id=$1 AND state='queued') queued,(SELECT count(*)::int FROM app.trigger_runs WHERE tenant_id=$1 AND state='reserved') reserved,(SELECT count(*)::int FROM app.runs WHERE tenant_id=$1) runs", [tenantId])).rows[0];
    return { tenantId, triggerId, invoke, counts };
  }

  it("admits only one simultaneous occurrence across all sources without orphan rows", async () => {
    const f = await fixture();
    const sources: InvocationSource[] = ["manual", "webhook", "schedule", "triggerLifecycle"];
    const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => f.invoke(`event:${i}`, sources[i % 4])));
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(2);
    for (const result of results) if (result.status === "rejected") expect(result.reason.code).toBe("queue_full");
    expect(await f.counts()).toEqual({ invocations: 2, queued: 1, reserved: 1, runs: 2 });
    const otherTenant = await fixture(f.triggerId);
    await expect(otherTenant.invoke("other")).resolves.toMatchObject({ duplicate: false });
  });

  it("returns the same canonical run for concurrent duplicate claims even when full", async () => {
    const f = await fixture();
    const results = await Promise.all(Array.from({ length: 12 }, () => f.invoke("same")));
    expect(new Set(results.map(result => result.run.id)).size).toBe(1);
    expect(results.filter(result => !result.duplicate)).toHaveLength(1);
    expect(await f.counts()).toEqual({ invocations: 1, queued: 0, reserved: 1, runs: 1 });
  });

  it("allows one waiting run beside an active run and recovers expired launches without requeuing", async () => {
    // Other fixtures are disabled so the global scheduler only sees this trigger.
    await database.pool.query("UPDATE app.triggers SET enabled=false WHERE tenant_id=ANY($1::uuid[])", [tenants]);
    const f = await fixture(), runs = new RunRepository(database);
    const first = await f.invoke("first");
    const active = await runs.claimNext();
    expect(active?.id).toBe(first.run.id);
    const waiting = await f.invoke("waiting");
    await expect(f.invoke("overflow")).rejects.toMatchObject({ code: "queue_full" });
    expect(await runs.claimNext()).toBeNull();
    await database.pool.query("UPDATE app.trigger_runs SET launch_lease_expires_at=now()-interval '1 minute' WHERE tenant_id=$1 AND id=$2", [f.tenantId, first.run.id]);
    const retries = await Promise.all([runs.claimNext(), runs.claimNext()]);
    expect(retries.filter(Boolean).map(run => run!.id)).toEqual([first.run.id]);
    expect((await f.counts()).queued).toBe(1);
    await runs.terminal(active!, "succeeded", "stored");
    expect((await runs.claimNext())?.id).toBe(waiting.run.id);
    await expect(f.invoke("next")).resolves.toMatchObject({ duplicate: false });
    expect((await f.counts()).queued).toBe(1);
  });

  it("reserves every free slot before allowing one waiting run", async () => {
    const f = await fixture(crypto.randomUUID(), 10);
    await database.pool.query("UPDATE app.team_settings SET run_defaults=run_defaults||'{\"capacity\":50}'::jsonb WHERE tenant_id=$1", [f.tenantId]);
    const accepted = await Promise.all(Array.from({ length: 11 }, (_, i) => f.invoke(`burst:${i}`)));
    expect(accepted).toHaveLength(11);
    expect((await f.counts()).reserved).toBe(10);
    expect((await f.counts()).queued).toBe(1);
    await expect(f.invoke("burst:overflow")).rejects.toMatchObject({ code: "queue_full" });
    expect((await f.counts()).invocations).toBe(11);
  });
  it("enforces the initial Team capacity across Triggers without orphaning rejected occurrences", async () => {
    const f=await fixture(crypto.randomUUID(),3);
    await Promise.all(Array.from({length:3},(_,i)=>f.invoke(`team-first:${i}`)));
    const id=crypto.randomUUID(), event=crypto.randomUUID();
    await database.pool.query("INSERT INTO app.triggers(tenant_id,id,name,slug,encrypted_prompt,execution_config,concurrency_limit) VALUES($1,$2,'queue-second','queue-second','Do work',$3,10)",[f.tenantId,id,{agentKind:"codex"}]);
    await database.pool.query("INSERT INTO app.events(tenant_id,id,trigger_id,kind,slug) VALUES($1,$2,$3,'manual','manual')",[f.tenantId,event,id]);
    const service=new InvocationService(new PostgresTriggerRepository(database,f.tenantId,identity,identity),identity);
    const invoke=(claimKey:string)=>service.invoke(id,{source:"manual",eventId:event,claimKey,context:{manual:{prompt:claimKey}}});
    await invoke("team-second:active");await invoke("team-second:waiting");
    await expect(invoke("team-second:overflow")).rejects.toMatchObject({code:"queue_full"});
    expect(await f.counts()).toEqual({invocations:5,runs:5,reserved:4,queued:1});
  });

});
