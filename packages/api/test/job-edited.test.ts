import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { Database } from "../src/postgres/database";
import { PostgresTriggerRepository } from "../src/postgres/job-repository";
import { AutomationScheduler } from "../src/postgres/automation-scheduler";
import { eventSchema } from "../src/flow-schemas";
import { encrypt, decrypt } from "../src/crypto";
import type { Trigger, Event } from "../src/job-domain";

it("accepts edited alongside terminal events and rejects unknown lifecycle events", () => {
  const event = { kind: "triggerLifecycle", config: { sourceTriggerIds: ["source"], states: ["edited", "failed"] } };
  expect(eventSchema.parse(event).config).toEqual(event.config);
  expect(eventSchema.safeParse({ ...event, config: { ...event.config, states: ["unknown"] } }).success).toBe(false);
});

it("accepts an all-runs-complete event with one or more source triggers", () => {
  const event = { kind: "triggerIdle", config: { sourceTriggerIds: ["source"] } };
  expect(eventSchema.parse(event).config).toEqual(event.config);
  expect(eventSchema.safeParse({ ...event, config: { sourceTriggerIds: [] } }).success).toBe(false);
});

// Use a dedicated migrated database; never a shared application database.
describe.skipIf(!process.env.TEST_DATABASE_URL)("trigger edit delivery (PostgreSQL)", () => {
  const database = new Database({ connectionString: process.env.TEST_DATABASE_URL });
  const key = btoa("01234567890123456789012345678901");
  const tenants: string[] = [];
  const repository = (tenantId: string) => new PostgresTriggerRepository(database, tenantId, value => encrypt(value, key), value => decrypt(value, key));
  async function tenant() {
    const id = crypto.randomUUID(); tenants.push(id);
    await database.pool.query("INSERT INTO app.tenants(id) VALUES ($1)", [id]);
    return id;
  }
  async function trigger(tenantId: string, sourceIds: string[] = [], states = ["edited"], enabled = true) {
    const id = crypto.randomUUID(), timestamp = new Date().toISOString();
    const events: Event[] = sourceIds.length ? [{ id: crypto.randomUUID(), triggerId: id, kind: "triggerLifecycle", slug: "event-1", enabled, config: { sourceTriggerIds: sourceIds, states }, createdAt: timestamp, updatedAt: timestamp }] : [];
    return repository(tenantId).create({ id, name: "trigger-" + id, slug: "trigger-" + id, prompt: "{{event-1.event}} {{event-1.source_trigger_id}}", runNameTemplate: "", model: "", executionConfig: { connectionId: "test", workspace: "", cwd: "", agentKind: "codex" }, concurrencyLimit: 1, enabled: true, events, createdAt: timestamp, updatedAt: timestamp } as Trigger);
  }
  const pending = async () => (await database.pool.query("SELECT * FROM app.trigger_edit_deliveries WHERE tenant_id=ANY($1::uuid[])", [tenants])).rows;
  const deliver = () => (new AutomationScheduler(database, { CREDENTIAL_ENCRYPTION_KEY: key } as any) as any).triggerEdits();
  afterAll(() => database.close());
  afterEach(async () => {
    vi.restoreAllMocks();
    await database.pool.query("DELETE FROM app.tenants WHERE id=ANY($1::uuid[])", [tenants]);
    tenants.length = 0;
  });

  it("matches multiple source triggers, excludes self/other tenants/disabled and terminal-only subscribers", async () => {
    const a = await tenant(), b = await tenant(), source = await trigger(a), other = await trigger(a);
    const target = await trigger(a, [other.id, source.id]);
    await trigger(a, [source.id], ["failed"]);
    await trigger(a, [source.id], ["edited"], false);
    const disabled = await trigger(a, [source.id]);
    await repository(a).setEnabled(disabled.id, false, new Date().toISOString());
    await trigger(b, [source.id]);
    expect(await pending()).toHaveLength(0);
    await repository(a).update({ ...source, events: [{ ...target.events[0]!, id: crypto.randomUUID(), triggerId: source.id, config: { sourceTriggerIds: [source.id], states: ["edited"] } }] });
    expect(await pending()).toMatchObject([{ event_id: target.events[0]!.id, source_trigger_id: source.id }]);
    expect(await pending()).toHaveLength(1);
    await repository(a).update(other);
    expect(await pending()).toHaveLength(2);
    await deliver();
    const runs = (await database.pool.query("SELECT i.context,r.state FROM app.invocations i JOIN app.trigger_runs r ON r.tenant_id=i.tenant_id AND r.invocation_id=i.id WHERE i.tenant_id=$1", [a])).rows;
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({ state: "queued", context: { "event-1": { event: "edited" } } });
    expect(await pending()).toHaveLength(0);
  });

  it("rolls back events with the edit and does not replay edits to later subscriptions", async () => {
    const a = await tenant(), source = await trigger(a);
    await repository(a).update(source);
    await trigger(a, [source.id]);
    expect(await pending()).toHaveLength(0);
    const transaction = database.orm.transaction.bind(database.orm);
    vi.spyOn(database.orm, "transaction").mockImplementation((work: any) => transaction(async tx => { await work(tx); throw new Error("rollback"); }));
    await expect(repository(a).update({ ...source, name: "rolled back" })).rejects.toThrow("rollback");
    expect(await pending()).toHaveLength(0);
    expect((await repository(a).getTrigger(source.id))?.name).toBe("Trigger");
  });

  it("deduplicates a delivery retried after invocation commits but acknowledgement fails", async () => {
    const a = await tenant(), source = await trigger(a), target = await trigger(a, [source.id]);
    await repository(a).setEnabled(source.id, false, new Date().toISOString());
    const query = database.pool.query.bind(database.pool);
    const spy = vi.spyOn(database.pool, "query").mockImplementation(((sql: string, ...args: any[]) => {
      if (typeof sql === "string" && sql.startsWith("DELETE FROM app.trigger_edit_deliveries")) throw new Error("ack failed");
      return (query as any)(sql, ...args);
    }) as any);
    await expect(deliver()).rejects.toThrow("ack failed");
    expect(await pending()).toHaveLength(1);
    spy.mockRestore();
    await deliver();
    expect(await pending()).toHaveLength(0);
    expect((await database.pool.query("SELECT * FROM app.invocations WHERE tenant_id=$1 AND trigger_id=$2", [a, target.id])).rows).toHaveLength(1);
  });

  it("drops pending edits when a historically referenced event is removed", async () => {
    const a = await tenant(), source = await trigger(a), target = await trigger(a, [source.id]);
    await repository(a).update(source);
    await deliver();
    await repository(a).update(source);
    expect(await pending()).toHaveLength(1);
    await repository(a).update({ ...target, events: [] });
    expect(await pending()).toHaveLength(0);
    expect((await repository(a).getTrigger(target.id))?.events).toEqual([]);
  });

  it("retains failed deliveries, pauses disabled destinations, and cascades deletion", async () => {
    const a = await tenant(), source = await trigger(a), target = await trigger(a, [source.id]);
    await repository(a).update(source);
    expect((await database.pool.query("SELECT app.next_wake_at() wake")).rows[0].wake).not.toBeNull();
    await repository(a).setEnabled(target.id, false, new Date().toISOString());
    await deliver();
    expect(await pending()).toHaveLength(1);
    await repository(a).setEnabled(target.id, true, new Date().toISOString());
    const broken = new AutomationScheduler(database, { CREDENTIAL_ENCRYPTION_KEY: "invalid" } as any);
    await expect((broken as any).triggerEdits()).rejects.toThrow();
    expect(await pending()).toHaveLength(1);
    await repository(a).delete(source.id);
    expect(await pending()).toHaveLength(0);
  });
});
