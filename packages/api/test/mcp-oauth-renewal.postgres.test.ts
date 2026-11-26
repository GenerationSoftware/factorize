import { expect, it, vi } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import worker from "../src/worker";
import { loadingFixture } from "./helpers/loading-fixture";

vi.mock("cloudflare:workers", () => ({
  WorkerEntrypoint: class { constructor(readonly ctx: unknown, readonly env: unknown) {} },
  DurableObject: class {},
}));

const database = process.env.AUTH_TEST_DATABASE_URL;
const credentials = (token: string) => ({ Authorization: "Bearer " + token });
const payload = async (response: Response) => {
  const body = await response.text();
  return JSON.parse(response.headers.get("Content-Type")?.includes("text/event-stream")
    ? body.split("\n").find(line => line.startsWith("data: "))!.slice(6) : body);
};

it.skipIf(!database)("challenges an expired bearer, refreshes the existing grant, and renews its MCP subscription", async () => {
  const f = await loadingFixture(database!);
  try {
    const h = await harness(f);
    const token = await h.authorize();
    const source = await f.seedEventTrigger();
    const subscription = { name: "factorize.occurrence", arguments: { event_id: source.definitionId },
      delivery: { url: "https://receiver.example.com/notify", mode: "webhook", secret: "whsec_" + randomBytes(32).toString("base64") } };
    const consumed = vi.fn(async (_url: string, init: RequestInit) => {
      const { challenge } = JSON.parse(String(init.body));
      return Response.json({ challenge });
    });
    vi.stubGlobal("fetch", consumed);
    const subscribe = (access: string, ttlMs: number) => h.rpc(access, "events/subscribe", { ...subscription, ttlMs });
    const first = await subscribe(token.access_token, 300_000);
    expect(first.status, await first.clone().text()).toBe(200);
    const initialSubscription = await payload(first);
    const result = initialSubscription.result;
    expect(result, JSON.stringify(initialSubscription)).toBeTruthy();
    const oldRow = (await f.db.pool.query("SELECT id,grant_id,expires_at FROM app.mcp_event_subscriptions")).rows[0];
    expect(oldRow?.id).toBeTruthy();

    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + (token.expires_in + 2) * 1000);
    const expired = await h.rpc(token.access_token, "tools/call", { name: "list_triggers", arguments: {} });
    expect(expired.status).toBe(401);
    expect(expired.headers.get("WWW-Authenticate")).toBe(`Bearer error="invalid_token", resource_metadata="${f.env.APP_ORIGIN}/.well-known/oauth-protected-resource/mcp"`);
    const refresh = await h.refresh(token.refresh_token);
    expect(refresh.status, await refresh.clone().text()).toBe(200);
    const renewed = await refresh.json() as {access_token: string; refresh_token: string};
    const list = await h.rpc(renewed.access_token, "tools/call", { name: "list_triggers", arguments: {} });
    expect(list.status).toBe(200);
    expect((await payload(list)).result.structuredContent.items).toHaveLength(1);
    const next = await subscribe(renewed.access_token, 600_000);
    expect(next.status, await next.clone().text()).toBe(200);
    expect((await payload(next)).result).toBeTruthy();
    const rows = (await f.db.pool.query("SELECT id,grant_id,expires_at FROM app.mcp_event_subscriptions")).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(oldRow.id);
    expect(rows[0].grant_id).toBe(oldRow.grant_id);
    expect(rows[0].expires_at.getTime()).toBeGreaterThan(oldRow.expires_at.getTime());
    expect(consumed).toHaveBeenCalledTimes(1);
    clock.mockRestore();

    const narrow = await h.refresh(renewed.refresh_token, "team:read");
    expect(narrow.status).toBe(200);
    const restricted = await narrow.json() as { access_token: string; refresh_token: string };
    const forbidden = await h.rpc(restricted.access_token, "tools/call", { name: "list_triggers", arguments: {} });
    expect(forbidden.status).toBe(403);
    expect(forbidden.headers.get("WWW-Authenticate")).toContain('error="insufficient_scope", scope="triggers:read"');
    expect((await h.rpc(restricted.access_token, "tools/list", {})).status).toBe(200);
    const badBusinessOperation = await h.rpc(renewed.access_token, "tools/call", { name: "get_event", arguments: { eventId: crypto.randomUUID() } });
    expect(badBusinessOperation.status).toBe(200);
    expect((await payload(badBusinessOperation)).result.isError).toBe(true);

    await f.db.pool.query("UPDATE app.members SET session_version=session_version+1 WHERE tenant_id=$1 AND user_id=$2", [f.tenantId, f.userId]);
    expect((await h.rpc(renewed.access_token, "tools/list", {})).status).toBe(401);
    const inactive = await h.refresh(restricted.refresh_token);
    expect(inactive.status).toBe(400);
    expect(await inactive.json()).toMatchObject({ error: "invalid_grant" });
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await f.cleanup();
  }
});

it.skipIf(!database)("keeps a revoked authorization rejected by the resource and token endpoints", async () => {
  const f = await loadingFixture(database!);
  try {
    const h = await harness(f);
    const token = await h.authorize();
    const listing = await h.request("/api/v1/access/authorized-clients", "GET", undefined, { Cookie: f.cookie });
    const [grant] = await listing.json() as {grantId: string}[];
    h.failProviderCleanup();
    const revoked = await h.request(`/api/v1/access/authorizations/${grant.grantId}`, "DELETE", undefined, { Cookie: f.cookie, Origin: f.env.APP_ORIGIN });
    expect(revoked.status).toBe(200);
    expect((await h.rpc(token.access_token, "tools/list", {})).status).toBe(401);
    const refresh = await h.refresh(token.refresh_token);
    expect(refresh.status).toBe(400);
    expect(await refresh.json()).toMatchObject({ error: "invalid_grant" });
    expect((await f.db.pool.query("SELECT revoked_at FROM app.oauth_installations WHERE id=$1", [grant.grantId])).rows[0].revoked_at).toBeInstanceOf(Date);
  } finally {
    await f.cleanup();
  }
});

it.skipIf(!database)("keeps the selected connection through successful OAuth reauthorization without coalescing another installation", async () => {
  const f = await loadingFixture(database!);
  try {
    const h = await harness(f);
    const first = await h.authorize();
    const list = async () => (await h.request("/api/v1/access/authorized-clients", "GET", undefined, { Cookie: f.cookie })).json() as Promise<{
      grantId: string; revision: number; scopes: string[]; credentialScopes: string[]; pendingScopes: string[];
    }[]>;
    const [connection] = await list();
    const sibling = await h.authorize();
    expect(await list()).toHaveLength(2);
    const save = (scopes: string[], revision: number) => h.request(`/api/v1/access/authorizations/${connection.grantId}/permissions`,
      "PUT", JSON.stringify({scopes, expectedRevision:revision}), { Cookie:f.cookie, Origin:f.env.APP_ORIGIN, "Content-Type":"application/json" });
    const readEvents = (access: string) => h.rpc(access, "tools/call", {name:"list_events",arguments:{}});
    expect((await save(["team:read","triggers:write"],connection.revision)).status).toBe(200);
    expect((await readEvents(first.access_token)).status).toBe(403);
    expect((await readEvents(sibling.access_token)).status).toBe(200);
    const before = await h.refresh(first.refresh_token);
    expect(before.status).toBe(200);
    const prior = await before.json() as {access_token: string; refresh_token: string; scope?: string};
    expect(prior.scope?.split(" ")).not.toContain("triggers:write");
    const baseOnly = await h.stage({ target:{kind:"installation",id:connection.grantId}, scopes:["team:read"] });
    expect(baseOnly.preview.reconnect).toBe(true);
    // Issuing an authorization code has not replaced the working credential.
    expect((await h.rpc(prior.access_token,"tools/list",{})).status).toBe(200);
    const expanded = await baseOnly.exchange();
    expect(expanded.scope.split(" ")).toEqual(["team:read","triggers:write"]);
    const saved = (await list()).find(row => row.grantId === connection.grantId)!;
    expect(saved).toMatchObject({ scopes:["team:read","triggers:write"], credentialScopes:["team:read","triggers:write"], pendingScopes:[] });
    expect((await h.rpc(prior.access_token,"tools/list",{})).status).toBe(401);
    expect((await h.refresh(prior.refresh_token)).status).toBe(400);
    expect((await h.rpc(expanded.access_token,"tools/list",{})).status).toBe(200);
    const selected = await h.stage({ target:{kind:"installation",id:connection.grantId}, scopes:["team:read","triggers:write"] });
    const renewed = await selected.exchange();
    expect((await list()).find(row => row.grantId === connection.grantId)?.pendingScopes).toEqual([]);
    expect((await h.rpc(renewed.access_token,"tools/call",{name:"create_event",arguments:{name:"reconnected.fixture"}})).status).toBe(200);
    expect((await readEvents(sibling.access_token)).status).toBe(200);
    expect(await list()).toHaveLength(2);
  } finally { await f.cleanup(); }
});

async function harness(f: Awaited<ReturnType<typeof loadingFixture>>) {
  delete f.env.OAUTH_PROVIDER;
  const records = new Map<string, { value: string; metadata: unknown }>();
  let cleanupFails = false;
  f.env.OAUTH_KV = {
    async get(key: string, format: { type?: string } | string) {
      const item = records.get(key);
      return item ? (typeof format === "string" ? format : format?.type) === "json" ? JSON.parse(item.value) : item.value : null;
    },
    async put(key: string, value: string, options?: { metadata?: unknown }) { records.set(key, { value, metadata: options?.metadata }); },
    async delete(key: string) { if (cleanupFails) throw new Error("fixture storage unavailable"); records.delete(key); },
    async list({ prefix }: { prefix?: string } = {}) {
      return { list_complete: true, keys: [...records.entries()].filter(([key]) => key.startsWith(prefix ?? "")).map(([name, item]) => ({ name, metadata: item.metadata })) };
    },
  } as unknown as KVNamespace;
  const origin = f.env.APP_ORIGIN;
  const request = (path: string, method: string, body?: string, headers?: HeadersInit) => {
    const requestHeaders = new Headers(headers);
    requestHeaders.set("Host", new URL(origin).host);
    return worker.fetch(new Request(origin + path, { method, headers: requestHeaders, body }), f.env, { waitUntil() {} } as unknown as ExecutionContext);
  };
  const json = (path: string, data: unknown, headers = {}) => request(path, "POST", JSON.stringify(data), { "Content-Type": "application/json", ...headers });
  const registration = await json("/oauth/register", { client_name: "Renewal fixture", redirect_uris: ["http://127.0.0.1/callback"],
    token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] });
  expect(registration.status, await registration.clone().text()).toBe(201);
  const { client_id } = await registration.json() as {client_id: string};
  const tokenRequest = (params: Record<string, string>) => request("/oauth/token", "POST",
    new URLSearchParams({ client_id, resource: origin + "/mcp", ...params }).toString(), { "Content-Type": "application/x-www-form-urlencoded" });
  const stage = async (input: {target?: {kind: "installation"; id: string}; scopes?: string[]} = {}) => {
    const verifier = randomBytes(32).toString("base64url");
    const redirect_uri = "http://127.0.0.1/callback", scopes = input.scopes ?? ["team:read", "triggers:read"];
    const authorizationQuery = new URLSearchParams({ response_type: "code", client_id, redirect_uri, resource: origin + "/mcp", scope: scopes.join(" "),
      state: "fixture", code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" }).toString();
    const owner = { Cookie: f.cookie, Origin: origin };
    let query = authorizationQuery;
    if (input.target) {
      const started = await request("/authorize?"+authorizationQuery, "GET", undefined, owner);
      expect(started.status).toBe(302);
      query = new URL(started.headers.get("Location")!).search.slice(1);
      owner.Cookie += "; " + started.headers.get("Set-Cookie")!.split(";")[0];
    }
    const preview = await json("/api/v1/oauth/consent/preview", { authorizationQuery: query, target: input.target }, owner);
    expect(preview.status, await preview.clone().text()).toBe(200);
    const data = await preview.json() as {request:string; signature:string; reconnect:boolean; selectedScopes:string[]};
    const { request: signedRequest, signature } = data;
    const consent = await json("/api/v1/oauth/consent/decision", { request: signedRequest, signature, decision: "allow", scopes: input.target ? data.selectedScopes : scopes }, owner);
    expect(consent.status, await consent.clone().text()).toBe(200);
    const { redirectTo } = await consent.json() as {redirectTo:string};
    return { preview: data, exchange: async () => {
      const exchanged = await tokenRequest({ grant_type: "authorization_code", code: new URL(redirectTo).searchParams.get("code")!, redirect_uri, code_verifier: verifier });
      expect(exchanged.status, await exchanged.clone().text()).toBe(200);
      return exchanged.json() as Promise<{ access_token: string; refresh_token: string; expires_in: number; scope: string }>;
    } };
  };
  const rpc = (access: string, method: string, params: Record<string, unknown>) => json("/mcp",
    { jsonrpc: "2.0", id: 1, method, params: { ...params, _meta: {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": { name: "fixture", version: "1" },
      "io.modelcontextprotocol/clientCapabilities": {},
    } } }, { ...credentials(access), Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": method,
      ...(typeof params.name === "string" && method === "tools/call" ? { "Mcp-Name": params.name } : {}) });
  const refresh = (refresh_token: string, scope?: string) => tokenRequest({ grant_type: "refresh_token", refresh_token, ...(scope ? { scope } : {}) });
  return { authorize: async () => (await stage()).exchange(), stage, rpc, refresh, request, failProviderCleanup: () => { cleanupFails = true; } };
}
