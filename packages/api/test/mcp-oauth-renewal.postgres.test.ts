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
    await f.db.pool.query(`INSERT INTO app.agent_identities(tenant_id,kind,subject,user_id,session_version,revoked_at)
      VALUES($1,'oauth',$2,$3,$4,now())`, [f.tenantId, grant.grantId, f.userId, f.auth.sessionVersion]);
    const beforeProviderCleanup = await h.refresh(token.refresh_token);
    expect(beforeProviderCleanup.status).toBe(400);
    expect(await beforeProviderCleanup.json()).toMatchObject({ error: "invalid_grant" });
    expect((await h.rpc(token.access_token, "tools/list", {})).status).toBe(401);
    const revoked = await h.request(`/api/v1/access/authorizations/${grant.grantId}`, "DELETE", undefined, { Cookie: f.cookie, Origin: f.env.APP_ORIGIN });
    expect(revoked.status).toBe(200);
    expect((await h.rpc(token.access_token, "tools/list", {})).status).toBe(401);
    const refresh = await h.refresh(token.refresh_token);
    expect(refresh.status).toBe(400);
    expect(await refresh.json()).toMatchObject({ error: "invalid_grant" });
    expect((await f.db.pool.query("SELECT revoked_at FROM app.agent_identities WHERE subject=$1", [grant.grantId])).rows[0].revoked_at).toBeInstanceOf(Date);
  } finally {
    await f.cleanup();
  }
});

async function harness(f: Awaited<ReturnType<typeof loadingFixture>>) {
  delete f.env.OAUTH_PROVIDER;
  const records = new Map<string, { value: string; metadata: unknown }>();
  f.env.OAUTH_KV = {
    async get(key: string, format: { type?: string } | string) {
      const item = records.get(key);
      return item ? (typeof format === "string" ? format : format?.type) === "json" ? JSON.parse(item.value) : item.value : null;
    },
    async put(key: string, value: string, options?: { metadata?: unknown }) { records.set(key, { value, metadata: options?.metadata }); },
    async delete(key: string) { records.delete(key); },
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
  const authorize = async () => {
    const verifier = randomBytes(32).toString("base64url");
    const redirect_uri = "http://127.0.0.1/callback", scopes = ["team:read", "triggers:read"];
    const authorizationQuery = new URLSearchParams({ response_type: "code", client_id, redirect_uri, resource: origin + "/mcp", scope: scopes.join(" "),
      state: "fixture", code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" }).toString();
    const owner = { Cookie: f.cookie, Origin: origin };
    const preview = await json("/api/v1/oauth/consent/preview", { authorizationQuery }, owner);
    expect(preview.status, await preview.clone().text()).toBe(200);
    const { request, signature } = await preview.json() as {request:string; signature:string};
    const consent = await json("/api/v1/oauth/consent/decision", { request, signature, decision: "allow", scopes }, owner);
    expect(consent.status, await consent.clone().text()).toBe(200);
    const { redirectTo } = await consent.json() as {redirectTo:string};
    const exchanged = await tokenRequest({ grant_type: "authorization_code", code: new URL(redirectTo).searchParams.get("code")!, redirect_uri, code_verifier: verifier });
    expect(exchanged.status, await exchanged.clone().text()).toBe(200);
    return exchanged.json() as Promise<{ access_token: string; refresh_token: string; expires_in: number }>;
  };
  const rpc = (access: string, method: string, params: Record<string, unknown>) => json("/mcp",
    { jsonrpc: "2.0", id: 1, method, params: { ...params, _meta: {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": { name: "fixture", version: "1" },
      "io.modelcontextprotocol/clientCapabilities": {},
    } } }, { ...credentials(access), Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": method,
      ...(typeof params.name === "string" && method === "tools/call" ? { "Mcp-Name": params.name } : {}) });
  const refresh = (refresh_token: string, scope?: string) => tokenRequest({ grant_type: "refresh_token", refresh_token, ...(scope ? { scope } : {}) });
  return { authorize, rpc, refresh, request };
}
