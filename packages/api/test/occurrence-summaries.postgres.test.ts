import { expect, it, vi } from "vitest";
import { protectedApiFetch } from "../src/protected-api";
import { loadingFixture } from "./helpers/loading-fixture";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {}, DurableObject: class {}, WorkflowEntrypoint: class {} }));
vi.mock("@cloudflare/workers-oauth-provider", () => ({ OAuthProvider: class {}, AuthorizationError: class extends Error {}, getOAuthApi: vi.fn() }));

const database = process.env.AUTH_TEST_DATABASE_URL;
const subscriptionId = (digit: string) => "sub_" + digit.repeat(64);
const occurrenceId = (number: number) => "d0000000-0000-4000-8000-" + String(number).padStart(12, "0");

it.skipIf(!database)("pages safe newest-first summaries and exposes only exact owner subscription deliveries", async () => {
  const f = await loadingFixture(database!);
  try {
    const { definitionId } = await f.seedEventTrigger();
    const foreign = await f.seedEventTrigger(f.otherTenant);
    const generation = crypto.randomUUID();
    const otherOwner = crypto.randomUUID();
    for (const [id, owner, tenant, definition] of [
      [subscriptionId("a"), f.userId, f.tenantId, definitionId],
      [subscriptionId("b"), f.userId, f.tenantId, definitionId],
      [subscriptionId("c"), otherOwner, f.tenantId, definitionId],
      [subscriptionId("d"), f.userId, f.otherTenant, foreign.definitionId],
    ]) {
      await f.db.pool.query(`INSERT INTO app.mcp_event_subscriptions
        (tenant_id,id,user_id,session_version,grant_id,client_id,definition_id,arguments,callback_url,encrypted_secret,secret_fingerprint,verified_at,generation,status,expires_at)
        VALUES ($1,$2,$3,0,'grant','client',$4,'{"private":"arguments"}','https://private.example.test','private-secret','private-fingerprint',now(),$5,'active',now()+interval '1 day')`,
      [tenant, id, owner, definition, generation]);
    }
    const older = "2026-01-02T03:04:05.000001Z", newer = "2026-01-02T03:04:05.000002Z";
    for (let n = 1; n <= 13; n++) {
      const source = n === 12 ? "linear:private-project-id" : n === 13 ? "unrecognized-private-value" : "manual:private-trigger-id";
      await f.db.pool.query(`INSERT INTO app.event_occurrences
        (tenant_id,id,definition_id,definition_revision,occurred_at,payload,producer_identity,evidence,source_identity,idempotency_key)
        VALUES ($1,$2,$3,1,$4,'{"private":"payload"}','{"private":"producer"}','[]',$5,$6)`,
      [f.tenantId, occurrenceId(n), definitionId, n < 12 ? older : newer, source, "fixture-" + n]);
    }
    for (let n = 1; n <= 12; n++) {
      const [delivery, acknowledgment] = n === 12 ? ["accepted", "awaiting_ack"] : n === 11 ? ["accepted", "processed"]
        : n === 10 ? ["pending", "pending"] : n === 9 ? ["failed", "exhausted"] : ["accepted", null];
      await f.db.pool.query(`INSERT INTO app.mcp_event_deliveries
        (tenant_id,subscription_id,occurrence_id,generation,status,ack_state,http_status,last_outcome)
        VALUES ($1,$2,$3,$4,$5,$6,202,'private-outcome')`,
      [f.tenantId, subscriptionId(n === 1 ? "b" : "a"), occurrenceId(n), generation, delivery, acknowledgment]);
    }
    const read = (path: string, auth = f.auth) => protectedApiFetch(new Request(f.env.APP_ORIGIN + path),
      f.env, auth, {} as ExecutionContext);
    const get = async (path: string) => {
      const response = await read(path);
      expect(response.status, await response.clone().text()).toBe(200);
      return await response.json() as { items: { id: string; occurredAt: string; source: string }[]; nextCursor: string | null };
    };
    const eventPath = "/api/v1/events/" + definitionId + "/occurrence-summaries";
    const subPath = "/api/v1/event-subscriptions/" + subscriptionId("a") + "/occurrences";
    const first = await get(eventPath);
    expect(first.items.map(item => item.id)).toEqual(Array.from({ length: 10 }, (_, i) => occurrenceId(13 - i)));
    expect(first.items[0]).toEqual({ id: occurrenceId(13), occurredAt: newer, source: "unknown" });
    expect(first.items[1]).toEqual({ id: occurrenceId(12), occurredAt: newer, source: "linear" });
    expect(first.items[2]).toEqual({ id: occurrenceId(11), occurredAt: older, source: "manual" });
    expect(first.nextCursor).toBeTruthy();
    const cursor = "?cursor=" + encodeURIComponent(first.nextCursor!);
    const second = await get(eventPath + cursor);
    expect(second.items.map(item => item.id)).toEqual([3, 2, 1].map(occurrenceId));
    expect(second.nextCursor).toBeNull();
    expect((await read(subPath + cursor)).status).toBe(400);
    expect((await read(eventPath + "?cursor=not-a-cursor")).status).toBe(400);
    expect((await read(eventPath + "?limit=51")).status).toBe(400);
    expect((await read("/api/v1/events/" + foreign.definitionId + "/occurrence-summaries")).status).toBe(404);

    const deliveries = await get(subPath);
    expect(deliveries.items.map(item => item.id)).toEqual(Array.from({ length: 10 }, (_, i) => occurrenceId(12 - i)));
    expect(deliveries.items.slice(0, 5)).toEqual([
      { id: occurrenceId(12), occurredAt: newer, source: "linear", delivery: "accepted", acknowledgment: "awaiting_ack" },
      { id: occurrenceId(11), occurredAt: older, source: "manual", delivery: "accepted", acknowledgment: "processed" },
      { id: occurrenceId(10), occurredAt: older, source: "manual", delivery: "pending", acknowledgment: "pending" },
      { id: occurrenceId(9), occurredAt: older, source: "manual", delivery: "failed", acknowledgment: "exhausted" },
      { id: occurrenceId(8), occurredAt: older, source: "manual", delivery: "accepted", acknowledgment: "off" },
    ]);
    const next = await get(subPath + "?cursor=" + encodeURIComponent(deliveries.nextCursor!));
    expect(next.items.map(item => item.id)).toEqual([occurrenceId(2)]);
    expect(next.nextCursor).toBeNull();
    expect((await get("/api/v1/event-subscriptions/" + subscriptionId("b") + "/occurrences")).items.map(item => item.id)).toEqual([occurrenceId(1)]);
    for (const id of [subscriptionId("c"), subscriptionId("d"), subscriptionId("e")]) {
      expect((await read("/api/v1/event-subscriptions/" + id + "/occurrences")).status).toBe(404);
    }
    expect((await read(subPath, { ...f.auth, authMethod: "oauth" })).status).toBe(403);
    expect(JSON.stringify({ first, deliveries })).not.toMatch(/private|httpStatus|callback|payload|producer|encrypted|arguments/i);
  } finally { await f.cleanup(); }
});
