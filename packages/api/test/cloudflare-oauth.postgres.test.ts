import { expect, it, vi } from "vitest";
import { cloudflareSettings, cloudflareTarget } from "../src/cloudflare-oauth";
import worker from "../src/worker";
import { decrypt } from "../src/crypto";
import type { Env } from "../src/types";
import { loadingFixture } from "./helpers/loading-fixture";
import { mcpRequest } from "./helpers/mcp-request";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {}, WorkflowEntrypoint: class {}, DurableObject: class {} }));
vi.mock("@cloudflare/workers-oauth-provider", () => ({ OAuthProvider: class {}, AuthorizationError: class extends Error {}, getOAuthApi: vi.fn() }));

const database = process.env.AUTH_TEST_DATABASE_URL;
const primary = "a".repeat(32), secondary = "b".repeat(32);
const zone = "c".repeat(32), foreignZone = "d".repeat(32);
const url = "/api/v1/integrations/cloudflare";
const headers = (owner: string) => ({ Cookie: owner, Origin: "https://factorize.test", "Content-Type": "application/json" });
const listScopes = ["account-settings.read", "zone.read", "dns-records.read"];
const dnsWriteScope = "dns-records.write", unusedWrite = "workers-scripts.write";
const config = { CLOUDFLARE_OAUTH_CLIENT_ID: "fixture-public-client", CLOUDFLARE_OAUTH_CLIENT_SECRET: "fixture-secret",
  CLOUDFLARE_OAUTH_READ_SCOPES: listScopes.join(" "), CLOUDFLARE_OAUTH_WRITE_SCOPES: dnsWriteScope + " " + unusedWrite };
it("accepts configured read identifiers without assuming a provider privilege literal", () => {
  expect(cloudflareSettings(config as Env)).toMatchObject({ configured: true, read: listScopes, dnsWriteScope: undefined });
  expect(cloudflareSettings({ ...config, CLOUDFLARE_OAUTH_DNS_WRITE_SCOPE: dnsWriteScope } as Env).dnsWriteScope).toBe(dnsWriteScope);
  expect(cloudflareSettings({ ...config, CLOUDFLARE_OAUTH_DNS_WRITE_SCOPE: "unregistered.write" } as Env).dnsWriteScope).toBeUndefined();
  for (const scopes of ["", "openid", "other.write", "scope?.read", "read,read"]) {
    expect(cloudflareSettings({ ...config, CLOUDFLARE_OAUTH_READ_SCOPES: scopes } as Env).configured).toBe(false);
  }
});
const secret = "fixture-confidential-client-secret", accessToken = "fixture-private-cloudflare-access", refreshToken = "fixture-private-refresh";
const envelope = (result: unknown) => Response.json({ success: true, result });

it("routes only recognized Cloudflare resources and write shapes", () => {
  expect(cloudflareTarget("/zones?page=2", "GET", primary, false).path).toBe("/client/v4/zones?page=2&account.id=" + primary);
  expect(cloudflareTarget("/accounts", "GET", primary, false).path).toBe("/client/v4/accounts/" + primary);
  expect(cloudflareTarget("/accounts/" + primary + "/workers/scripts", "GET", primary, false).path).toContain("/workers/scripts");
  for (const path of ["/accounts/" + secondary + "/r2/buckets", "/zones?account.id=" + secondary, "/user/tokens", "/accounts/" + primary + "/workers/scripts/example/settings"]) {
    expect(() => cloudflareTarget(path, "GET", primary, true)).toThrow();
  }
  expect(() => cloudflareTarget("/zones/" + zone + "/dns_records", "POST", primary, false)).toThrow();
  expect(cloudflareTarget("/zones/" + zone + "/dns_records", "POST", primary, true).zone).toBe(zone);
});

it.skipIf(!database)("connects through Cloudflare OAuth and enforces account, zone, and explicit write consent through request_api", async () => {
  const f = await loadingFixture(database!);
  try {
    Object.assign(f.env, config, { CLOUDFLARE_OAUTH_CLIENT_SECRET: secret, CLOUDFLARE_OAUTH_DNS_WRITE_SCOPE: dnsWriteScope });
    let grantWrite = false, enumerateAccounts = true;
    const refreshedAccess = "fixture-private-refreshed-access";
    const calls: { url: string; method: string; authorization: string | null }[] = [];
    const fetcher = vi.fn(async (url: URL | string, init?: RequestInit) => {
      const target = new URL(url);
      const h = new Headers(init?.headers), method = init?.method ?? "GET";
      calls.push({ url: target.href, method, authorization: h.get("Authorization") });
      expect(h.has("x-auth-key")).toBe(false);
      if (target.origin === "https://dash.cloudflare.com") {
        expect(target.pathname).toBe("/oauth2/token");
        const body = init?.body as URLSearchParams;
        expect(body.get("client_secret")).toBe(secret);
        const refreshing = body.get("grant_type") === "refresh_token";
        if (refreshing) expect(body.get("refresh_token")).toBe(refreshToken);
        else {
          expect(body.get("grant_type")).toBe("authorization_code");
          expect(body.get("code_verifier")).toHaveLength(43);
          expect(body.get("redirect_uri")).toBe(f.env.APP_ORIGIN + "/oauth/cloudflare/callback");
        }
        return Response.json({ access_token: refreshing ? refreshedAccess : accessToken,
          ...(refreshing ? {} : { refresh_token: refreshToken }), expires_in: 3600, token_type: "bearer",
          scope: [...listScopes, ...(grantWrite ? [dnsWriteScope] : []), "offline_access", unusedWrite, "unexpected.read"].join(" ") });
      }
      expect(target.origin).toBe("https://api.cloudflare.com");
      expect([accessToken, refreshedAccess].map(token => "Bearer " + token)).toContain(h.get("Authorization"));
      if (target.pathname === "/client/v4/accounts") return !enumerateAccounts ? new Response(null, { status: 403 }) : envelope([{ id: primary, name: "Primary account" }, { id: secondary, name: "Secondary account" }]);
      if (target.pathname === "/client/v4/zones") {
        expect(target.searchParams.get("account.id")).toBe(primary);
        return envelope([{ id: zone, name: "example.test", account: { id: primary } }]);
      }
      if (target.pathname === "/client/v4/zones/" + zone) return envelope({ id: zone, account: { id: primary } });
      if (target.pathname === "/client/v4/zones/" + foreignZone) return envelope({ id: foreignZone, account: { id: secondary } });
      if (target.pathname === "/client/v4/zones/" + zone + "/dns_records" && method === "POST") return envelope({ id: zone });
      throw new Error("Unexpected mock provider call");
    });
    vi.stubGlobal("fetch", fetcher);
    const api = (method: string, path: string, body?: unknown, cookie = f.cookie) =>
      worker.fetch(new Request(f.env.APP_ORIGIN + path, { method, headers: headers(cookie), body: body ? JSON.stringify(body) : undefined }), f.env, {} as ExecutionContext);
    const activate = async (writes: boolean) => {
      const start = await api("POST", url + "/authorize", { enableWrites: writes });
      expect(start.status, await start.clone().text()).toBe(200);
      const browser = start.headers.get("Set-Cookie")!.split(";")[0];
      const { authorizationUrl } = await start.json() as {authorizationUrl:string};
      const external = new URL(authorizationUrl);
      expect(external.origin).toBe("https://dash.cloudflare.com");
      expect(external.searchParams.get("scope")?.split(" "))
        .toEqual([...listScopes, ...(writes ? [dnsWriteScope] : []), "offline_access"]);
      const returned = new URL(f.env.APP_ORIGIN + "/oauth/cloudflare/callback");
      returned.search = new URLSearchParams({ code: "authorized-fixture", state: external.searchParams.get("state")! }).toString();
      const oauth = await worker.fetch(new Request(returned, { headers: { Cookie: f.cookie + "; " + browser } }), f.env, {} as ExecutionContext);
      expect(oauth.status).toBe(303);
      expect(oauth.headers.get("Location")).toBe(f.env.APP_ORIGIN + "/integrations?cloudflare=" + (enumerateAccounts ? "select" : "failed"));
      if (!enumerateAccounts) return null;
      const available = await api("GET", url, undefined, f.cookie + "; " + browser);
      const serialized = await available.text();
      for (const value of [secret, refreshToken, accessToken]) expect(serialized).not.toContain(value);
      expect(JSON.parse(serialized).accounts.map((a: {id: string}) => a.id)).toEqual([primary, secondary]);
      const saved = await api("POST", url + "/select", { accountId: primary }, f.cookie + "; " + browser);
      expect(saved.status, await saved.clone().text()).toBe(200);
      const output = await (await api("GET", url)).json() as { connections: { id:string; writeEnabled:boolean }[] };
      return output.connections[0];
    };
    // Even if an upstream token returns a write scope, a read-only Factorize
    // authorization cannot use it. Successful write requires new owner consent.
    grantWrite = true;
    enumerateAccounts = false;
    expect(await activate(false)).toBeNull();
    expect((await (await api("GET", url)).json() as {connections: unknown[]}).connections).toEqual([]);
    enumerateAccounts = true;
    const readOnly = (await activate(false))!;
    expect(readOnly.writeEnabled).toBe(false);
    const integration = async () => (await f.db.pool.query<{id:string;epoch:number}>("SELECT id,epoch FROM app.agent_integrations WHERE tenant_id=$1 AND kind='cloudflare'", [f.tenantId])).rows[0];
    const rpc = async (name: string, input: Record<string, unknown>) => {
      const row = await integration();
      const auth = { ...f.auth, authMethod: "oauth" as const, oauthGrantId: "fixture", oauthClientId: "fixture-client", oauthExpiresAt: Date.now()/1000 + 600,
        scopes: ["proxy:use", `integration:${row.id}:${row.epoch}`] };
      return mcpRequest(f.env, auth)("tools/call", { name, arguments: { ...input, ...(name === "request_api" ? { integration: row.id, execution: "sync" } : {}) } });
    };
    expect((await rpc("get_api_reflection", {})).message.result.structuredContent.integrations).toEqual([expect.objectContaining({ kind: "cloudflare", access: "granted" })]);
    expect((await rpc("request_api", { method: "GET", path: "/zones" })).message.result.structuredContent.status).toBe(200);
    const body = JSON.stringify({ type: "TXT", name: "example.test", content: "fixture-text" });
    expect((await rpc("request_api", { method: "POST", path: "/zones/" + zone + "/dns_records", body })).message.result.isError).toBe(true);
    expect((await rpc("request_api", { method: "GET", path: "/zones/" + foreignZone + "/dns_records" })).message.result.isError).toBe(true);
    expect(calls.some(c => c.url.endsWith(foreignZone + "/dns_records"))).toBe(false);
    grantWrite = false;
    expect((await activate(true))!.writeEnabled).toBe(false);
    grantWrite = true;
    const writable = (await activate(true))!;
    expect(writable.writeEnabled).toBe(true);

    // Advance the provider credential clock so the same connection refreshes.
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 3_601_000);
    const wrote = await rpc("request_api", { method: "POST", path: "/zones/" + zone + "/dns_records", body,
      headers: { "Content-Type": "application/json", "X-Auth-Key": "fixture-must-not-forward" } });
    expect(wrote.message.result.structuredContent.status).toBe(200);
    expect(calls.filter(c => c.url.endsWith("/oauth2/token"))).toHaveLength(5);
    expect(calls.at(-1)?.authorization).toBe("Bearer " + refreshedAccess);
    const saved = (await f.db.pool.query<{encrypted_credentials: string}>(
      "SELECT encrypted_credentials FROM app.cloudflare_connections WHERE id=$1", [writable.id])).rows[0];
    const persisted = JSON.parse(await decrypt(saved.encrypted_credentials, f.env.CREDENTIAL_ENCRYPTION_KEY));
    expect(persisted.scopes).toEqual([...listScopes, dnsWriteScope]);
    expect(persisted.dnsWriteScope).toBe(dnsWriteScope);
    f.env.CLOUDFLARE_OAUTH_DNS_WRITE_SCOPE = unusedWrite;
    expect((await rpc("request_api", { method: "POST", path: "/zones/" + zone + "/dns_records", body })).message.result.isError).toBe(true);
    expect((await rpc("request_api", { method: "GET", path: "/zones" })).message.result.structuredContent.status).toBe(200);
    vi.restoreAllMocks();
    expect((await api("DELETE", url + "/" + writable.id)).status).toBe(200);
    const disabled = await f.db.pool.query("SELECT encrypted_credentials FROM app.cloudflare_connections WHERE id=$1", [writable.id]);
    expect(disabled.rows[0].encrypted_credentials).toBeNull();
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await f.cleanup();
  }
});
