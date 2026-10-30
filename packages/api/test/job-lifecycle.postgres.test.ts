import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { Database } from "../src/postgres/database";
import { PostgresJobRepository } from "../src/postgres/job-repository";
import { AutomationScheduler } from "../src/postgres/automation-scheduler";
import { RunRepository } from "../src/postgres/run-repository";
import { RunQueryRepository } from "../src/postgres/run-query-repository";
import { InvocationService, type Job, type Trigger } from "../src/job-domain";
import { decrypt, encrypt } from "../src/crypto";

// CI provides a disposable PostgreSQL service; this suite owns a fresh database.
describe.skipIf(!process.env.AUTH_TEST_DATABASE_URL)("job lifecycle delivery (PostgreSQL)", () => {
  const databaseName = `lifecycle_test_${crypto.randomUUID().replaceAll("-", "")}`;
  let database: Database, admin: Database, runs: RunRepository;
  beforeAll(async () => {
    admin = new Database({ connectionString: process.env.AUTH_TEST_DATABASE_URL });
    await admin.pool.query(`CREATE DATABASE ${databaseName}`);
    const url = new URL(process.env.AUTH_TEST_DATABASE_URL!); url.pathname = `/${databaseName}`;
    database = new Database({ connectionString: url.toString() });
    const dir = new URL("../migrations/", import.meta.url);
    for (const file of (await readdir(dir)).filter(f => f.endsWith(".sql")).sort()) {
      await database.pool.query(await readFile(new URL(file, dir), "utf8"));
    }
    runs = new RunRepository(database);
  });
  const key = btoa("01234567890123456789012345678901");
  const tenants: string[] = [];
  const repository = (tenantId: string) => new PostgresJobRepository(database, tenantId, value => encrypt(value, key), value => decrypt(value, key));
  const deliver = () => (new AutomationScheduler(database, { CREDENTIAL_ENCRYPTION_KEY: key } as any) as any).lifecycle();
  const deliverIdle = () => (new AutomationScheduler(database, { CREDENTIAL_ENCRYPTION_KEY: key } as any) as any).jobIdle();
  async function tenant() {
    const id = crypto.randomUUID(); tenants.push(id);
    await database.pool.query("INSERT INTO app.tenants(id) VALUES ($1)", [id]);
    return id;
  }
  async function job(tenantId: string, config?: Record<string, unknown>, enabled = true, kind: Trigger["kind"] = "jobLifecycle") {
    const id = crypto.randomUUID(), timestamp = new Date().toISOString();
    const trigger: Trigger = { id: crypto.randomUUID(), jobId: id, kind: config ? kind : "manual", slug: "trigger-1", enabled, config: config ?? {}, createdAt: timestamp, updatedAt: timestamp };
    return repository(tenantId).create({ id, name: "Job", slug: "job-" + id, promptTemplate: "{{trigger-1.state}}", runNameTemplate: "", model: "", executionConfig: { connectionId: "test", workspace: "", cwd: "", agentKind: "codex" }, concurrencyLimit: 1, enabled: true, triggers: [trigger], createdAt: timestamp, updatedAt: timestamp } as Job);
  }
  async function complete(tenantId: string, source: Job, state: "succeeded" | "failed" | "stopped" = "succeeded") {
    const result = await new InvocationService(repository(tenantId), value => encrypt(value, key)).invoke(source.id, { source: "manual", triggerId: source.triggers[0]!.id, claimKey: crypto.randomUUID(), context: {} });
    const run = await runs.claimNext();
    expect(run?.id).toBe(result.run.id);
    await runs.consumeWakeHint();
    await runs.terminal(run!, state, "stored", undefined, true);
    return result.run.id;
  }
  const invocations = async (tenantId: string, jobId: string) => (await database.pool.query("SELECT * FROM app.invocations WHERE tenant_id=$1 AND job_id=$2", [tenantId, jobId])).rows;
  const deliveries = async () => (await database.pool.query("SELECT * FROM app.lifecycle_deliveries WHERE tenant_id=ANY($1::uuid[])", [tenants])).rows;
  afterAll(async () => {
    await database?.close();
    if (admin) { await admin.pool.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`); await admin.close(); }
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await database.pool.query("DELETE FROM app.tenants WHERE id=ANY($1::uuid[])", [tenants]);
    await runs.consumeWakeHint();
    tenants.length = 0;
  });

  it("matches arrays, preserves context, wakes after terminal transition, and deduplicates concurrent passes", async () => {
    const a = await tenant(), source = await job(a);
    const target = await job(a, { sourceJobIds: [source.id, source.id], states: ["succeeded"] });
    const runId = await complete(a, source);
    const wake = await runs.nextWakeAt();
    expect(wake).toBeInstanceOf(Date);
    expect(wake!.getTime()).toBeLessThanOrEqual(Date.now());
    await Promise.all([deliver(), deliver()]);
    await deliver();
    expect(await invocations(a, target.id)).toMatchObject([{ context: { "trigger-1": { sourceRunId: runId, sourceJobId: source.id, state: "succeeded" } } }]);
    expect(await invocations(a, target.id)).toHaveLength(1);
    expect(await deliveries()).toHaveLength(1);
  });

  it("preserves one accepted stop across a stale poll and late launch completion", async () => {
    const a = await tenant(), source = await job(a);
    const create = (claimKey: string) => new InvocationService(repository(a), value => encrypt(value, key)).invoke(source.id, {
      source: "manual", triggerId: source.triggers[0]!.id, claimKey, context: {},
    });

    // Poll race: retain the pre-stop running snapshot, accept stop, then save
    // the stale running observation as if backend inspection just completed.
    const first = await create(crypto.randomUUID());
    let run = await runs.claimNext();
    await runs.markLaunched(run!, { backendKind: "exe-vm", id: "factorize-running" }, "https://vm", []);
    const stalePoll = { ...run!, state: "running" as const, executionHandle: { backendKind: "exe-vm", id: "factorize-running" } };
    const stops = new RunQueryRepository(database, a);
    expect(await stops.stop(first.run.id)).toMatchObject({ state: "stopping" });
    expect(await stops.stop(first.run.id)).toMatchObject({ state: "stopping" });
    await runs.schedulePoll(stalePoll, "running");
    await runs.retryFinalization(stalePoll, "partial", "temporary artifact issue");
    let states = await database.pool.query("SELECT jr.state job_state,r.state run_state FROM app.job_runs jr JOIN app.runs r USING(tenant_id,id) WHERE jr.tenant_id=$1 AND jr.id=$2", [a, first.run.id]);
    expect(states.rows[0]).toEqual({ job_state: "stopping", run_state: "stopping" });
    await runs.terminal(stalePoll, "stopped", "stored", undefined, true);

    // Launch race: stop while the backend launch is paused, then let its
    // completion persist the newly available handle.
    const second = await create(crypto.randomUUID());
    run = await runs.claimNext();
    expect(run?.id).toBe(second.run.id);
    expect(await stops.stop(second.run.id)).toMatchObject({ state: "stopping" });
    await runs.markLaunched(run!, { backendKind: "exe-vm", id: "factorize-late" }, "https://vm", []);
    states = await database.pool.query("SELECT jr.state job_state,r.state run_state,r.execution_handle FROM app.job_runs jr JOIN app.runs r USING(tenant_id,id) WHERE jr.tenant_id=$1 AND jr.id=$2", [a, second.run.id]);
    expect(states.rows[0]).toMatchObject({ job_state: "stopping", run_state: "stopping", execution_handle: { id: "factorize-late" } });
    await runs.terminal({ ...run!, id: second.run.id }, "succeeded", "stored", undefined, true);
    states = await database.pool.query("SELECT jr.state job_state,r.state run_state FROM app.job_runs jr JOIN app.runs r USING(tenant_id,id) WHERE jr.tenant_id=$1 AND jr.id=$2", [a, second.run.id]);
    expect(states.rows[0]).toEqual({ job_state: "stopped", run_state: "stopped" });
  });

  it("fires job-idle only for a completion after the trigger exists", async () => {
    const a = await tenant(), source = await job(a);
    await complete(a, source);
    const target = await job(a, { sourceJobIds: [source.id] }, true, "jobIdle");
    await deliverIdle();
    expect(await invocations(a, target.id)).toHaveLength(0);

    const runId = await complete(a, source);
    await deliverIdle();
    await deliverIdle();
    expect(await invocations(a, target.id)).toMatchObject([{ source: "jobIdle", context: { "trigger-1": { source_job_id: source.id, event: "runsZero" } } }]);
    expect((await database.pool.query("SELECT * FROM app.lifecycle_deliveries WHERE tenant_id=$1 AND trigger_id=$2 AND source_run_id=$3 AND terminal_state='runsZero'", [a, target.triggers[0]!.id, runId])).rows).toHaveLength(1);
  });

  it("waits until every selected job has no queued or active runs", async () => {
    const a = await tenant(), first = await job(a), second = await job(a);
    const target = await job(a, { sourceJobIds: [first.id, second.id] }, true, "jobIdle");
    await complete(a, second);
    const queued = await new InvocationService(repository(a), value => encrypt(value, key)).invoke(first.id, {
      source: "manual", triggerId: first.triggers[0]!.id, claimKey: crypto.randomUUID(), context: {},
    });
    const activeRun = await runs.claimNext();
    expect(activeRun?.id).toBe(queued.run.id);
    await deliverIdle();
    expect(await invocations(a, target.id)).toHaveLength(0);

    await runs.consumeWakeHint();
    await runs.terminal(activeRun!, "succeeded", "stored", undefined, true);
    await deliverIdle();
    expect(await invocations(a, target.id)).toHaveLength(1);
    expect(await invocations(a, target.id)).toMatchObject([{ source: "jobIdle" }]);
  });

  it("holds an all-runs-complete trigger behind a pending lifecycle delivery", async () => {
    const a = await tenant(), source = await job(a), downstream = await job(a, { sourceJobIds: [source.id], states: ["succeeded"] });
    const idle = await job(a, { sourceJobIds: [source.id, downstream.id] }, true, "jobIdle");
    await complete(a, source);

    // The database guard must work even when an idle pass races ahead of the
    // lifecycle pass (or a previous lifecycle pass has been delayed).
    await deliverIdle();
    expect(await invocations(a, idle.id)).toHaveLength(0);
    await deliver();
    await deliverIdle();
    expect(await invocations(a, downstream.id)).toHaveLength(1);
    expect(await invocations(a, idle.id)).toHaveLength(0);

    const downstreamRun = await runs.claimNext();
    expect(downstreamRun?.jobId).toBe(downstream.id);
    await runs.consumeWakeHint();
    await runs.terminal(downstreamRun!, "succeeded", "stored", undefined, true);
    await deliverIdle();
    expect(await invocations(a, idle.id)).toHaveLength(1);
  });

  it("drains lifecycle deliveries beyond the first 100 before firing all-runs-complete", async () => {
    const a = await tenant(), source = await job(a), downstream = await job(a, { sourceJobIds: [source.id], states: ["succeeded"] });
    const idle = await job(a, { sourceJobIds: [source.id, downstream.id] }, true, "jobIdle");
    for (let index = 0; index < 101; index++) await complete(a, source);

    await deliver();
    expect((await database.pool.query("SELECT * FROM app.lifecycle_deliveries WHERE tenant_id=$1 AND trigger_id=$2", [a, downstream.triggers[0]!.id])).rows).toHaveLength(101);
    expect(await invocations(a, downstream.id)).toHaveLength(2);
    await deliverIdle();
    expect(await invocations(a, idle.id)).toHaveLength(0);

    let downstreamRun = await runs.claimNext();
    expect(downstreamRun?.jobId).toBe(downstream.id);
    await runs.consumeWakeHint();
    await runs.terminal(downstreamRun!, "succeeded", "stored", undefined, true);
    downstreamRun = await runs.claimNext();
    expect(downstreamRun?.jobId).toBe(downstream.id);
    await runs.consumeWakeHint();
    await runs.terminal(downstreamRun!, "succeeded", "stored", undefined, true);
    await deliverIdle();
    expect(await invocations(a, idle.id)).toHaveLength(1);
  }, 20_000);

  it("acknowledges a queue-full lifecycle delivery and lets idle proceed after existing work ends", async () => {
    const a = await tenant(), source = await job(a), downstream = await job(a, { sourceJobIds: [source.id], states: ["succeeded"] });
    const idle = await job(a, { sourceJobIds: [source.id, downstream.id] }, true, "jobIdle");
    const invoker = new InvocationService(repository(a), value => encrypt(value, key));
    const occupied = await invoker.invoke(downstream.id, { source: "manual", triggerId: downstream.triggers[0]!.id, claimKey: crypto.randomUUID(), context: {} });
    const waiter = await invoker.invoke(downstream.id, { source: "manual", triggerId: downstream.triggers[0]!.id, claimKey: crypto.randomUUID(), context: {} });
    const occupiedRun = await runs.claimNext();
    expect(occupiedRun?.id).toBe(occupied.run.id);
    await complete(a, source);
    await deliver();
    expect(await invocations(a, downstream.id)).toHaveLength(2);
    expect(await deliveries()).toHaveLength(1);
    await runs.consumeWakeHint();
    await runs.terminal(occupiedRun!, "succeeded", "stored", undefined, true);
    const waitingRun = await runs.claimNext();
    expect(waitingRun?.id).toBe(waiter.run.id);
    await runs.consumeWakeHint();
    await runs.terminal(waitingRun!, "succeeded", "stored", undefined, true);
    await deliverIdle();
    expect(await invocations(a, idle.id)).toHaveLength(1);
  });

  it("matches each of multiple source IDs and legacy singular config with terminalStates", async () => {
    const a = await tenant(), first = await job(a), second = await job(a);
    const target = await job(a, { sourceJobIds: [first.id, second.id], states: ["succeeded", "stopped"] });
    const legacy = await job(a, { sourceJobId: first.id, terminalStates: ["succeeded"] });
    await complete(a, first);
    await deliver();
    expect(await invocations(a, legacy.id)).toHaveLength(1);
    // Clear queued subscribers before completing the second source.
    for (let run = await runs.claimNext(); run; run = await runs.claimNext()) await runs.terminal(run, "succeeded", "stored", undefined, true);
    await complete(a, second, "stopped");
    await deliver();
    expect(await invocations(a, target.id)).toHaveLength(2);
    expect(await invocations(a, legacy.id)).toHaveLength(1);
    expect(await deliveries()).toHaveLength(3);
  });

  it("excludes absent IDs, excluded states, disabled or removed subscribers, and other tenants", async () => {
    const a = await tenant(), b = await tenant(), source = await job(a);
    await job(a, { sourceJobIds: [crypto.randomUUID()], states: ["succeeded"] });
    await job(a, { sourceJobIds: [], sourceJobId: source.id, states: ["succeeded"] });
    await job(a, { sourceJobIds: [source.id], states: ["failed"] });
    await job(a, { sourceJobIds: [source.id], states: ["succeeded"] }, false);
    const disabled = await job(a, { sourceJobIds: [source.id], states: ["succeeded"] });
    await repository(a).setEnabled(disabled.id, false, new Date().toISOString());
    const removed = await job(a, { sourceJobIds: [source.id], states: ["succeeded"] });
    await database.pool.query("UPDATE app.triggers SET removed_at=now() WHERE tenant_id=$1 AND job_id=$2", [a, removed.id]);
    await job(b, { sourceJobIds: [source.id], states: ["succeeded"] });
    await complete(a, source);
    await deliver();
    expect(await deliveries()).toHaveLength(0);
    expect((await database.pool.query("SELECT * FROM app.invocations WHERE tenant_id=ANY($1::uuid[]) AND source='jobLifecycle'", [tenants])).rows).toHaveLength(0);
  });

  it("retries invocation failures and deduplicates a retry after acknowledgement fails", async () => {
    const a = await tenant(), source = await job(a), target = await job(a, { sourceJobIds: [source.id], states: ["succeeded"] });
    await complete(a, source);
    await expect((new AutomationScheduler(database, { CREDENTIAL_ENCRYPTION_KEY: "invalid" } as any) as any).lifecycle()).rejects.toThrow();
    expect(await deliveries()).toHaveLength(0);
    const query = database.pool.query.bind(database.pool);
    const spy = vi.spyOn(database.pool, "query").mockImplementation(((sql: string, ...args: any[]) => {
      if (typeof sql === "string" && sql.startsWith("INSERT INTO app.lifecycle_deliveries")) throw new Error("ack failed");
      return (query as any)(sql, ...args);
    }) as any);
    await expect(deliver()).rejects.toThrow("ack failed");
    expect(await invocations(a, target.id)).toHaveLength(1);
    expect(await deliveries()).toHaveLength(0);
    spy.mockRestore();
    await deliver();
    await deliver();
    expect(await invocations(a, target.id)).toHaveLength(1);
    expect(await deliveries()).toHaveLength(1);
  });
});
