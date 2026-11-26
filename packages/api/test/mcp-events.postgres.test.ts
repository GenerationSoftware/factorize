import { pruneRevokedMcpSubscriptions } from "../src/postgres/mcp-event-outbox";
import { createHmac } from "node:crypto";
import { AlarmCoordinator } from "../src/alarm-coordinator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchMcpEvents } from "../src/mcp-event-subscriptions";
import { EventMatchRepository } from "../src/postgres/event-match-repository";
import { IdentityRepository } from "../src/postgres/identity-repository";
import worker from "../src/worker";
import app from "../src/index";
import { signSession } from "../src/session";
import type { OAuthProps } from "../src/types";
import { loadingFixture } from "./helpers/loading-fixture";
import { mcpRequest } from "./helpers/mcp-request";

vi.mock("cloudflare:workers", () => ({
  WorkerEntrypoint: class {}, WorkflowEntrypoint: class {},
  DurableObject: class { constructor(protected ctx: unknown, protected env: unknown) {} },
}));
vi.mock("@cloudflare/workers-oauth-provider", () => ({ OAuthProvider: class {}, AuthorizationError: class extends Error {}, getOAuthApi: vi.fn() }));

const receiver = "https://receiver.example.com/inbound";
const otherReceiver = "https://receiver.example.com/second";
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
      revokeGrant: async (id: string, userId: string) => {
        expect([id, userId]).toEqual([auth.oauthGrantId, f.userId]);
        grantActive = false;
      },
      listUserGrants: async () => ({
        items: grantActive ? [{
          id: auth.oauthGrantId, clientId: auth.oauthClientId, createdAt: 1_700_000_000, metadata: { tenantId: f.tenantId }, scope: auth.scopes,
        }] : [],
      }),
    } as unknown as NonNullable<typeof f.env.OAUTH_PROVIDER>;
    request = mcpRequest(f.env, auth);
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      try {
        expect([receiver, otherReceiver]).toContain(url);
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

  it("retires Cloudflare Tail ingress and suppresses a queued Tail callback without removing history", async () => {
    expect((await subscribe()).message.result).toBeDefined();
    const outcome = await new EventMatchRepository(f.db).match({
      tenantId: f.tenantId, triggerId: source.triggerId, triggerRevision: 1,
      sourceIdentity: `cloudflareTail:${crypto.randomUUID()}`, deduplicationKey: "historical",
      evidence: { text: "preserved" }, decision: "matched",
    });
    expect((await outbox()).find(row => row.occurrence_id === outcome.occurrence?.id)).toMatchObject({ status: "pending" });
    const response = await app.fetch(new Request(`${f.env.APP_ORIGIN}/webhooks/cloudflare/${f.tenantId}/${source.triggerId}`, {
      method: "POST", body: "old relay payload",
    }), f.env, {} as ExecutionContext);
    expect(response.status).toBe(410);
    const ordinary = await fire("still active");
    await dispatchMcpEvents(f.env);
    expect(deliveries.map(delivery => delivery.event.data.occurrenceId)).toEqual([ordinary.occurrenceId]);
    expect((await outbox()).find(row => row.occurrence_id === outcome.occurrence?.id)).toMatchObject({ status: "cancelled", attempts: 0 });
    expect((await f.db.pool.query("SELECT id FROM app.event_occurrences WHERE id=$1", [outcome.occurrence?.id])).rowCount).toBe(1);
  });

  it("shows old Tail sources as retired, rejects new ones, and permits removing the existing source", async () => {
    const legacyId = crypto.randomUUID(), integrationId = crypto.randomUUID();
    const legacy = { id: legacyId, kind: "webhook", enabled: true, config: { provider: "cloudflareTail", integrationId } };
    await f.db.pool.query(`INSERT INTO app.events(tenant_id,id,trigger_id,kind,slug,position,config)
      VALUES ($1,$2,$3,'webhook','legacy-tail',2,$4)`, [f.tenantId, legacyId, source.triggerId, legacy.config]);
    const rest = (path: string, method = "GET", body?: unknown) => worker.fetch(new Request(f.env.APP_ORIGIN + path, {
      method, headers: { Cookie: f.cookie, Origin: f.env.APP_ORIGIN, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), f.env, {} as ExecutionContext);
    const path = `/api/v1/triggers/${source.triggerId}`;
    const payload = { name: "fixture-trigger", eventId: source.definitionId };
    expect((await (await rest(path)).json() as any).sources).toContainEqual(expect.objectContaining({
      id: legacyId, enabled: false, config: legacy.config,
    }));
    expect((await rest("/api/v1/triggers", "POST", { ...payload, sources: [legacy] })).status).toBe(400);
    expect((await rest(path, "PUT", { ...payload, sources: [legacy] })).status).toBe(200);
    const removed = await rest(path, "PUT", { ...payload, sources: [{ kind: "manual", enabled: true, config: {} }] });
    expect(removed.status).toBe(200);
    expect((await removed.json() as any).sources).not.toContainEqual(expect.objectContaining({ id: legacyId }));
  });

  it.each(["/api/v1/auth/logout", "/auth/logout"])("keeps existing MCP webhook deliveries active after browser sign-out via %s", async logoutPath => {
    const cookie2 = "factorize_session=" + encodeURIComponent(await signSession({
      ...f.auth, email: "owner@example.test", exp: Math.floor(Date.now() / 1000) + 3600, browserNonce: crypto.randomUUID(),
    }, f.env.SESSION_SIGNING_SECRET));
    const call = (path: string, cookie: string, method = "GET") => (path === "/auth/logout" ? app : worker).fetch(new Request(f.env.APP_ORIGIN + path, {
      method, headers: { Cookie: cookie, Origin: f.env.APP_ORIGIN, "Content-Type": "application/json" },
      body: method === "POST" ? "{}" : undefined,
    }), f.env, {} as ExecutionContext);

    expect(await (await call("/api/v1/session", f.cookie)).json()).toMatchObject({ authenticated: true });
    expect(await (await call("/api/v1/session", cookie2)).json()).toMatchObject({ authenticated: true });
    const subscriptionId = (await subscribe()).message.result.id;
    expect(subscriptionId).toMatch(/^sub_/);
    const logout = await call(logoutPath, f.cookie, "POST");
    expect(logout.status).toBe(logoutPath === "/auth/logout" ? 302 : 200);
    expect(logout.headers.getSetCookie()).toEqual(expect.arrayContaining([
      expect.stringMatching(/^factorize_session=;.*Max-Age=0/),
    ]));
    expect(await (await call("/api/v1/session", f.cookie)).json()).toEqual({ authenticated: false });
    expect((await call("/api/v1/triggers", f.cookie)).status).toBe(401);
    expect(await (await call("/api/v1/session", cookie2)).json()).toMatchObject({ authenticated: true });
    expect((await new IdentityRepository(f.db, f.tenantId).member(f.userId))?.sessionVersion).toBe(auth.sessionVersion);
    const occurrence = await fire("after-browser-sign-out");
    await dispatchMcpEvents(f.env);
    expect(deliveries).toEqual([expect.objectContaining({
      subscriptionId, event: expect.objectContaining({ data: expect.objectContaining({ occurrenceId: occurrence.occurrenceId }) }),
    })]);

    const revocation = await call("/api/v1/access/authorizations/grant-1", cookie2, "DELETE");
    expect(revocation.status).toBe(200);
    expect(await revocation.json()).toEqual({ revoked: 1 });
    expect(grantActive).toBe(false);
    expect((await f.db.pool.query("SELECT status FROM app.mcp_event_subscriptions WHERE id=$1", [subscriptionId])).rows).toEqual([]);
    const afterRevoke = await tool("fire_trigger", { triggerId: source.triggerId, idempotencyKey: "after-explicit-revoke", data: {} }, f.auth);
    expect(afterRevoke.isError).not.toBe(true);
    await dispatchMcpEvents(f.env);
    expect(deliveries).toHaveLength(1);
  });

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

  it("reports safe outbound delivery diagnostics for exactly one owner-authorized occurrence", async () => {
    const toolInfo = (await request("tools/list")).message.result.tools.find((item: { name: string }) =>
      item.name === "read_event_delivery_diagnostics");
    expect(toolInfo.annotations.readOnlyHint).toBe(true);
    const diagnosis = (occurrenceId: string, identity = auth) =>
      tool("read_event_delivery_diagnostics", { occurrenceId }, identity);
    const detail = async (occurrenceId: string) => {
      const result = await diagnosis(occurrenceId);
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      return result.structuredContent;
    };

    const empty = (await fire("no-subscription", { text: "payload-that-must-not-be-returned" })).occurrenceId;
    expect(await detail(empty)).toEqual({ occurrenceId: empty, state: "no_delivery_records", items: [], truncated: false });
    const missing = await diagnosis(crypto.randomUUID());
    expect(missing.isError).toBe(true);
    expect(JSON.stringify(missing.content)).toContain("Event occurrence not found.");

    const other = await f.seedEventTrigger(f.otherTenant);
    const otherMatch = await new EventMatchRepository(f.db).match({
      tenantId: f.otherTenant, triggerId: other.triggerId, triggerRevision: 1, sourceIdentity: "isolated-test",
      deduplicationKey: "other-occurrence", evidence: { text: "private" }, decision: "matched",
    });
    const crossTenant = await diagnosis(otherMatch.occurrence!.id);
    expect(crossTenant.isError).toBe(true);
    expect(crossTenant.content).toEqual(missing.content);
    expect((await request("tools/call", { name: "read_event_delivery_diagnostics", arguments: { occurrenceId: empty } }, { ...auth, scopes: [] })).status).toBe(403);
    expect((await request("tools/call", { name: "read_event_delivery_diagnostics", arguments: { occurrenceId: empty } }, { ...auth, userId: crypto.randomUUID() })).status).toBe(401);

    const subscriptionId = (await subscribe()).message.result.id;
    expect(subscriptionId).toMatch(/^sub_/);
    const accepted = (await fire("accepted")).occurrenceId;
    const pending = await detail(accepted);
    expect(pending).toEqual({
      occurrenceId: accepted, state: "delivery_records_present", truncated: false,
      items: [{ subscriptionId, status: "pending", attempts: 0, lastOutcome: null, httpStatus: null,
        updatedAt: expect.any(String), nextAttemptAt: expect.any(String) }],
    });
    await dispatchMcpEvents(f.env);
    expect((await detail(accepted)).items).toEqual([{
      subscriptionId, status: "accepted", attempts: 1, lastOutcome: "accepted", httpStatus: 200,
      updatedAt: expect.any(String), nextAttemptAt: null,
    }]);

    const rejected = (await fire("rejected")).occurrenceId;
    statuses.push(410);
    await dispatchMcpEvents(f.env);
    expect((await detail(rejected)).items).toMatchObject([{ status: "failed", lastOutcome: "http_error", httpStatus: 410, attempts: 1 }]);
    // Unrecognized stored text is not echoed even if a future writer stores it.
    await f.db.pool.query("UPDATE app.mcp_event_deliveries SET last_outcome=$2 WHERE occurrence_id=$1",
      [rejected, "raw-error-with-private-response-body"]);
    const redacted = await detail(rejected);
    expect(redacted.items[0].lastOutcome).toBe("unclassified");
    expect(JSON.stringify(redacted)).not.toContain("raw-error-with-private-response-body");

    const removed = (await fire("cancel-after-unsubscribe")).occurrenceId;
    await unsubscribe();
    await dispatchMcpEvents(f.env);
    expect((await detail(removed)).items).toMatchObject([{ status: "cancelled", lastOutcome: "subscription_inactive", httpStatus: null, attempts: 0 }]);

    expect((await subscribe()).message.result.id).toBeDefined();
    const denied = (await fire("cancel-after-grant-revocation")).occurrenceId;
    grantActive = false;
    await dispatchMcpEvents(f.env);
    grantActive = true;
    expect((await detail(denied)).items).toMatchObject([{ status: "pending", lastOutcome: "authorization_inactive", httpStatus: null, attempts: 0 }]);

    const retry = (await fire("retry")).occurrenceId;
    statuses.push(503);
    await dispatchMcpEvents(f.env);
    expect((await detail(retry)).items).toMatchObject([{ status: "pending", lastOutcome: "http_error", httpStatus: 503, attempts: 1, nextAttemptAt: expect.any(String) }]);
    expect(await detail(empty)).toEqual({ occurrenceId: empty, state: "no_delivery_records", items: [], truncated: false });
  });

  const processing = async (toolName: string, subscriptionId: string, args: Record<string, unknown> = {}, identity = auth) =>
    tool(toolName, { subscription_id: subscriptionId, ...args }, identity);
  const configure = (id: string, enabled: boolean) =>
    processing("set_event_processing_acknowledgments", id, { enabled, ...(enabled ? { ack_timeout_seconds: 30 } : {}) });
  const ack = (id: string, events: string[], cooldown?: number) =>
    processing("acknowledge_events", id, { event_ids: events, ...(cooldown ? { cooldown_seconds: cooldown } : {}) });
  const replay = (id: string, events: string[]) =>
    processing("replay_unacknowledged_events", id, { event_ids: events });
  const inspectProcessing = async (occurrenceId: string) =>
    (await tool("read_event_delivery_diagnostics", { occurrenceId })).structuredContent.items[0];
  const makeRecoveryDue = (occurrenceId: string) => f.db.pool.query(
    "UPDATE app.mcp_event_deliveries SET ack_due_at=now()-interval '1 second' WHERE occurrence_id=$1", [occurrenceId]);

  it("lists only the signed-in owner's workspace subscriptions and redacts their transport configuration", async () => {
    const active = (await subscribe()).message.result.id as string;
    const expired = (await subscribe(otherReceiver)).message.result.id as string;
    await configure(active, true);
    const legacyEnd = new Date("2020-01-01T00:00:00.000Z").toISOString();
    await f.db.pool.query("UPDATE app.mcp_event_subscriptions SET last_cooldown_ends_at=$3 WHERE tenant_id=$1 AND id=$2", [f.tenantId, expired, legacyEnd]);
    await f.db.pool.query("UPDATE app.mcp_event_subscriptions SET expires_at=now()-interval '1 hour' WHERE tenant_id=$1 AND id=$2", [f.tenantId, expired]);

    const secondUser = crypto.randomUUID();
    const member = await new IdentityRepository(f.db, f.tenantId).upsertOwner(secondUser, "other@example.test");
    const otherOwner = await new IdentityRepository(f.db, f.otherTenant).upsertOwner(f.userId, "owner@example.test");
    const otherDefinition = await f.seedEventTrigger(f.otherTenant);
    const hiddenInWorkspace = "sub_" + "1".repeat(64), hiddenInOtherWorkspace = "sub_" + "2".repeat(64);
    for (const [tenantId, userId, definitionId, id] of [
      [f.tenantId, secondUser, source.definitionId, hiddenInWorkspace],
      [f.otherTenant, f.userId, otherDefinition.definitionId, hiddenInOtherWorkspace],
    ]) {
      await f.db.pool.query(`INSERT INTO app.mcp_event_subscriptions
        (tenant_id,id,user_id,session_version,grant_id,client_id,definition_id,arguments,callback_url,
         encrypted_secret,secret_fingerprint,verified_at,generation,status,expires_at,last_cooldown_started_at,last_cooldown_ends_at)
        SELECT $1,$2,$3,session_version,grant_id,client_id,$4,arguments,callback_url,encrypted_secret,
         secret_fingerprint,verified_at,generation,status,expires_at,now(),now()+interval '1 minute'
        FROM app.mcp_event_subscriptions WHERE tenant_id=$5 AND id=$6`, [tenantId, id, userId, definitionId, f.tenantId, active]);
    }
    const cookieFor = async (tenantId: string, userId: string, sessionVersion: number) => "factorize_session=" + await signSession({
      ...f.auth, tenantId, userId, sessionVersion, email: "owner@example.test", exp: Math.floor(Date.now() / 1000) + 60,
    }, f.env.SESSION_SIGNING_SECRET);
    const list = "/api/v1/event-subscriptions";
    const response = await f.request(list);
    expect(response.status).toBe(200);
    const rows = await response.json() as Record<string, unknown>[];
    const expected = { eventId: source.definitionId, eventName: "fixture-event", grantId: "grant-1", expiresAt: expect.any(String) };
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(expect.arrayContaining([
      { ...expected, id: active, status: "active", acknowledgmentMode: "required", lastCooldownStartedAt: null, lastCooldownEndsAt: null },
      { ...expected, id: expired, status: "expired", acknowledgmentMode: "off", lastCooldownStartedAt: null, lastCooldownEndsAt: legacyEnd },
    ]));
    expect(await (await f.request(list + "/" + active)).json()).toEqual(rows.find(row => row.id === active));
    expect((await f.request(list, "")).status).toBe(401);
    expect((await f.request(list, await cookieFor(f.tenantId, secondUser, member.sessionVersion))).status).toBe(401);
    expect((await f.request(list + "/" + active, await cookieFor(f.otherTenant, f.userId, otherOwner.sessionVersion))).status).toBe(404);
    expect((await f.request(list + "/" + hiddenInWorkspace)).status).toBe(404);
    expect((await f.request(list + "/" + hiddenInOtherWorkspace)).status).toBe(404);
    expect((await f.request(list + "/malformed")).status).toBe(400);
    expect((await unsubscribe()).message.result).toBeDefined();
    expect(await (await f.request(list + "/" + active)).json()).toMatchObject({ status: "stopped" });
  });

  it("records only effective cooldowns and keeps the last scheduled interval when the active pause clears", async () => {
    const id = (await subscribe()).message.result.id;
    const get = async () => {
      const response = await f.request("/api/v1/event-subscriptions/" + id);
      expect(response.status).toBe(200);
      return await response.json() as { lastCooldownStartedAt: string | null; lastCooldownEndsAt: string | null };
    };
    const emptyHistory = { lastCooldownStartedAt: null, lastCooldownEndsAt: null };
    expect(await get()).toMatchObject(emptyHistory);
    await configure(id, true);
    const occurrences: string[] = [];
    for (const key of ["no-pause", "first-pause", "no-extension", "extension"]) {
      occurrences.push((await fire(key)).occurrenceId);
    }
    await dispatchMcpEvents(f.env);
    const [noPause, firstPause, noExtension, extension] = occurrences;
    expect((await ack(id, [noPause])).structuredContent).toMatchObject({ acknowledged: [noPause], cooldownUntil: null });
    expect(await get()).toMatchObject(emptyHistory);

    const firstEnd = (await ack(id, [firstPause], 60)).structuredContent.cooldownUntil;
    const first = await get();
    expect(first).toMatchObject({ lastCooldownStartedAt: expect.any(String), lastCooldownEndsAt: firstEnd });
    expect(Date.parse(firstEnd) - Date.parse(first.lastCooldownStartedAt!)).toBe(60_000);

    expect((await ack(id, [firstPause], 90)).structuredContent).toMatchObject({
      alreadyAcknowledged: [firstPause], cooldownUntil: firstEnd,
    });
    expect((await ack(id, [noExtension], 1)).structuredContent).toMatchObject({
      acknowledged: [noExtension], cooldownUntil: firstEnd,
    });
    expect(await get()).toEqual(first);

    const newEnd = (await ack(id, [extension], 90)).structuredContent.cooldownUntil;
    const latest = await get();
    expect(latest).toMatchObject({ lastCooldownStartedAt: expect.any(String), lastCooldownEndsAt: newEnd });
    expect(Date.parse(newEnd)).toBeGreaterThan(Date.parse(firstEnd));
    expect(Date.parse(newEnd) - Date.parse(latest.lastCooldownStartedAt!)).toBe(90_000);
    expect((await configure(id, false)).structuredContent.cooldownUntil).toBeNull();
    expect(await get()).toMatchObject({ lastCooldownStartedAt: latest.lastCooldownStartedAt, lastCooldownEndsAt: newEnd });
    await unsubscribe();
    expect(await get()).toMatchObject({ lastCooldownStartedAt: latest.lastCooldownStartedAt, lastCooldownEndsAt: newEnd, status: "stopped" });
  });

  it("acknowledges exact durable work and recovers only the unresolved original occurrence", async () => {
    const id = (await subscribe()).message.result.id;
    expect((await processing("get_event_processing_acknowledgments", id)).structuredContent.enabled).toBe(false);
    const defaultEvent = (await fire("default-delivery")).occurrenceId;
    await dispatchMcpEvents(f.env);
    expect(await inspectProcessing(defaultEvent)).not.toHaveProperty("processing");

    expect((await configure(id, true)).structuredContent).toMatchObject({ enabled: true, ackTimeoutSeconds: 30 });
    const a = (await fire("ack-a")).occurrenceId;
    const b = (await fire("ack-b")).occurrenceId;
    const c = (await fire("ack-c")).occurrenceId;
    expect((await ack(id, [a])).structuredContent.notAcknowledged).toEqual([a]);
    await dispatchMcpEvents(f.env);
    expect(await inspectProcessing(b)).toMatchObject({ status: "accepted", processing: { state: "awaiting_ack", recoveryAttempts: 0 } });
    expect((await ack(id, [c, a, a], 20)).structuredContent.acknowledged).toEqual([c, a]);
    const cooldown = (await processing("get_event_processing_acknowledgments", id)).structuredContent.cooldownUntil;
    expect((await ack(id, [a], 300)).structuredContent).toMatchObject({ alreadyAcknowledged: [a], cooldownUntil: cooldown });

    await makeRecoveryDue(b);
    expect(await dispatchMcpEvents(f.env)).toBe(0);
    const storage = { get: vi.fn(), getAlarm: async () => null, setAlarm: vi.fn() };
    const alarm = new AlarmCoordinator({ storage } as unknown as DurableObjectState, f.env);
    await alarm.alarm();
    expect(storage.setAlarm).toHaveBeenCalledOnce();
    expect(Math.abs(Number(storage.setAlarm.mock.calls[0][0]) - Date.parse(cooldown))).toBeLessThan(50);
    await f.db.pool.query("UPDATE app.mcp_event_subscriptions SET cooldown_until=now()-interval '1 second' WHERE id=$1", [id]);

    expect(await (await f.request("/api/v1/event-subscriptions/" + id)).json()).toMatchObject({
      lastCooldownStartedAt: expect.any(String), lastCooldownEndsAt: cooldown,
    });
    const originalCount = deliveries.length;
    await alarm.alarm(); // No new event arrived to wake the scheduler.
    const recovered = deliveries.slice(originalCount);
    expect(recovered).toHaveLength(1);
    expect(recovered[0].event.data.occurrenceId).toBe(b);
    expect(recovered[0].id).not.toBe(b);
    expect((await ack(id, [recovered[0].id])).structuredContent.notAcknowledged).toEqual([recovered[0].id]);
    expect((await ack(id, [b])).structuredContent.acknowledged).toEqual([b]);
    expect((await replay(id, [a, b, c])).structuredContent.queued).toEqual([]);
    expect((await f.db.pool.query("SELECT 1 FROM app.event_occurrences WHERE tenant_id=$1", [f.tenantId])).rowCount).toBe(4);
  });

  it("retains pending deliveries, processing ACK and cooldown across an installation reconnect", async () => {
    const anchor = auth.oauthGrantId!;
    const id = (await subscribe()).message.result.id;
    await configure(id, true);
    const completed = (await fire("installation-completed")).occurrenceId;
    const awaiting = (await fire("installation-awaiting")).occurrenceId;
    await dispatchMcpEvents(f.env);
    const cooldown = (await ack(id, [completed], 90)).structuredContent.cooldownUntil;
    expect(cooldown).toEqual(expect.any(String));
    const pending = (await fire("installation-pending")).occurrenceId;
    const snapshot = async () => (await f.db.pool.query(`SELECT id,generation,ack_epoch,cooldown_until,expires_at
      FROM app.mcp_event_subscriptions WHERE tenant_id=$1 AND id=$2`, [f.tenantId, id])).rows[0];
    const before = await snapshot();

    const next = { ...auth, oauthInstallationId: anchor, oauthGrantId: "installation-credential-2" };
    const onlySelected = next.scopes.filter(scope => scope !== "triggers:read");
    await f.db.pool.query(`INSERT INTO app.oauth_installations
      (tenant_id,user_id,id,client_id,redirect_uri,active_grant_id,active_session_version,active_scopes,selected_scopes)
      VALUES($1,$2,$3,$4,'https://client.example.test/callback',$5,$6,$7,$8)`,
    [f.tenantId, auth.userId, anchor, auth.oauthClientId, next.oauthGrantId, next.sessionVersion, next.scopes, onlySelected]);
    // Retiring the old credential is not revocation of the installation.
    await f.db.pool.query(`INSERT INTO app.agent_identities (tenant_id,kind,subject,user_id,session_version,revoked_at)
      VALUES($1,'oauth',$2,$3,$4,now())`, [f.tenantId, anchor, auth.userId, auth.sessionVersion]);
    auth = next; // The provider fixture now returns the replacement credential only.
    await pruneRevokedMcpSubscriptions(f.db);
    expect(await dispatchMcpEvents(f.env)).toBe(0);
    expect(await snapshot()).toEqual(before);
    expect((await f.db.pool.query(`SELECT status,ack_state,recovery_attempts FROM app.mcp_event_deliveries
      WHERE tenant_id=$1 AND subscription_id=$2 AND occurrence_id=$3`, [f.tenantId, id, awaiting])).rows)
      .toEqual([{ status: "accepted", ack_state: "awaiting_ack", recovery_attempts: 0 }]);
    expect(await outbox()).toEqual(expect.arrayContaining([
      expect.objectContaining({ occurrence_id: pending, status: "pending", attempts: 0 }),
    ]));

    await f.db.pool.query("UPDATE app.oauth_installations SET selected_scopes=active_scopes WHERE tenant_id=$1 AND id=$2", [f.tenantId, anchor]);
    const updated = await processing("get_event_processing_acknowledgments", id);
    expect(updated.structuredContent).toMatchObject({ enabled: true, cooldownUntil: cooldown });
    expect((await ack(id, [awaiting])).structuredContent.acknowledged).toEqual([awaiting]);
    expect(await snapshot()).toEqual(before);
    const renewed = await request("events/subscribe", {
      name, arguments: {}, delivery: { mode: "webhook", url: receiver, secret: secret(key) }, cursor: null,
    }, next);
    expect(renewed.message.result.id).toBe(id);
    expect(await snapshot()).toMatchObject({ generation: before.generation, ack_epoch: before.ack_epoch, cooldown_until: before.cooldown_until });
    await f.db.pool.query("UPDATE app.mcp_event_subscriptions SET cooldown_until=now()-interval '1 second' WHERE tenant_id=$1 AND id=$2", [f.tenantId, id]);
    await dispatchMcpEvents(f.env);
    expect(deliveries.find(delivery => delivery.id === pending)).toMatchObject({ subscriptionId: id });
  });

  it("serializes acknowledgments and policy disable with in-flight HTTP, and fences old generations", async () => {
    const id = (await subscribe()).message.result.id;
    await configure(id, true);
    const second = (await subscribe(otherReceiver)).message.result.id;
    await configure(second, true);
    const event = (await fire("ack-race")).occurrenceId;
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    holdDelivery = () => { entered(); return new Promise<void>(resolve => { release = resolve; }); };
    // Only the intended subscription is due; the other's copy cannot be acknowledged.
    await f.db.pool.query("UPDATE app.mcp_event_deliveries SET next_attempt_at=now()+interval '1 hour' WHERE subscription_id=$1", [second]);
    const send = dispatchMcpEvents(f.env);
    await started;
    expect((await ack(second, [event])).structuredContent.notAcknowledged).toEqual([event]);
    const racingAck = ack(id, [event], 40);
    release();
    await send;
    expect((await racingAck).structuredContent.acknowledged).toEqual([event]);

    const waived = (await fire("waive-race")).occurrenceId;
    await f.db.pool.query("UPDATE app.mcp_event_deliveries SET next_attempt_at=now()+interval '1 hour' WHERE subscription_id=$1", [second]);
    await f.db.pool.query("UPDATE app.mcp_event_subscriptions SET cooldown_until=NULL WHERE id=$1", [id]);
    const startedAgain = new Promise<void>(resolve => { entered = resolve; });
    const sendAgain = dispatchMcpEvents(f.env);
    await startedAgain;
    const turningOff = configure(id, false);
    release();
    await sendAgain;
    expect((await turningOff).structuredContent).toMatchObject({ enabled: false, cooldownUntil: null });
    holdDelivery = undefined;
    expect(await inspectProcessing(waived)).toMatchObject({ status: "accepted", processing: { state: "waived", nextRecoveryAt: null } });
    expect(await inspectProcessing(event)).toMatchObject({ status: "accepted", processing: { state: "processed" } });
    await configure(id, true);
    expect((await ack(id, [waived])).structuredContent.notAcknowledged).toEqual([waived]);
    expect((await replay(id, [waived])).structuredContent.queued).toEqual([]);
    await unsubscribe();
    expect((await ack(id, [event])).isError).toBe(true);
    expect((await subscribe()).message.result.id).toBe(id);
    await configure(id, true);
    expect((await ack(id, [event])).structuredContent.notAcknowledged).toEqual([event]);
    expect((await processing("get_event_processing_acknowledgments", id, {}, { ...auth, oauthGrantId: "other-grant" })).isError).toBe(true);
  });

  it("off clears a claimed but unstarted recovery and does not opt in old occurrences again", async () => {
    const id = (await subscribe()).message.result.id;
    await configure(id, true);
    const occurrence = (await fire("unstarted-recovery")).occurrenceId;
    await dispatchMcpEvents(f.env);
    await f.db.pool.query(`UPDATE app.mcp_event_deliveries SET claim_id=gen_random_uuid(),recovery_event_id=gen_random_uuid()
      WHERE occurrence_id=$1`, [occurrence]);
    await f.db.pool.query("UPDATE app.mcp_event_subscriptions SET cooldown_until=now()+interval '1 hour' WHERE id=$1", [id]);
    expect((await configure(id, false)).structuredContent.cooldownUntil).toBeNull();
    expect((await f.db.pool.query("SELECT claim_id,recovery_event_id FROM app.mcp_event_deliveries WHERE occurrence_id=$1", [occurrence])).rows)
      .toEqual([{ claim_id: null, recovery_event_id: null }]);
    await configure(id, true);
    await makeRecoveryDue(occurrence);
    expect(await dispatchMcpEvents(f.env)).toBe(0);
    expect(deliveries).toHaveLength(1);
    expect(await inspectProcessing(occurrence)).toMatchObject({ status: "accepted", processing: { state: "waived" } });
  });

  it("recovers a persisted interrupted claim and caps automatic recovery attempts", async () => {
    const id = (await subscribe()).message.result.id;
    await configure(id, true);
    const occurrence = (await fire("bounded-recovery")).occurrenceId;
    await dispatchMcpEvents(f.env);
    const interrupted = crypto.randomUUID();
    await f.db.pool.query("UPDATE app.mcp_event_deliveries SET claim_id=gen_random_uuid(),recovery_event_id=$2,recovery_attempts=1 WHERE occurrence_id=$1",
      [occurrence, interrupted]);
    await makeRecoveryDue(occurrence);
    await dispatchMcpEvents(f.env);
    expect(deliveries.at(-1)).toMatchObject({ id: interrupted, event: { data: { occurrenceId: occurrence } } });
    for (let i = 0; i < 3; i++) {
      await makeRecoveryDue(occurrence);
      await dispatchMcpEvents(f.env);
    }
    expect(deliveries).toHaveLength(4); // Initial delivery and three recoveries; the interrupted claim also counts.
    expect(new Set(deliveries.map(d => d.id)).size).toBe(4);
    expect(await inspectProcessing(occurrence)).toMatchObject({ status: "accepted", processing: { state: "exhausted", recoveryAttempts: 4 } });
    expect((await replay(id, [occurrence])).structuredContent.queued).toEqual([occurrence]);
    expect((await replay(id, [occurrence])).structuredContent.queued).toEqual([]);
    await dispatchMcpEvents(f.env);
    expect(deliveries.at(-1)?.event.data.occurrenceId).toBe(occurrence);
    expect(deliveries).toHaveLength(5);
  });

  it("discovers one stable type and fans out only matching occurrences without breaking legacy subscriptions", async () => {
    const catalog = (await request("events/list")).message.result;
    expect(catalog.events).toEqual([{
        name: "factorize.occurrence", title: "Factorize occurrence", description: expect.any(String),
        delivery: ["webhook"],
        inputSchema: {
          type: "object", properties: { event_id: { type: "string", format: "uuid", description: expect.any(String) } },
          required: ["event_id"], additionalProperties: false,
        },
        payloadSchema: {
          type: "object", additionalProperties: false, required: ["occurrenceId", "definitionId"],
          properties: { occurrenceId: { type: "string", format: "uuid" }, definitionId: { type: "string", format: "uuid" } },
        },
    }]);
    expect(catalog.nextCursor).toBeUndefined();
    const legacy = (await subscribe()).message.result;
    const subscribeTo = (definitionId: string, url = receiver) => request("events/subscribe", {
      name: catalog.events[0].name, arguments: { event_id: definitionId },
      delivery: { mode: "webhook", url, secret: secret(signingKey) },
    });
    const triggerFor = async (eventName: string) => {
      const event = (await tool("create_event", { name: eventName })).structuredContent;
      const trigger = (await tool("create_trigger", {
        name: eventName, eventId: event.id, sources: [{ kind: "manual", config: {} }],
      })).structuredContent;
      return { eventId: event.id, triggerId: trigger.id };
    };
    const first = await triggerFor("dynamic-alpha");
    const second = await triggerFor("dynamic-beta");
    expect((await request("events/list")).message.result.events).toEqual(catalog.events);
    const alpha = (await subscribeTo(first.eventId)).message.result;
    const duplicate = (await subscribeTo(first.eventId.toUpperCase())).message.result;
    expect(duplicate.id).toBe(alpha.id);
    const alphaFanout = (await subscribeTo(first.eventId, otherReceiver)).message.result;
    const beta = (await subscribeTo(second.eventId)).message.result;
    const companion = (await subscribeTo(source.definitionId)).message.result;
    expect(new Set([alpha.id, alphaFanout.id, beta.id, companion.id, legacy.id]).size).toBe(5);
    const otherTenant = await f.seedEventTrigger(f.otherTenant);
    expect((await subscribeTo(otherTenant.definitionId)).message.error.code).toBe(-32023);
    expect((await subscribeTo("not-a-uuid")).message.error).toBeDefined();

    const fireAt = async (triggerId: string, idempotencyKey: string) =>
      (await tool("fire_trigger", { triggerId, idempotencyKey })).structuredContent.occurrenceId;
    const alphaOccurrence = await fireAt(first.triggerId, "alpha");
    const betaOccurrence = await fireAt(second.triggerId, "beta");
    const legacyOccurrence = (await fire("legacy-and-stable")).occurrenceId;
    await dispatchMcpEvents(f.env);
    const observed = (id: string) => deliveries.filter(d => d.id === id)
      .map(d => [d.subscriptionId, d.event.name, d.event.data.definitionId]).sort();
    expect(observed(alphaOccurrence)).toEqual([
      [alpha.id, "factorize.occurrence", first.eventId],
      [alphaFanout.id, "factorize.occurrence", first.eventId],
    ].sort());
    expect(observed(betaOccurrence)).toEqual([[beta.id, "factorize.occurrence", second.eventId]]);
    expect(observed(legacyOccurrence)).toEqual([
      [legacy.id, name, source.definitionId],
      [companion.id, "factorize.occurrence", source.definitionId],
    ].sort());

    expect((await subscribe()).message.result.id).toBe(legacy.id);
    expect((await unsubscribe()).message.result).toBeDefined();
    const stopAlpha = { name: catalog.events[0].name, arguments: { event_id: first.eventId.toUpperCase() }, delivery: { url: receiver } };
    expect((await request("events/unsubscribe", stopAlpha)).message.result).toBeDefined();
    expect((await request("events/unsubscribe", stopAlpha)).message.result).toBeDefined();
    const remainingAlpha = await fireAt(first.triggerId, "alpha-again");
    const remainingLegacy = (await fire("after-legacy-stop")).occurrenceId;
    await dispatchMcpEvents(f.env);
    expect(observed(remainingAlpha)).toEqual([[alphaFanout.id, "factorize.occurrence", first.eventId]]);
    expect(observed(remainingLegacy)).toEqual([[companion.id, "factorize.occurrence", source.definitionId]]);
  });

  it("discovers, subscribes, commits, dispatches and reads a deduplicated occurrence", async () => {
    expect((await request("server/discover")).message.result.capabilities).toMatchObject({ events: {}, resources: { subscribe: true } });
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
    expect(await outbox()).toEqual(expect.arrayContaining([
      ...[stopped, expired].map(event => ({ occurrence_id: event.occurrenceId, status: "cancelled", attempts: 0, http_status: null })),
      ...[narrowed, revoked].map(event => ({ occurrence_id: event.occurrenceId, status: "pending", attempts: 0, http_status: null })),
    ]));
    await new IdentityRepository(f.db, f.otherTenant).upsertOwner(f.userId, "owner@example.test");
    const other = { ...f.auth, tenantId: f.otherTenant };
    expect((await read({ occurrenceId: rotated.occurrenceId }, other)).isError).toBe(true);
    expect((await request("tools/call", { name: "read_event_occurrences", arguments: { occurrenceId: rotated.occurrenceId } }, { ...auth, scopes: [] })).status).toBe(403);
  });


  it("deletes only subscriptions on the exact grant revoked through owner settings", async () => {
    const otherGrant = { ...auth, oauthGrantId: "grant-same-client" };
    const grants = [auth, otherGrant];
    f.env.OAUTH_PROVIDER!.listUserGrants = async () => ({ items: grants.map(g => ({
      id: g.oauthGrantId!, clientId: g.oauthClientId!, createdAt: 1_700_000_000, metadata: { tenantId: f.tenantId }, scope: g.scopes,
    })) }) as any;
    f.env.OAUTH_PROVIDER!.revokeGrant = async (id, userId) => {
      expect([id,userId]).toEqual([auth.oauthGrantId,f.userId]);
      // A stale provider listing must not allow the explicit revoke to be undone.
    };
    const active = (await subscribe()).message.result.id;
    const stopped = (await subscribe(otherReceiver)).message.result.id;
    const occurrence = await fire("before-revocation");
    await request("events/unsubscribe", { name, arguments: {}, delivery: { url: otherReceiver } });
    const other = (await request("events/subscribe", { name, arguments: {}, delivery: {
      mode: "webhook", url: receiver, secret: secret(key),
    } }, otherGrant)).message.result.id;
    const unaffected = await fire("before-revocation-same-client");
    const foreign = await f.seedEventTrigger(f.otherTenant);
    await f.db.pool.query(`INSERT INTO app.mcp_event_subscriptions
      (tenant_id,id,user_id,session_version,grant_id,client_id,definition_id,arguments,callback_url,
       encrypted_secret,secret_fingerprint,verified_at,generation,status,expires_at)
      SELECT $1,id,user_id,session_version,grant_id,client_id,$2,arguments,callback_url,
       encrypted_secret,secret_fingerprint,verified_at,generation,status,expires_at
      FROM app.mcp_event_subscriptions WHERE tenant_id=$3 AND id=$4`,
    [f.otherTenant, foreign.definitionId, f.tenantId, active]);
    const revoke = await worker.fetch(new Request(
      `${f.env.APP_ORIGIN}/api/v1/access/authorizations/${auth.oauthGrantId}`,
      { method: "DELETE", headers: { Cookie: f.cookie, Origin: f.env.APP_ORIGIN } },
    ), f.env, {} as ExecutionContext);
    expect(revoke.status).toBe(200);
    expect(await revoke.json()).toEqual({ revoked: 1 });
    expect((await f.db.pool.query("SELECT id FROM app.mcp_event_subscriptions WHERE tenant_id=$1", [f.tenantId])).rows).toEqual([{ id: other }]);
    expect((await f.db.pool.query("SELECT id FROM app.mcp_event_subscriptions WHERE tenant_id=$1", [f.otherTenant])).rows).toEqual([{ id: active }]);
    expect((await f.db.pool.query("SELECT subscription_id,occurrence_id FROM app.mcp_event_deliveries")).rows)
      .toEqual([{ subscription_id: other, occurrence_id: unaffected.occurrenceId }]);
    expect((await subscribe()).message.result?.id).toBeUndefined();
    await dispatchMcpEvents(f.env);
    expect(deliveries.map(event => event.subscriptionId)).toEqual([other]);
    expect([active, stopped]).not.toContain(other);
    expect((await f.request(`/api/v1/events/${source.definitionId}`)).status).toBe(200);
    const history = await (await f.request(`/api/v1/events/${source.definitionId}/occurrences`)).json() as { items: Array<{ id: string }> };
    expect(history.items.map(item => item.id)).toEqual(expect.arrayContaining([occurrence.occurrenceId,unaffected.occurrenceId]));
  });

  it("reconciles historical tombstones but preserves unconfirmed subscriptions during provider failures", async () => {
    const retired = { ...auth, oauthGrantId: "grant-tombstoned" };
    const list = vi.fn(async () => ({ items: [auth, retired].map(g => ({
      id: g.oauthGrantId!, clientId: g.oauthClientId!, createdAt: 1_700_000_000, metadata: { tenantId: f.tenantId }, scope: g.scopes,
    })) }));
    f.env.OAUTH_PROVIDER!.listUserGrants = list as any;
    const stopped = (await subscribe()).message.result.id;
    await unsubscribe();
    const stillActive = (await subscribe(otherReceiver)).message.result.id;
    const legacy = (await request("events/subscribe", { name, arguments: {}, delivery: {
      mode: "webhook", url: receiver, secret: secret(key),
    } }, retired)).message.result.id;
    await fire("before-reconciliation");
    await f.db.pool.query(`INSERT INTO app.agent_identities(tenant_id,kind,subject,user_id,session_version,revoked_at)
      VALUES($1,'oauth',$2,$3,$4,now())`, [f.tenantId,retired.oauthGrantId,f.userId,auth.sessionVersion]);
    await f.db.pool.query("UPDATE app.mcp_event_subscriptions SET status='stopped' WHERE tenant_id=$1 AND id=$2", [f.tenantId,legacy]);
    // A completed-but-empty provider listing and a delivery diagnostic are not deletion proof.
    list.mockResolvedValue({items: []});
    await dispatchMcpEvents(f.env);
    list.mockRejectedValue(new Error("transient provider timeout"));
    const calls = list.mock.calls.length;
    for (let i = 0; i < 2; i++) await worker.scheduled({} as ScheduledController, f.env);
    expect(list).toHaveBeenCalledTimes(calls);
    expect((await f.db.pool.query("SELECT id,status FROM app.mcp_event_subscriptions ORDER BY status")).rows)
      .toEqual([{id:stillActive,status:"active"},{id:stopped,status:"stopped"}]);
    expect((await f.db.pool.query("SELECT 1 FROM app.mcp_event_deliveries WHERE subscription_id=$1", [legacy])).rowCount).toBe(0);
    expect((await f.db.pool.query("SELECT 1 FROM app.event_occurrences WHERE tenant_id=$1", [f.tenantId])).rowCount).toBe(1);
    expect((await f.db.pool.query("SELECT 1 FROM app.agent_identities WHERE tenant_id=$1 AND subject=$2 AND revoked_at IS NOT NULL", [f.tenantId,retired.oauthGrantId])).rowCount).toBe(1);
  });

  it("rejects failed verification, forbidden destinations, unauthorized calls and cross-tenant names", async () => {
    const input = { name, delivery: { mode: "webhook", url: receiver, secret: secret(key) } };
    for (const [method, params] of [["events/list", {}], ["events/subscribe", input]] as const) {
      const denied = await request(method, params, { ...auth, scopes: [] });
      expect(denied.status).toBe(403);
      expect(denied.message.error.code).toBe("insufficient_scope");
    }
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
