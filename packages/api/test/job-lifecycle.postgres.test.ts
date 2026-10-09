import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { Database } from "../src/postgres/database";
import { PostgresJobRepository } from "../src/postgres/job-repository";
import { AutomationScheduler } from "../src/postgres/automation-scheduler";
import { RunRepository } from "../src/postgres/run-repository";
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
  async function tenant() {
    const id = crypto.randomUUID(); tenants.push(id);
    await database.pool.query("INSERT INTO app.tenants(id) VALUES ($1)", [id]);
    return id;
  }
  async function job(tenantId: string, config?: Record<string, unknown>, enabled = true) {
    const id = crypto.randomUUID(), timestamp = new Date().toISOString();
    const trigger: Trigger = { id: crypto.randomUUID(), jobId: id, kind: config ? "jobLifecycle" : "manual", slug: "trigger-1", enabled, config: config ?? {}, createdAt: timestamp, updatedAt: timestamp };
    return repository(tenantId).create({ id, name: "Job", slug: "job-" + id, promptTemplate: "{{trigger-1.state}}", runNameTemplate: "", model: "", executionTarget: { connectionId: "test", workspace: "", cwd: "", agentKind: "codex" }, concurrencyLimit: 1, enabled: true, triggers: [trigger], createdAt: timestamp, updatedAt: timestamp } as Job);
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
