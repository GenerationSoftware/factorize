import { createHmac } from "node:crypto";
import { AlarmCoordinator } from "../src/alarm-coordinator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchMcpEvents } from "../src/mcp-event-subscriptions";
import { EventMatchRepository } from "../src/postgres/event-match-repository";
import { IdentityRepository } from "../src/postgres/identity-repository";
import type { OAuthProps } from "../src/types";
import { loadingFixture } from "./helpers/loading-fixture";
import { mcpRequest } from "./helpers/mcp-request";

vi.mock("cloudflare:workers", () => ({
  WorkerEntrypoint: class {}, WorkflowEntrypoint: class {},
  DurableObject: class { constructor(protected ctx: unknown, protected env: unknown) {} },
}));
vi.mock("@cloudflare/workers-oauth-provider", () => ({ OAuthProvider: class {}, AuthorizationError: class extends Error {}, getOAuthApi: vi.fn() }));

const receiver = "https://receiver.example.com/inbound";
const key = Buffer.alloc(32, 9), replacement = Buffer.alloc(32, 12);
const secret = (signingKey: Buffer) => `whsec_${signingKey.toString("base64")}`;
type Captured = {
  id: string;
  timestamp: string;
  signature: string;
  subscriptionId: string;
  event: { eventId: string; name: string; timestamp: string; data: { occurrenceId: string; definitionId: string }; cursor: null };
};

describe.skipIf(!process.env.AUTH_TEST_DATABASE_URL)("MCP event webhook lifecycle on PostgreSQL", () => {
  let f: Awaited<ReturnType<typeof loadingFixture>>;
  let auth: OAuthProps;
  let request: ReturnType<typeof mcpRequest>;
  let source: Awaited<ReturnType<Awaited<ReturnType<typeof loadingFixture>>["seedEventTrigger"]>>;
  let name: string, grantActive: boolean, signingKey: Buffer, challengeMatches: boolean;
  let deliveries: Captured[], verifications: string[], statuses: number[], unexpected: unknown[];
  let holdDelivery: (() => Promise<void>) | undefined;
  let acceptedAt: Map<string, Date>;
  let verificationResponse: ((challenge: string) => Response) | undefined;

  beforeEach(async () => {
    f = await loadingFixture(process.env.AUTH_TEST_DATABASE_URL!);
    source = await f.seedEventTrigger();
    name = `factorize.event.${source.definitionId}`;
    grantActive = true;
    signingKey = key;
    challengeMatches = true;
    deliveries = [];
    verifications = [];
    statuses = [];
    unexpected = [];
    holdDelivery = undefined;
    acceptedAt = new Map();
    verificationResponse = undefined;
    auth = { ...f.auth, authMethod: "oauth", oauthGrantId: "grant-1", oauthClientId: "client-1", oauthExpiresAt: Date.now() / 1000 + 3600 };
    f.env.OAUTH_PROVIDER = {
      listUserGrants: async () => ({
        items: grantActive ? [{
          id: auth.oauthGrantId, clientId: auth.oauthClientId, metadata: { tenantId: f.tenantId }, scope: auth.scopes,
        }] : [],
      }),
    } as unknown as NonNullable<typeof f.env.OAUTH_PROVIDER>;
    request = mcpRequest(f.env, auth);
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      try {
        expect(url).toBe(receiver);
        expect(init?.method).toBe("POST");
        expect(init?.redirect).toBe("manual");
        const headers = new Headers(init?.headers);
        expect(headers.has("Authorization")).toBe(false);
        expect(headers.get("Content-Type")).toBe("application/json");
        const body = String(init?.body);
        const id = headers.get("webhook-id")!;
        const timestamp = headers.get("webhook-timestamp")!;
        const signature = headers.get("webhook-signature")!;
        const subscriptionId = headers.get("X-MCP-Subscription-Id")!;
        expect(Buffer.byteLength(body)).toBeLessThanOrEqual(256 * 1024);
        // Independently verify the receiver's raw bytes without reserializing.
        const digest = createHmac("sha256", signingKey).update(`${id}.${timestamp}.`).update(Buffer.from(body)).digest("base64");
        expect(signature.split(" ")[0]).toBe("v1," + digest);
        expect(Number(timestamp)).toBeGreaterThan(0);
        const event = JSON.parse(body);
        if (event.type === "verification") {
          expect(id).toMatch(/^msg_verification_/);
          verifications.push(event.challenge);
          return verificationResponse?.(event.challenge) ??
            Response.json({ challenge: challengeMatches ? event.challenge : "incorrect" });
        }
        expect(event.eventId).toBe(id);
        deliveries.push({ id, timestamp, signature, subscriptionId, event });
        await holdDelivery?.();
        const status = statuses.shift() ?? 200;
        if (status >= 200 && status < 300) acceptedAt.set(id, new Date());
        return new Response(null, { status });
      } catch (error) {
        unexpected.push(error);
        throw error;
      }
    });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await f?.cleanup();
    expect(unexpected).toEqual([]);
  });

  const subscribe = (url = receiver, ttlMs?: number) => request("events/subscribe", {
    name, arguments: {}, delivery: { mode: "webhook", url, secret: secret(signingKey) }, cursor: null, ttlMs,
  });
  const unsubscribe = () => request("events/unsubscribe", { name, arguments: {}, delivery: { mode: "webhook", url: receiver } });
  const tool = async (toolName: string, args: Record<string, unknown>, identity = auth) =>
    (await request("tools/call", { name: toolName, arguments: args }, identity)).message.result;
  const fire = async (idempotencyKey: string, data = { text: "committed value" }) => {
    const result = await tool("fire_trigger", { triggerId: source.triggerId, idempotencyKey, data });
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    return result.structuredContent as { occurrenceId: string; duplicate: boolean };
  };
  const read = (args: Record<string, unknown>, identity = auth) => tool("read_event_occurrences", args, identity);
  const outbox = async () => (await f.db.pool.query(
    "SELECT occurrence_id,status,attempts,http_status FROM app.mcp_event_deliveries ORDER BY updated_at,occurrence_id",
  )).rows;

  it("requires canonical MCP sources and persists the configured Linear webhook", async () => {
    const catalog = (await request("tools/list")).message.result.tools;
    for (const toolName of ["create_trigger", "update_trigger"]) {
      const schema = catalog.find((item: { name: string }) => item.name === toolName).inputSchema;
      expect(schema.properties).toMatchObject({ sources: { type: "array" } });
      expect(schema.properties).not.toHaveProperty("events");
      expect(schema.required).toContain("sources");
    }
    const config = {
      provider: "linear", projectId: "fixture-project",
      matchRules: [{ type: "status", targetId: "fixture-todo" }],
    };
    const webhook = { kind: "webhook", enabled: true, config };
    const input = { name: "fixture-linear", eventId: source.definitionId };
    expect((await tool("create_trigger", input)).isError).toBe(true);
    expect((await tool("create_trigger", { ...input, events: [webhook] })).isError).toBe(true);
    const create = await tool("create_trigger", { ...input, sources: [webhook] });
    expect(create.isError, JSON.stringify(create)).not.toBe(true);
    const triggerId = create.structuredContent.id;
    const get = () => tool("get_trigger", { triggerId });
    const original = (await get()).structuredContent.sources;
    expect(original).toMatchObject([{ kind: "manual" }, webhook]);
    const update = { ...input, triggerId };
    const manual = { kind: "manual", id: original[0].id, config: {} };
    const newWebhook = { ...webhook, id: original[1].id, config: { ...config, matchRules: [{ type: "status", targetId: "fixture-review" }] } };
    expect((await tool("update_trigger", { ...update, sources: [manual, newWebhook] })).isError).not.toBe(true);
    const updated = (await get()).structuredContent.sources;
    expect(updated).toMatchObject([manual, newWebhook]);
    expect((await tool("update_trigger", update)).isError).toBe(true);
    expect((await tool("update_trigger", { ...update, events: [webhook] })).isError).toBe(true);
    expect((await get()).structuredContent.sources).toEqual(updated);
  });

  it("discovers, subscribes, commits, dispatches and reads a deduplicated occurrence", async () => {
    expect((await request("server/discover")).message.result.capabilities).toMatchObject({ events: {}, resources: { subscribe: true } });
    expect((await request("events/list")).message.result.events).toEqual([{
      name, title: "fixture-event", description: "", delivery: ["webhook"],
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      payloadSchema: {
        type: "object", additionalProperties: false, required: ["occurrenceId", "definitionId"],
        properties: { occurrenceId: { type: "string", format: "uuid" }, definitionId: { type: "string", format: "uuid" } },
      },
    }]);
    await f.db.pool.query("UPDATE app.event_definitions SET name='renamed',description='Updated description' WHERE tenant_id=$1 AND id=$2", [f.tenantId, source.definitionId]);
    expect((await request("events/list")).message.result.events[0]).toMatchObject({ name, title: "renamed", description: "Updated description" });
    await fire("before-subscribe");
    const active = (await subscribe()).message.result;
    expect(active).toMatchObject({ id: expect.stringMatching(/^sub_/), refreshBefore: expect.any(String), cursor: null, truncated: false });
    expect(verifications).toHaveLength(1);
    const committed = await fire("one");
    expect(await fire("one")).toEqual({ ...committed, duplicate: true });
    expect(await outbox()).toEqual([{ occurrence_id: committed.occurrenceId, status: "pending", attempts: 0, http_status: null }]);
    await dispatchMcpEvents(f.env);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({
      id: committed.occurrenceId, subscriptionId: active.id,
      event: { eventId: committed.occurrenceId, name, data: { definitionId: source.definitionId, occurrenceId: committed.occurrenceId }, cursor: null },
    });
    expect((await read({ occurrenceId: committed.occurrenceId })).structuredContent).toEqual({
      items: [{ occurrenceId: committed.occurrenceId, definitionId: source.definitionId, definitionRevision: 1,
        occurredAt: deliveries[0].event.timestamp, recordedAt: expect.any(String), payload: { text: "committed value" } }],
      nextCursor: null,
    });
    const toolInfo = (await request("tools/list")).message.result.tools.find((item: { name: string }) => item.name === "read_event_occurrences");
    expect(toolInfo.annotations.readOnlyHint).toBe(true);
    expect(toolInfo.inputSchema.type).toBe("object");
  });

  it("recovers after an empty wake with recorded-time pagination and a late arrival", async () => {
    const old = await fire("old");
    await f.db.pool.query("UPDATE app.event_occurrences SET created_at=now()-interval '1 day' WHERE id=$1", [old.occurrenceId]);
    const since = new Date(Date.now() - 60_000).toISOString();
    expect((await subscribe()).message.result).toBeDefined();
    const first = await fire("first");
    const other = await f.seedEventTrigger(f.otherTenant);
    const another = (await tool("create_event", { name: "another-event" })).structuredContent;
    const anotherTrigger = (await tool("create_trigger", {
      name: "another-trigger", eventId: another.id, sources: [{ kind: "manual", config: {} }],
    })).structuredContent;
    const match = (triggerId: string, tenantId = f.tenantId) => new EventMatchRepository(f.db).match({
      tenantId, triggerId, triggerRevision: 1, sourceIdentity: "late-test", deduplicationKey: "one",
      evidence: { message: "late arrival" }, decision: "matched", occurredAt: "2001-01-01T00:00:00.000Z",
    });
    await match(anotherTrigger.id);
    await match(other.triggerId, f.otherTenant);
    const late = (await match(source.triggerId)).occurrence!;
    await dispatchMcpEvents(f.env);
    expect(deliveries).toHaveLength(2);
    deliveries = [];
    const query = { definitionId: source.definitionId, since, limit: 1 };
    const page = (await read(query)).structuredContent;
    expect(page.items.map((item: { occurrenceId: string }) => item.occurrenceId)).toEqual([first.occurrenceId]);
    const next = (await read({ ...query, cursor: page.nextCursor })).structuredContent;
    expect(next.items).toMatchObject([{ occurrenceId: late.id, occurredAt: late.occurredAt, payload: { message: "late arrival" } }]);
    expect(next.nextCursor).toBeNull();
    expect((await read({ ...query, cursor: page.nextCursor })).structuredContent).toEqual(next);
    expect((await read({ ...query, definitionId: another.id, cursor: page.nextCursor })).isError).toBe(true);
    expect((await read({ ...query, since: "2000-01-01T00:00:00Z", cursor: page.nextCursor })).isError).toBe(true);
  });

  it("retries a missed wake and transient response with a fresh signature, and fences overlapping dispatches", async () => {
    const wake = vi.fn(async () => { throw new Error("scheduler unavailable"); });
    f.env.SCHEDULER = { idFromName: vi.fn(), get: () => ({ fetch: wake }) } as unknown as DurableObjectNamespace;
    expect((await subscribe()).message.result).toBeDefined();
    const event = await fire("retry");
    expect(wake).toHaveBeenCalledOnce();
    statuses.push(503, 200);
    let started!: () => void, release!: () => void;
    const sending = new Promise<void>(resolve => { started = resolve; });
    const released = new Promise<void>(resolve => { release = resolve; });
    holdDelivery = () => { started(); return released; };
    const storage = {
      get: async () => undefined, getAlarm: async () => null, setAlarm: vi.fn(async () => {}),
    };
    const alarm = new AlarmCoordinator({ storage } as unknown as DurableObjectState, f.env);
    const firstDispatch = alarm.alarm();
    await sending;
    try {
      expect(await dispatchMcpEvents(f.env)).toBe(0);
    } finally {
      release();
      await firstDispatch;
    }
    expect(await outbox()).toEqual([{ occurrence_id: event.occurrenceId, status: "pending", attempts: 1, http_status: 503 }]);
    await f.db.pool.query("UPDATE app.mcp_event_deliveries SET next_attempt_at=now() WHERE occurrence_id=$1", [event.occurrenceId]);
    expect(storage.setAlarm).toHaveBeenCalledOnce();
    await dispatchMcpEvents(f.env, () => Number(deliveries[0].timestamp) * 1000 + 30_000);
    expect(deliveries).toHaveLength(2);
    expect(deliveries[1].event).toEqual(deliveries[0].event);
    expect(deliveries[1].timestamp).not.toBe(deliveries[0].timestamp);
    expect(deliveries[1].signature).not.toBe(deliveries[0].signature);
    expect(await outbox()).toEqual([{ occurrence_id: event.occurrenceId, status: "accepted", attempts: 2, http_status: 200 }]);

    const interrupted = await fire("interrupted-claim");
    await f.db.pool.query(`UPDATE app.mcp_event_deliveries
      SET status='sending',attempts=1,claim_id=gen_random_uuid(),next_attempt_at=now()-interval '1 second' WHERE occurrence_id=$1`,
    [interrupted.occurrenceId]);
    await dispatchMcpEvents(f.env);
    expect((await outbox()).at(-1)).toEqual({
      occurrence_id: interrupted.occurrenceId, status: "accepted", attempts: 2, http_status: 200,
    });
  });

  it("refreshes the grant subscription and prevents sends after unsubscribe, expiry or grant revocation", async () => {
    const first = (await subscribe(receiver, 60_000)).message.result;
    const refresh = (await subscribe(receiver, 120_000)).message.result;
    expect(refresh.id).toBe(first.id);
    expect(Date.parse(refresh.refreshBefore)).toBeGreaterThan(Date.parse(first.refreshBefore));
    expect(verifications).toHaveLength(1);
    signingKey = replacement;
    // The refreshed OAuth bearer has a new expiry, while its grant is unchanged.
    auth = { ...auth, oauthExpiresAt: Date.now() / 1000 + 7200 };
    request = mcpRequest(f.env, auth);
    expect((await subscribe()).message.result.id).toBe(first.id);
    expect(verifications).toHaveLength(2);
    const rotated = await fire("rotated");
    await dispatchMcpEvents(f.env);
    expect(deliveries[0].id).toBe(rotated.occurrenceId);
    expect(deliveries[0].signature.split(" ")).toHaveLength(2);
    const stopped = await fire("stop");
    for (let i = 0; i < 2; i++) {
      expect(Object.keys((await unsubscribe()).message.result).sort()).toEqual(["_meta", "resultType"]);
    }
    expect((await subscribe()).message.result.id).toBe(first.id);
    const expired = await fire("expire");
    await f.db.pool.query("UPDATE app.mcp_event_subscriptions SET expires_at=now()-interval '1 second'");
    await dispatchMcpEvents(f.env);
    expect((await subscribe()).message.result.id).toBe(first.id);
    const narrowed = await fire("scope-removed");
    await f.db.pool.query(`INSERT INTO app.agent_identities(tenant_id,kind,subject,user_id,session_version,disabled_scopes)
      VALUES($1,'oauth',$2,$3,$4,ARRAY['triggers:read'])`, [f.tenantId, auth.oauthGrantId, auth.userId, auth.sessionVersion]);
    await dispatchMcpEvents(f.env);
    await f.db.pool.query("UPDATE app.agent_identities SET disabled_scopes='{}' WHERE tenant_id=$1 AND subject=$2", [f.tenantId, auth.oauthGrantId]);
    const revoked = await fire("revoke");
    grantActive = false;
    await dispatchMcpEvents(f.env);
    expect(deliveries).toHaveLength(1);
    expect(await outbox()).toEqual(expect.arrayContaining([stopped, expired, narrowed, revoked].map(event => ({
      occurrence_id: event.occurrenceId, status: "cancelled", attempts: 0, http_status: null,
    }))));
    await new IdentityRepository(f.db, f.otherTenant).upsertOwner(f.userId, "owner@example.test");
    const other = { ...f.auth, tenantId: f.otherTenant };
    expect((await read({ occurrenceId: rotated.occurrenceId }, other)).isError).toBe(true);
    expect((await read({ occurrenceId: rotated.occurrenceId }, { ...auth, scopes: [] })).isError).toBe(true);
  });

  it("rejects failed verification, forbidden destinations, unauthorized calls and cross-tenant names", async () => {
    const input = { name, delivery: { mode: "webhook", url: receiver, secret: secret(key) } };
    expect((await request("events/list", {}, { ...auth, scopes: [] })).message.error.code).toBe(-32024);
    expect((await request("events/subscribe", input, { ...auth, scopes: [] })).message.error.code).toBe(-32024);
    const other = await f.seedEventTrigger(f.otherTenant);
    expect((await request("events/subscribe", { ...input, name: `factorize.event.${other.definitionId}` })).message.error).toMatchObject({ code: -32023 });
    expect((await request("events/list", {}, auth, { "Mcp-Method": "events/unsubscribe" })).status).toBe(400);
    expect((await subscribe("http://receiver.example.test")).message.error.code).toBe(-32602);
    for (const url of ["https://127.0.0.1/", "https://[::ffff:127.0.0.1]/", "https://internal.local./"]) {
      expect((await subscribe(url)).message.error).toMatchObject({ code: -32015, data: { reason: "forbidden_destination" } });
    }
    expect(verifications).toHaveLength(0);
    verificationResponse = () => new Response(null, { status: 307, headers: { Location: "https://127.0.0.1/" } });
    expect((await subscribe()).message.error).toMatchObject({ code: -32015 });
    verificationResponse = challenge => Response.json({ challenge, padding: "a".repeat(4096) });
    expect((await subscribe()).message.error).toMatchObject({ code: -32015, data: { reason: "challenge_failed" } });
    verificationResponse = undefined;
    challengeMatches = false;
    expect((await subscribe()).message.error).toMatchObject({ code: -32015, data: { reason: "challenge_failed" } });
    expect((await f.db.pool.query("SELECT 1 FROM app.mcp_event_subscriptions")).rowCount).toBe(0);
    await fire("no-subscription");
    expect(await outbox()).toEqual([]);
  });


  it("summarizes a normal, burst and empty wake in the mocked Dot pilot", async () => {
    expect((await subscribe()).message.result).toBeDefined();
    const savedDefinition = source.definitionId;
    const since = new Date(Date.now() - 60_000).toISOString();
    const seen = new Set<string>();
    const committedAt = new Map<string, Date>();
    const milestones: Record<string, { committedAt: Date; acceptedAt: Date; firstReadAt: Date; completedAt: Date }[]> = {};
    async function runDot(wakeIds: string[]) {
      const firstReadAt = new Date();
      const records: { occurrenceId: string; payload: { text: string } }[] = [];
      if (wakeIds.length) {
        for (const occurrenceId of wakeIds) records.push(...(await read({ occurrenceId })).structuredContent.items);
      } else {
        let cursor: string | undefined;
        do {
          const page = (await read({ definitionId: savedDefinition, since, limit: 1, cursor })).structuredContent;
          records.push(...page.items);
          cursor = page.nextCursor ?? undefined;
        } while (cursor);
      }
      const summary = records.filter(record => !seen.has(record.occurrenceId)).map(record => {
        seen.add(record.occurrenceId);
        return record.payload.text;
      });
      return { firstReadAt, completedAt: new Date(), summary };
    }

    for (const [scenario, texts] of [
      ["normal", ["normal event"]],
      ["burst", ["first burst event", "second burst event", "third burst event"]],
      ["empty", ["event recovered from an empty wake"]],
    ] as const) {
      deliveries = [];
      for (const text of texts) {
        const committed = await fire(text, { text });
        committedAt.set(committed.occurrenceId, new Date());
      }
      await dispatchMcpEvents(f.env);
      const ids = deliveries.map(delivery => delivery.id);
      expect(ids).toHaveLength(texts.length);
      const run = await runDot(scenario === "empty" ? [] : ids);
      expect([...run.summary].sort()).toEqual([...texts].sort());
      milestones[scenario] = ids.map(id => ({
        committedAt: committedAt.get(id)!, acceptedAt: acceptedAt.get(id)!,
        firstReadAt: run.firstReadAt, completedAt: run.completedAt,
      }));
    }
    if (process.env.FACTORIZE_MOCK_DOT_TIMELINE === "1") {
      console.info("Mocked Dot smoke timeline", JSON.stringify(milestones));
    }
    expect(Object.keys(milestones)).toEqual(["normal", "burst", "empty"]);
    for (const stage of Object.values(milestones).flat()) {
      expect(stage.committedAt.getTime()).toBeLessThanOrEqual(stage.acceptedAt.getTime());
      expect(stage.acceptedAt.getTime()).toBeLessThanOrEqual(stage.firstReadAt.getTime());
      expect(stage.firstReadAt.getTime()).toBeLessThanOrEqual(stage.completedAt.getTime());
    }
    expect((await runDot([])).summary).toEqual([]);
  });

  it("rolls back the outbox with its occurrence and terminates 410 and 413 deliveries", async () => {
    expect((await subscribe()).message.result).toBeDefined();
    await f.db.pool.query(`CREATE FUNCTION app.fail_mcp_event_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'forced rollback'; END $$;
      CREATE TRIGGER fail_mcp_event_delivery AFTER INSERT ON app.mcp_event_deliveries
      FOR EACH ROW EXECUTE FUNCTION app.fail_mcp_event_delivery()`);
    const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = await tool("fire_trigger", { triggerId: source.triggerId, idempotencyKey: "rollback", data: {} });
      expect(result.isError).toBe(true);
      expect((await f.db.pool.query("SELECT 1 FROM app.event_occurrences WHERE tenant_id=$1", [f.tenantId])).rowCount).toBe(0);
      expect(await outbox()).toEqual([]);
    } finally {
      diagnostic.mockRestore();
      await f.db.pool.query("DROP TRIGGER fail_mcp_event_delivery ON app.mcp_event_deliveries");
    }
    await fire("rollback");
    await fire("second");
    statuses.push(410, 413);
    await dispatchMcpEvents(f.env);
    expect((await outbox()).map(item => item.http_status).sort()).toEqual([410, 413]);
    expect((await outbox()).every(item => item.status === "failed" && item.attempts === 1)).toBe(true);
  });
});
