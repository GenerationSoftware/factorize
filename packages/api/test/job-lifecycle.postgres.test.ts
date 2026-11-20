import { submitRun } from "../src/postgres/run-submission";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { Database } from "../src/postgres/database";
import { PostgresTriggerRepository } from "../src/postgres/job-repository";
import { AutomationScheduler } from "../src/postgres/automation-scheduler";
import { RunRepository } from "../src/postgres/run-repository";
import { RunRetentionRepository } from "../src/postgres/run-retention-repository";
import { RunQueryRepository } from "../src/postgres/run-query-repository";
import { InvocationService, type Trigger, type Event } from "../src/job-domain";
import { decrypt, encrypt } from "../src/crypto";

// CI provides a disposable PostgreSQL service; this suite owns a fresh database.
describe.skipIf(!process.env.AUTH_TEST_DATABASE_URL)("trigger lifecycle delivery (PostgreSQL)", () => {
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
  const repository = (tenantId: string) => new PostgresTriggerRepository(database, tenantId, value => encrypt(value, key), value => decrypt(value, key));
  const deliver = (batchSize?: number) => (new AutomationScheduler(database, { CREDENTIAL_ENCRYPTION_KEY: key } as any, batchSize) as any).lifecycle();
  const deliverIdle = () => (new AutomationScheduler(database, { CREDENTIAL_ENCRYPTION_KEY: key } as any) as any).triggerIdle();
  async function tenant() {
    const id = crypto.randomUUID(); tenants.push(id);
    await database.pool.query("INSERT INTO app.tenants(id) VALUES ($1)", [id]);
    return id;
  }
  async function trigger(tenantId: string, config?: Record<string, unknown>, enabled = true, kind: Event["kind"] = "triggerLifecycle") {
    const id = crypto.randomUUID(), timestamp = new Date().toISOString();
    const event: Event = { id: crypto.randomUUID(), triggerId: id, kind: config ? kind : "manual", slug: "event-1", enabled, config: config ?? {}, createdAt: timestamp, updatedAt: timestamp };
    return repository(tenantId).create({ id, name: "trigger-" + id, slug: "trigger-" + id, prompt: "{{event-1.state}}", runNameTemplate: "", model: "", executionConfig: { connectionId: "test", workspace: "", cwd: "", agentKind: "codex" }, concurrencyLimit: 1, enabled: true, events: [event], createdAt: timestamp, updatedAt: timestamp } as Trigger);
  }
  async function complete(tenantId: string, source: Trigger, state: "succeeded" | "failed" | "stopped" = "succeeded") {
    const result = await new InvocationService(repository(tenantId), value => encrypt(value, key)).invoke(source.id, { source: "manual", eventId: source.events[0]!.id, claimKey: crypto.randomUUID(), context: {} });
    const run = await runs.claimNext();
    expect(run?.id).toBe(result.run.id);
    await runs.consumeWakeHint();
    await runs.terminal(run!, state, "stored", undefined, true);
    return result.run.id;
  }
  async function start(tenantId: string, source: Trigger) {
    const result = await new InvocationService(repository(tenantId), value => encrypt(value, key)).invoke(source.id, { source: "manual", eventId: source.events[0]!.id, claimKey: crypto.randomUUID(), context: {} });
    const run = await runs.claimNext();
    expect(run?.id).toBe(result.run.id);
    await runs.consumeWakeHint();
    return run!;
  }
  async function updateEvent(tenantId: string, value: Trigger, change: (event: Event) => Event, prompt = value.prompt) {
    const event = change(value.events[0]!);
    return repository(tenantId).update({ ...value, prompt, events: [event], updatedAt: new Date().toISOString() });
  }
  const invocations = async (tenantId: string, triggerId: string) => (await database.pool.query("SELECT * FROM app.invocations WHERE tenant_id=$1 AND trigger_id=$2", [tenantId, triggerId])).rows;
  const deliveries = async () => (await database.pool.query("SELECT * FROM app.lifecycle_deliveries WHERE tenant_id=ANY($1::uuid[])", [tenants])).rows;
  afterAll(async () => {
    await database?.close();
    if (admin) { await admin.pool.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`); await admin.close(); }
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    // Provider cleanup ownership deliberately has no tenant FK, so this test
    // database must remove its retained queue rows explicitly.
    await database.pool.query("DELETE FROM app.deleted_trigger_provider_cleanup WHERE tenant_id=ANY($1::uuid[])", [tenants]);
    await database.pool.query("DELETE FROM app.tenants WHERE id=ANY($1::uuid[])", [tenants]);
    await runs.consumeWakeHint();
    tenants.length = 0;
  });

  it("matches arrays, preserves context, wakes after terminal transition, and deduplicates concurrent passes", async () => {
    const a = await tenant(), source = await trigger(a);
    const target = await trigger(a, { sourceTriggerIds: [source.id, source.id], states: ["succeeded"] });
    const runId = await complete(a, source);
    const wake = await runs.nextWakeAt();
    expect(wake).toBeInstanceOf(Date);
    expect(wake!.getTime()).toBeLessThanOrEqual(Date.now());
    await Promise.all([deliver(), deliver()]);
    await deliver();
    expect(await invocations(a, target.id)).toMatchObject([{ context: { "event-1": { sourceRunId: runId, sourceTriggerId: source.id, state: "succeeded" } } }]);
    expect(await invocations(a, target.id)).toHaveLength(1);
    expect(await deliveries()).toHaveLength(1);
  });

  it("retains an expired source run until its enabled lifecycle delivery is acknowledged", async () => {
    const a = await tenant(), source = await trigger(a);
    const target = await trigger(a, { sourceTriggerIds: [source.id], states: ["succeeded"] });
    const sourceRunId = await complete(a, source);
    const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60_000);
    await database.pool.query("UPDATE app.runs SET created_at=$3 WHERE tenant_id=$1 AND id=$2", [a, sourceRunId, new Date(cutoff.getTime() - 60_000)]);

    const retention = new RunRetentionRepository(database);
    await expect(retention.sweep(cutoff, 10)).resolves.toMatchObject({ deleted: 0 });
    expect((await database.pool.query("SELECT 1 FROM app.runs WHERE tenant_id=$1 AND id=$2", [a, sourceRunId])).rowCount).toBe(1);
    expect(await deliveries()).toHaveLength(0);

    await deliver();
    expect(await invocations(a, target.id)).toMatchObject([{ context: { "event-1": { sourceRunId, state: "succeeded" } } }]);
    expect(await deliveries()).toHaveLength(1);
    await expect(retention.sweep(cutoff, 10)).resolves.toMatchObject({ deleted: 1 });
    expect((await database.pool.query("SELECT 1 FROM app.runs WHERE tenant_id=$1 AND id=$2", [a, sourceRunId])).rowCount).toBe(0);
    expect(await invocations(a, target.id)).toHaveLength(1);
  });

  it("rolls back aggregate deletion with its artifact receipt, then expires replay deduplication with the run", async () => {
    const a = await tenant(), source = await trigger(a);
    const runId = await complete(a, source);
    const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60_000);
    await database.pool.query("UPDATE app.runs SET created_at=$3 WHERE tenant_id=$1 AND id=$2", [a, runId, new Date(cutoff.getTime() - 60_000)]);
    const artifactId = crypto.randomUUID(), requestId = crypto.randomUUID();
    await database.pool.query(`INSERT INTO app.run_artifacts
      (tenant_id,id,run_id,kind,object_key,provider,format,byte_size,sha256,state)
      VALUES ($1,$2,$3,'execution_stream',$4,'codex','jsonl',1,$5,'stored')`,
    [a, artifactId, runId, `${a}/${runId}/trace.jsonl`, "a".repeat(64)]);
    await database.pool.query(`INSERT INTO app.trace_replay_operations
      (tenant_id,request_id,run_id,source,actor_id,result)
      VALUES ($1,$2,$3,'primary','owner','{"status":"projected"}')`, [a, requestId, runId]);

    const suffix = crypto.randomUUID().replaceAll("-", "");
    const functionName = `reject_retention_delete_${suffix}`, eventName = `reject_retention_delete_${suffix}`;
    await database.pool.query(`CREATE FUNCTION app.${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected retention delete failure'; END $$`);
    await database.pool.query(`CREATE TRIGGER ${eventName} BEFORE DELETE ON app.invocations FOR EACH ROW EXECUTE FUNCTION app.${functionName}()`);
    const retention = new RunRetentionRepository(database);
    try {
      await expect(retention.sweep(cutoff, 10)).rejects.toThrow("injected retention delete failure");
    } finally {
      await database.pool.query(`DROP TRIGGER ${eventName} ON app.invocations`);
      await database.pool.query(`DROP FUNCTION app.${functionName}()`);
    }
    expect((await database.pool.query("SELECT 1 FROM app.runs WHERE tenant_id=$1 AND id=$2", [a, runId])).rowCount).toBe(1);
    expect((await database.pool.query("SELECT 1 FROM app.run_artifacts WHERE tenant_id=$1 AND id=$2", [a, artifactId])).rowCount).toBe(1);
    expect((await database.pool.query("SELECT 1 FROM app.run_retention_cleanup WHERE tenant_id=$1 AND run_id=$2", [a, runId])).rowCount).toBe(0);

    await expect(retention.sweep(cutoff, 10)).resolves.toMatchObject({ deleted: 1, cleanupQueued: 1 });
    expect((await database.pool.query("SELECT 1 FROM app.runs WHERE tenant_id=$1 AND id=$2", [a, runId])).rowCount).toBe(0);
    expect((await database.pool.query("SELECT 1 FROM app.trace_replay_operations WHERE tenant_id=$1 AND request_id=$2", [a, requestId])).rowCount).toBe(0);
    expect((await database.pool.query("SELECT object_keys FROM app.run_retention_cleanup WHERE tenant_id=$1 AND run_id=$2", [a, runId])).rows[0]).toEqual({ object_keys: [`${a}/${runId}/trace.jsonl`] });
  });

  it("retains old webhook history while mergeability verification is pending", async () => {
    const a = await tenant(), target = await trigger(a, { sourceTriggerIds: [] }, true, "webhook");
    const eventId = target.events[0]!.id, deliveryPk = crypto.randomUUID(), deliveryId = "retention-pending-verification";
    await database.pool.query(`INSERT INTO app.webhook_deliveries(tenant_id,id,provider,delivery_id,outcome,detail,received_at)
      VALUES ($1,$2,'github',$3,'verification_pending','Mergeability is not available yet',now()-interval '15 days')`, [a, deliveryPk, deliveryId]);
    await database.pool.query(`INSERT INTO app.webhook_delivery_events(tenant_id,id,delivery_id,trigger_id,outcome,detail,created_at)
      VALUES ($1,$2,$3,$4,'verification_pending','Waiting for mergeability',now()-interval '15 days')`, [a, crypto.randomUUID(), deliveryPk, target.id]);
    await database.pool.query(`INSERT INTO app.pending_verifications
      (tenant_id,id,trigger_id,event_id,delivery_id,installation_id,repository_id,repository_owner,repository_name,pull_number,next_attempt_at,payload)
      VALUES ($1,$2,$3,$4,$5,1,1,'owner','repo',1,now(),'{}')`, [a, crypto.randomUUID(), target.id, eventId, deliveryId]);

    const retention = new RunRetentionRepository(database);
    await Promise.all([retention.cleanupIndependentHistory(), retention.cleanupIndependentHistory()]);
    expect((await database.pool.query("SELECT outcome FROM app.webhook_deliveries WHERE tenant_id=$1 AND id=$2", [a, deliveryPk])).rows).toEqual([{ outcome: "verification_pending" }]);
    expect((await database.pool.query("SELECT 1 FROM app.webhook_delivery_events WHERE tenant_id=$1 AND delivery_id=$2", [a, deliveryPk])).rowCount).toBe(1);

    await database.pool.query("DELETE FROM app.pending_verifications WHERE tenant_id=$1 AND delivery_id=$2", [a, deliveryId]);
    await retention.cleanupIndependentHistory();
    expect((await database.pool.query("SELECT 1 FROM app.webhook_deliveries WHERE tenant_id=$1 AND id=$2", [a, deliveryPk])).rowCount).toBe(0);
    expect((await database.pool.query("SELECT 1 FROM app.webhook_delivery_events WHERE tenant_id=$1 AND delivery_id=$2", [a, deliveryPk])).rowCount).toBe(0);
  });

  it("does not replay terminal history when a event is created disabled then enabled", async () => {
    const a = await tenant(), source = await trigger(a);
    await complete(a, source, "failed");
    let target = await trigger(a, { sourceTriggerIds: [source.id], states: ["failed"] }, false);
    await deliver();
    expect(await invocations(a, target.id)).toHaveLength(0);
    target = await updateEvent(a, target, event => ({ ...event, enabled: true }));
    await deliver();
    await deliver();
    expect(await invocations(a, target.id)).toHaveLength(0);

    const activeRun = await start(a, source);
    // This run began before the subscription, but its terminal transition is after it.
    await runs.terminal(activeRun, "failed", "stored", undefined, true);
    await Promise.all([deliver(), deliver()]);
    expect(await invocations(a, target.id)).toHaveLength(1);
    expect(await invocations(a, target.id)).toMatchObject([{ context: { "event-1": { sourceRunId: activeRun.id, state: "failed" } } }]);
  });

  it("keeps captured terminal work pending through disable, config edits, and re-enable", async () => {
    const a = await tenant(), source = await trigger(a), other = await trigger(a);
    let target = await trigger(a, { sourceTriggerIds: [source.id], states: ["failed"] });
    const pendingRun = await complete(a, source, "failed");
    target = await updateEvent(a, target, event => ({ ...event, enabled: false }));
    await deliver();
    expect(await invocations(a, target.id)).toHaveLength(0);

    // A watched-source/state change establishes the future matching set, while
    // the already snapshotted event remains a legitimate pending delivery.
    target = await updateEvent(a, target, event => ({ ...event, config: { sourceTriggerIds: [other.id], states: ["succeeded"] } }), "{{event-1.state}} edited");
    await deliver();
    expect(await invocations(a, target.id)).toHaveLength(0);
    target = await updateEvent(a, target, event => ({ ...event, enabled: true }));
    await deliver();
    expect(await invocations(a, target.id)).toMatchObject([{ context: { "event-1": { sourceRunId: pendingRun, state: "failed" } } }]);
    const targetRun = await runs.claimNext();
    expect(targetRun?.triggerId).toBe(target.id);
    await runs.consumeWakeHint();
    await runs.terminal(targetRun!, "succeeded", "stored", undefined, true);

    await complete(a, source, "succeeded");
    await deliver();
    expect(await invocations(a, target.id)).toHaveLength(1);
    await complete(a, other, "succeeded");
    await Promise.all([deliver(), deliver()]);
    expect(await invocations(a, target.id)).toHaveLength(2);
  }, 20_000);

  it("does not create lifecycle work from unrelated prompt edits or re-enabling", async () => {
    const a = await tenant(), source = await trigger(a);
    await complete(a, source, "failed");
    let target = await trigger(a, { sourceTriggerIds: [source.id], states: ["failed"] });
    target = await updateEvent(a, target, event => ({ ...event }), "unrelated prompt edit");
    target = await updateEvent(a, target, event => ({ ...event, enabled: false }));
    target = await updateEvent(a, target, event => ({ ...event, enabled: true }));
    await deliver();
    expect(await invocations(a, target.id)).toHaveLength(0);
    await complete(a, source, "failed");
    await deliver();
    expect(await invocations(a, target.id)).toHaveLength(1);
  });

  it("starts a replacement event at its own subscription boundary", async () => {
    const a = await tenant(), source = await trigger(a);
    await complete(a, source, "failed");
    const target = await trigger(a, { sourceTriggerIds: [source.id], states: ["failed"] });
    const oldEventId = target.events[0]!.id;
    const replacement: Event = { ...target.events[0]!, id: crypto.randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    const updated = await repository(a).update({ ...target, events: [replacement], updatedAt: new Date().toISOString() });
    expect(updated.events[0]!.id).not.toBe(oldEventId);
    await deliver();
    expect(await invocations(a, target.id)).toHaveLength(0);

    await complete(a, source, "failed");
    await deliver();
    expect(await invocations(a, target.id)).toHaveLength(1);
    expect((await database.pool.query("SELECT * FROM app.lifecycle_events WHERE tenant_id=$1 AND event_id=$2", [a, replacement.id])).rows).toHaveLength(1);
  });

  it("retains historical code snapshots and rejects new script invocations", async () => {
    const a = await tenant(), id = crypto.randomUUID(), timestamp = new Date().toISOString();
    const event: Event = { id: crypto.randomUUID(), triggerId: id, kind: "manual", slug: "event-1", enabled: true, config: {}, createdAt: timestamp, updatedAt: timestamp };
    const code = await repository(a).create({ id, runScopes: ["triggers:write"], name: `code-${id}`, slug: `code-${id}`, executionType: "code", script: "echo original", prompt: "", runNameTemplate: "", model: "", executionConfig: { connectionId: "exe", agentKind: "codex", executionType: "code", script: "echo original" }, concurrencyLimit: 1, enabled: true, events: [event], createdAt: timestamp, updatedAt: timestamp } as Trigger);
    await expect(new InvocationService(repository(a), value => encrypt(value,key)).invoke(id,{source:"manual",eventId:event.id,claimKey:"retired",context:{}})).rejects.toMatchObject({code:"invalid_invocation"});
    const runId=crypto.randomUUID(),invocationId=crypto.randomUUID();
    await database.transaction(async client=>{
      await client.query("INSERT INTO app.invocations(tenant_id,id,trigger_id,source,claim_key,event_id,context) VALUES($1,$2,$3,'manual','historical',$4,$5)",[a,invocationId,id,event.id,{"event-1":{outputs:{count:3}}}]);
      await submitRun(client,a,{id:runId,invocationId,triggerId:id,name:"Historical script",source:"manual",claim:"historical",encryptedPrompt:await encrypt("",key),config:{...code.executionConfig,runScopes:["triggers:write"],inputContext:{"event-1":{outputs:{count:3}}}},workspaceName:"",createdAt:timestamp});
    });
    const invocation={run:{id:runId}};
    const snapshot = await database.pool.query<{ execution_config: any; result_protocol_version: number }>("SELECT execution_config,result_protocol_version FROM app.runs WHERE tenant_id=$1 AND id=$2", [a, invocation.run.id]);
    expect(snapshot.rows[0]).toMatchObject({ execution_config: { runScopes: ["triggers:write"], executionType: "code", script: "echo original", inputContext: { "event-1": { outputs: { count: 3 } } } }, result_protocol_version: 1 });
    await repository(a).update({ ...code, runScopes: [], script: "echo edited", executionConfig: { ...code.executionConfig, script: "echo edited" }, updatedAt: new Date().toISOString() });
    expect((await database.pool.query<{ execution_config: any }>("SELECT execution_config FROM app.runs WHERE tenant_id=$1 AND id=$2", [a, invocation.run.id])).rows[0].execution_config).toMatchObject({ script: "echo original", runScopes: ["triggers:write"] });
  });

  it("stores manual permissions tenant-locally and removes their edges when a trigger is deleted", async () => {
    const a = await tenant(), b = await tenant(), source = await trigger(a), destination = await trigger(a), foreign = await trigger(b);
    await database.pool.query("INSERT INTO app.manual_invocation_permissions(tenant_id,source_trigger_id,destination_trigger_id) VALUES ($1,$2,$3)", [a, source.id, destination.id]);
    await expect(database.pool.query("INSERT INTO app.manual_invocation_permissions(tenant_id,source_trigger_id,destination_trigger_id) VALUES ($1,$2,$3)", [a, source.id, foreign.id])).rejects.toMatchObject({ code: "23503" });
    await repository(a).delete(source.id);
    const edges = await database.pool.query("SELECT 1 FROM app.manual_invocation_permissions WHERE tenant_id=$1 AND source_trigger_id=$2", [a, source.id]);
    expect(edges.rowCount).toBe(0);
  });

  it("retains the running VM and its cleanup ownership after deleting its trigger", async () => {
    const a = await tenant(), source = await trigger(a);
    const run = await start(a, source);
    const handle = { backendKind: "exe-vm", id: `factorize-${run.id}` };
    await runs.recordLaunchHandle(run, handle);
    await runs.markLaunched(run, handle, "https://vm.example", ["stop"]);

    const suffix = crypto.randomUUID().replaceAll("-", "");
    const functionName = `reject_trigger_delete_${suffix}`;
    const eventName = `reject_trigger_delete_${suffix}`;
    await database.pool.query(`CREATE FUNCTION app.${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected trigger delete failure'; END $$`);
    await database.pool.query(`CREATE TRIGGER ${eventName} BEFORE DELETE ON app.triggers FOR EACH ROW EXECUTE FUNCTION app.${functionName}()`);
    try {
      await expect(repository(a).delete(source.id)).rejects.toThrow("injected trigger delete failure");
      expect((await database.pool.query("SELECT id FROM app.triggers WHERE tenant_id=$1 AND id=$2", [a, source.id])).rowCount).toBe(1);
      expect((await database.pool.query("SELECT run_id FROM app.deleted_trigger_provider_cleanup WHERE tenant_id=$1 AND run_id=$2", [a, run.id])).rowCount).toBe(0);
    } finally {
      await database.pool.query(`DROP TRIGGER ${eventName} ON app.triggers`);
      await database.pool.query(`DROP FUNCTION app.${functionName}()`);
    }

    expect(await repository(a).delete(source.id)).toBe(true);
    const retained = await database.pool.query("SELECT trigger_id,execution_handle,state,source_trigger_name FROM app.runs WHERE tenant_id=$1 AND id=$2",[a,run.id]);
    expect(retained.rows[0]).toMatchObject({trigger_id:null,execution_handle:handle,state:"running",source_trigger_name:source.name});
    await database.pool.query("UPDATE app.trigger_runs SET next_poll_at=now() WHERE tenant_id=$1 AND id=$2",[a,run.id]);
    expect((await runs.dueForPoll()).some(item=>item.id===run.id)).toBe(true);
    expect((await new RunQueryRepository(database,a).get(run.id))?.trigger_name).toBe(source.name);
  });

  it("stores and revokes an explicit self-invocation permission", async () => {
    const a = await tenant(), self = await trigger(a);
    await database.pool.query("INSERT INTO app.manual_invocation_permissions(tenant_id,source_trigger_id,destination_trigger_id) VALUES ($1,$2,$2)", [a, self.id]);
    expect((await database.pool.query("SELECT 1 FROM app.manual_invocation_permissions WHERE tenant_id=$1 AND source_trigger_id=$2 AND destination_trigger_id=$2", [a, self.id])).rowCount).toBe(1);
    await database.pool.query("DELETE FROM app.manual_invocation_permissions WHERE tenant_id=$1 AND source_trigger_id=$2 AND destination_trigger_id=$2", [a, self.id]);
    expect((await database.pool.query("SELECT 1 FROM app.manual_invocation_permissions WHERE tenant_id=$1 AND source_trigger_id=$2 AND destination_trigger_id=$2", [a, self.id])).rowCount).toBe(0);
  });

  it("preserves one accepted stop across a stale poll and late launch completion", async () => {
    const a = await tenant(), source = await trigger(a);
    const create = (claimKey: string) => new InvocationService(repository(a), value => encrypt(value, key)).invoke(source.id, {
      source: "manual", eventId: source.events[0]!.id, claimKey, context: {},
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
    let states = await database.pool.query("SELECT jr.state trigger_state,r.state run_state FROM app.trigger_runs jr JOIN app.runs r USING(tenant_id,id) WHERE jr.tenant_id=$1 AND jr.id=$2", [a, first.run.id]);
    expect(states.rows[0]).toEqual({ trigger_state: "stopping", run_state: "stopping" });
    await runs.terminal(stalePoll, "stopped", "stored", undefined, true);

    // Launch race: stop while the backend launch is paused, then let its
    // completion persist the newly available handle.
    const second = await create(crypto.randomUUID());
    run = await runs.claimNext();
    expect(run?.id).toBe(second.run.id);
    expect(await stops.stop(second.run.id)).toMatchObject({ state: "stopping" });
    await runs.markLaunched(run!, { backendKind: "exe-vm", id: "factorize-late" }, "https://vm", []);
    states = await database.pool.query("SELECT jr.state trigger_state,r.state run_state,r.execution_handle FROM app.trigger_runs jr JOIN app.runs r USING(tenant_id,id) WHERE jr.tenant_id=$1 AND jr.id=$2", [a, second.run.id]);
    expect(states.rows[0]).toMatchObject({ trigger_state: "stopping", run_state: "stopping", execution_handle: { id: "factorize-late" } });
    await runs.terminal({ ...run!, id: second.run.id }, "succeeded", "stored", undefined, true);
    states = await database.pool.query("SELECT jr.state trigger_state,r.state run_state FROM app.trigger_runs jr JOIN app.runs r USING(tenant_id,id) WHERE jr.tenant_id=$1 AND jr.id=$2", [a, second.run.id]);
    expect(states.rows[0]).toEqual({ trigger_state: "stopped", run_state: "stopped" });
  });

  it("fires trigger-idle only for a completion after the event exists", async () => {
    const a = await tenant(), source = await trigger(a);
    await complete(a, source);
    const target = await trigger(a, { sourceTriggerIds: [source.id] }, true, "triggerIdle");
    await deliverIdle();
    expect(await invocations(a, target.id)).toHaveLength(0);

    const runId = await complete(a, source);
    await deliverIdle();
    await deliverIdle();
    expect(await invocations(a, target.id)).toMatchObject([{ source: "triggerIdle", context: { "event-1": { source_trigger_id: source.id, event: "runsZero" } } }]);
    expect((await database.pool.query("SELECT * FROM app.lifecycle_deliveries WHERE tenant_id=$1 AND event_id=$2 AND source_run_id=$3 AND terminal_state='runsZero'", [a, target.events[0]!.id, runId])).rows).toHaveLength(1);
  });

  it("waits until every selected trigger has no queued or active runs", async () => {
    const a = await tenant(), first = await trigger(a), second = await trigger(a);
    const target = await trigger(a, { sourceTriggerIds: [first.id, second.id] }, true, "triggerIdle");
    await complete(a, second);
    const queued = await new InvocationService(repository(a), value => encrypt(value, key)).invoke(first.id, {
      source: "manual", eventId: first.events[0]!.id, claimKey: crypto.randomUUID(), context: {},
    });
    const activeRun = await runs.claimNext();
    expect(activeRun?.id).toBe(queued.run.id);
    await deliverIdle();
    expect(await invocations(a, target.id)).toHaveLength(0);

    await runs.consumeWakeHint();
    await runs.terminal(activeRun!, "succeeded", "stored", undefined, true);
    await deliverIdle();
    expect(await invocations(a, target.id)).toHaveLength(1);
    expect(await invocations(a, target.id)).toMatchObject([{ source: "triggerIdle" }]);
  });

  it("holds an all-runs-complete event behind a pending lifecycle delivery", async () => {
    const a = await tenant(), source = await trigger(a), downstream = await trigger(a, { sourceTriggerIds: [source.id], states: ["succeeded"] });
    const idle = await trigger(a, { sourceTriggerIds: [source.id, downstream.id] }, true, "triggerIdle");
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
    expect(downstreamRun?.triggerId).toBe(downstream.id);
    await runs.consumeWakeHint();
    await runs.terminal(downstreamRun!, "succeeded", "stored", undefined, true);
    await deliverIdle();
    expect(await invocations(a, idle.id)).toHaveLength(1);
  });

  it("drains lifecycle deliveries beyond the first batch before firing all-runs-complete", async () => {
    const batchSize = 5;
    const a = await tenant(), source = await trigger(a), downstream = await trigger(a, { sourceTriggerIds: [source.id], states: ["succeeded"] });
    const idle = await trigger(a, { sourceTriggerIds: [source.id, downstream.id] }, true, "triggerIdle");
    for (let index = 0; index < batchSize + 1; index++) await complete(a, source);

    await deliver(batchSize);
    expect((await database.pool.query("SELECT * FROM app.lifecycle_deliveries WHERE tenant_id=$1 AND event_id=$2", [a, downstream.events[0]!.id])).rows).toHaveLength(batchSize + 1);
    expect(await invocations(a, downstream.id)).toHaveLength(2);
    await deliverIdle();
    expect(await invocations(a, idle.id)).toHaveLength(0);

    let downstreamRun = await runs.claimNext();
    expect(downstreamRun?.triggerId).toBe(downstream.id);
    await runs.consumeWakeHint();
    await runs.terminal(downstreamRun!, "succeeded", "stored", undefined, true);
    downstreamRun = await runs.claimNext();
    expect(downstreamRun?.triggerId).toBe(downstream.id);
    await runs.consumeWakeHint();
    await runs.terminal(downstreamRun!, "succeeded", "stored", undefined, true);
    await deliverIdle();
    expect(await invocations(a, idle.id)).toHaveLength(1);
  }, 120_000);

  it("acknowledges a queue-full lifecycle delivery and lets idle proceed after existing work ends", async () => {
    const a = await tenant(), source = await trigger(a), downstream = await trigger(a, { sourceTriggerIds: [source.id], states: ["succeeded"] });
    const idle = await trigger(a, { sourceTriggerIds: [source.id, downstream.id] }, true, "triggerIdle");
    const invoker = new InvocationService(repository(a), value => encrypt(value, key));
    const occupied = await invoker.invoke(downstream.id, { source: "manual", eventId: downstream.events[0]!.id, claimKey: crypto.randomUUID(), context: {} });
    const waiter = await invoker.invoke(downstream.id, { source: "manual", eventId: downstream.events[0]!.id, claimKey: crypto.randomUUID(), context: {} });
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
    const a = await tenant(), first = await trigger(a), second = await trigger(a);
    const target = await trigger(a, { sourceTriggerIds: [first.id, second.id], states: ["succeeded", "stopped"] });
    const legacy = await trigger(a, { sourceTriggerId: first.id, terminalStates: ["succeeded"] });
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
  }, 10_000);

  it("excludes absent IDs, excluded states, disabled or removed subscribers, and other tenants", async () => {
    const a = await tenant(), b = await tenant(), source = await trigger(a);
    await trigger(a, { sourceTriggerIds: [crypto.randomUUID()], states: ["succeeded"] });
    await trigger(a, { sourceTriggerIds: [], sourceTriggerId: source.id, states: ["succeeded"] });
    await trigger(a, { sourceTriggerIds: [source.id], states: ["failed"] });
    await trigger(a, { sourceTriggerIds: [source.id], states: ["succeeded"] }, false);
    const disabled = await trigger(a, { sourceTriggerIds: [source.id], states: ["succeeded"] });
    await repository(a).setEnabled(disabled.id, false, new Date().toISOString());
    const removed = await trigger(a, { sourceTriggerIds: [source.id], states: ["succeeded"] });
    await database.pool.query("UPDATE app.events SET removed_at=now() WHERE tenant_id=$1 AND trigger_id=$2", [a, removed.id]);
    await trigger(b, { sourceTriggerIds: [source.id], states: ["succeeded"] });
    await complete(a, source);
    await deliver();
    expect(await deliveries()).toHaveLength(0);
    expect((await database.pool.query("SELECT * FROM app.invocations WHERE tenant_id=ANY($1::uuid[]) AND source='triggerLifecycle'", [tenants])).rows).toHaveLength(0);
  });

  it("retries invocation failures and deduplicates a retry after acknowledgement fails", async () => {
    const a = await tenant(), source = await trigger(a), target = await trigger(a, { sourceTriggerIds: [source.id], states: ["succeeded"] });
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
