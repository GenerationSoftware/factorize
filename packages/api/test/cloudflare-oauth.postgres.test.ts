import { example } from "./helpers/docs-example";
import { expect, it, vi } from "vitest";
import { cloudflarePath, cloudflareSettings } from "../src/integrations/providers/cloudflare-oauth";
import { encrypt } from "../src/crypto";
import type { Env } from "../src/types";
import worker from "../src/worker";
import { loadingFixture } from "./helpers/loading-fixture";
import { mcpRequest } from "./helpers/mcp-request";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {}, WorkflowEntrypoint: class {}, DurableObject: class {} }));
vi.mock("@cloudflare/workers-oauth-provider", () => ({ OAuthProvider: class {}, AuthorizationError: class extends Error {}, getOAuthApi: vi.fn() }));

const database = process.env.AUTH_TEST_DATABASE_URL;
const url = "/api/v1/integrations/cloudflare";
const config = { CLOUDFLARE_OAUTH_CLIENT_ID: "fixture-client", CLOUDFLARE_OAUTH_CLIENT_SECRET: "fixture-secret",
  CLOUDFLARE_OAUTH_READ_SCOPES: "account-settings.read" };

// Redacted provider scope IDs from the reported connection configuration.
const catalog = `d1.read d1.write hyperdrive-planetscale.setup query-cache.read query-cache.write page.read page.write
  workers-scripts.admin workers-ci.read workers-ci.write containers.read containers.write workers-scripts.content_read
  workers-scripts.edit workers-kv-storage.read workers-kv-storage.write workers-scripts.metadata_read
  workers-observability.read workers-observability-telemetry.write workers-observability.write r2-catalog.read
  r2-catalog.write r2-catalog-sql.read workers-r2-bucket-item.read workers-r2-bucket-item.write workers-r2.read
  workers-r2.write workers-routes.read workers-routes.write workers-tail.read websearch.read websearch.run websearch.write
  account-dns-settings.read dns.read zone-dns-settings.read zone.read zone-settings.read observability.read
  observability.write zone-observability.read zone-observability.write account-settings.read notifications.read
  notifications.write artifacts.read artifacts.write`.trim().split(/\s+/);

it("uses configured defaults and keeps request paths inside Cloudflare v4", () => {
  expect(cloudflareSettings(config as Env)).toEqual({ configured: true, scopes: ["account-settings.read", "offline_access"] });
  expect(cloudflareSettings({ ...config, CLOUDFLARE_OAUTH_DEFAULT_SCOPES: "custom-resource.one custom-resource.two offline_access" } as Env).scopes)
    .toEqual(["custom-resource.one", "custom-resource.two", "offline_access"]);
  const providerValidated = "A?provider-validated:" + "x".repeat(160);
  expect(cloudflareSettings({ ...config, CLOUDFLARE_OAUTH_DEFAULT_SCOPES: providerValidated } as Env))
    .toEqual({ configured: true, scopes: [providerValidated, "offline_access"] });
  expect(cloudflarePath("/accounts/demo/widgets?page=2")).toBe("/client/v4/accounts/demo/widgets?page=2");
  for (const path of ["//example.test", "/../../outside", "/?access_token=fixture"]) expect(() => cloudflarePath(path)).toThrow();
});

it.skipIf(!database)("redirects and saves fresh Cloudflare consent, refreshes and uses the shared proxy without upgrading legacy connections", async () => {
  const f = await loadingFixture(database!);
  const old = crypto.randomUUID();
  try {
    Object.assign(f.env, config, { CLOUDFLARE_OAUTH_DEFAULT_SCOPES: "  " + catalog.join(" \n\t") + " " + catalog[0] });
    const encrypted = await encrypt(JSON.stringify({ access: "legacy-fixture", expiration: Date.now() + 120000 }), f.env.CREDENTIAL_ENCRYPTION_KEY);
    await f.db.pool.query(`INSERT INTO app.cloudflare_connections(tenant_id,id,account_id,account_name,encrypted_credentials)
      VALUES($1,$2,'historical','Legacy account',$3)`, [f.tenantId, old, encrypted]);
    const oldPolicy = (await f.db.pool.query<{id:string; epoch:number}>(`INSERT INTO app.agent_integrations
      (tenant_id,kind,credential_id,name,available,policy) VALUES($1,'cloudflare',$2,'Legacy',true,'requestable') RETURNING id,epoch`, [f.tenantId, old])).rows[0];
    const api = (method: string, path: string, cookie = f.cookie) => worker.fetch(new Request(f.env.APP_ORIGIN + path,
      { method, headers: { Cookie: cookie, Origin: f.env.APP_ORIGIN } }), f.env, {} as ExecutionContext);
    const request = (policy: {id:string;epoch:number}, grant = true) =>
      mcpRequest(f.env, { ...f.auth, authMethod: "oauth", oauthGrantId: "fixture-grant", oauthClientId: "fixture-client",
        oauthExpiresAt: Date.now()/1000 + 600, explicitIntegrationScopes: true, scopes: ["proxy:use", ...(grant ? [`integration:${policy.id}:${policy.epoch}`] : [])] });
    const call = (policy: {id:string;epoch:number}, method: string, path: string, extra: Record<string,unknown> = {}, grant = true) =>
      request(policy, grant)("tools/call", { name: "request_api", arguments: { method, path, integration: policy.id, execution: "sync", ...extra } });
    const legacy = await (await api("GET", url)).json() as { connections: unknown[] };
    expect(legacy.connections).toEqual([{ id: old, name: "Legacy account", connected: false, reconnectRequired: true }]);
    const provider = vi.fn(async (value: URL|string, init?: RequestInit) => {
      const target = new URL(value);
      if (target.origin === "https://dash.cloudflare.com") {
        expect(target.pathname).toBe("/oauth2/token");
        expect(init?.redirect).toBe("manual");
        const body = init?.body as URLSearchParams;
        expect(body.get("client_secret")).toBe(config.CLOUDFLARE_OAUTH_CLIENT_SECRET);
        expect(body.has("scope")).toBe(false);
        if (body.get("grant_type") === "refresh_token") {
          expect(body.get("refresh_token")).toBe("refresh-fixture");
          return Response.json({ access_token: "new-fixture", token_type: "bearer", expires_in: 300 });
        }
        expect(body.get("grant_type")).toBe("authorization_code");
        expect(body.get("code_verifier")).toHaveLength(43);
        expect(body.get("redirect_uri")).toBe(f.env.APP_ORIGIN + "/oauth/cloudflare/callback");
        return Response.json({ access_token: "first-fixture", refresh_token: "refresh-fixture", token_type: "Bearer", expires_in: 300 });
      }
      expect(target.origin).toBe("https://api.cloudflare.com");
      expect(init?.redirect).toBe("manual");
      expect(target.pathname).toMatch(/^\/client\/v4\/accounts\/(?:one|two)\/widgets$/);
      const h = new Headers(init?.headers);
      expect(h.has("x-auth-key")).toBe(false);
      expect(h.has("x-http-method-override")).toBe(false);
      if (target.searchParams.has("redirect")) return new Response(null,{status:302,headers:{Location:"https://outside.example.test/"}});
      if (target.pathname.includes("/two/")) return Response.json({ success: false }, { status: 403 });
      return Response.json({ method: init?.method, query: target.search, fresh: h.get("Authorization") === "Bearer new-fixture" },
        { headers: { "Set-Cookie": "untrusted=1", "X-API-Token": "private" } });
    });
    vi.stubGlobal("fetch", provider);
    expect((await call(oldPolicy,"GET","/accounts/one/widgets")).message.result.isError).toBe(true);
    expect(provider).not.toHaveBeenCalled();

    const configuredScopes = f.env.CLOUDFLARE_OAUTH_DEFAULT_SCOPES;
    f.env.CLOUDFLARE_OAUTH_DEFAULT_SCOPES = " \t ";
    const missingScopes = await api("POST", url + "/authorize");
    expect(missingScopes.status).toBe(503);
    expect(await missingScopes.text()).toContain("Set the default Cloudflare OAuth scopes");
    const state = await (await api("GET", url)).json() as { configured: boolean };
    expect(state.configured).toBe(false);
    delete f.env.CLOUDFLARE_OAUTH_CLIENT_SECRET;
    const missingClient = await api("POST", url + "/authorize");
    expect(missingClient.status).toBe(503);
    expect(await missingClient.text()).toContain("Set the Cloudflare OAuth client ID and client secret");
    expect(provider).not.toHaveBeenCalled();
    f.env.CLOUDFLARE_OAUTH_CLIENT_SECRET = config.CLOUDFLARE_OAUTH_CLIENT_SECRET;
    f.env.CLOUDFLARE_OAUTH_DEFAULT_SCOPES = configuredScopes;

    const start = await api("POST", url + "/authorize");
    expect(start.status).toBe(200);
    const browser = f.cookie + "; " + start.headers.get("Set-Cookie")!.split(";")[0];
    const { authorizationUrl } = await start.json() as { authorizationUrl: string };
    const external = new URL(authorizationUrl);
    expect(external.origin).toBe("https://dash.cloudflare.com");
    expect(catalog).toHaveLength(47);
    const scopes = external.searchParams.get("scope")?.split(" ");
    expect(scopes).toHaveLength(48);
    expect(scopes).toEqual([...catalog, "offline_access"]);
    expect(external.searchParams.get("code_challenge_method")).toBe("S256");
    const callback = "/oauth/cloudflare/callback?code=authorized-fixture&state=" + external.searchParams.get("state");
    const wrongBrowser = await api("GET", callback);
    expect(wrongBrowser.headers.get("Location")).toContain("cloudflare=expired");
    delete f.env.CLOUDFLARE_OAUTH_DEFAULT_SCOPES;
    delete f.env.CLOUDFLARE_OAUTH_READ_SCOPES;
    const returned = await api("GET", callback, browser);
    expect(returned.headers.get("Location")).toBe(f.env.APP_ORIGIN + "/integrations?cloudflare=connected");
    expect(provider).toHaveBeenCalledTimes(1); // No Cloudflare account or zone listing.
    expect((await api("GET",callback,browser)).headers.get("Location")).toContain("cloudflare=expired");

    const fresh = (await f.db.pool.query<{id:string;epoch:number}>(`SELECT id,epoch FROM app.agent_integrations
      WHERE tenant_id=$1 AND kind='cloudflare' AND credential_id<>$2`,[f.tenantId,old])).rows[0];
    const listed = await (await api("GET", url)).text();
    for (const value of [config.CLOUDFLARE_OAUTH_CLIENT_SECRET,"first-fixture","refresh-fixture"]) expect(listed).not.toContain(value);
    expect(JSON.parse(listed).connections).toHaveLength(2);
    const reflection = (await request(fresh)("tools/call", { name: "get_api_reflection", arguments: {} })).message.result.structuredContent;
    expect(reflection.integrations).toEqual(expect.arrayContaining([expect.objectContaining({ id: fresh.id, access: "granted" })]));
    const recipe = await example("use-an-api", "request_api");
    const sample = await request(fresh)("tools/call", {
      name: "request_api", arguments: { ...recipe, integration: fresh.id, path: "/accounts/one/widgets" },
    });
    expect(sample.message.result.structuredContent).toMatchObject({ status: 200 });
    expect((await call(fresh,"GET","/accounts/one/widgets",{},false)).status).toBe(403);
    expect(provider).toHaveBeenCalledTimes(2);
    // A stored, unexpired token needs neither new-consent defaults nor a client
    // secret. The refresh below still needs the secret but does not need defaults.
    delete f.env.CLOUDFLARE_OAUTH_CLIENT_SECRET;
    const write = (await call(fresh,"PUT","/accounts/one/widgets?page=2",{ body:"{}", headers:{
      "Content-Type":"application/json","X-Auth-Key":"caller-fixture","X-HTTP-Method-Override":"DELETE",
    } })).message.result.structuredContent;
    expect(write.status).toBe(200);
    expect(write.body).toContain('"method":"PUT"');
    expect(JSON.stringify(write.headers)).not.toMatch(/set-cookie|x-api-token/i);
    const upstreamForbidden = await call(fresh,"GET","/accounts/two/widgets");
    expect(upstreamForbidden.status).toBe(200);
    expect(upstreamForbidden.message.result.structuredContent.status).toBe(403);
    expect((await call(fresh,"GET","/accounts/one/widgets?redirect=1")).message.result.isError).toBe(true);

    vi.spyOn(Date,"now").mockReturnValue(Date.now()+301000);
    const beforeMissingSecret = provider.mock.calls.length;
    const requiresSecret = await call(fresh,"GET","/accounts/one/widgets");
    expect(requiresSecret.message.result?.isError ?? !!requiresSecret.message.error).toBe(true);
    expect(provider).toHaveBeenCalledTimes(beforeMissingSecret);
    f.env.CLOUDFLARE_OAUTH_CLIENT_SECRET = config.CLOUDFLARE_OAUTH_CLIENT_SECRET;
    f.env.CLOUDFLARE_OAUTH_DEFAULT_SCOPES = "NOT?a-provider-scope";
    const refreshed = (await call(fresh,"GET","/accounts/one/widgets")).message.result.structuredContent;
    expect(refreshed.status).toBe(200);
    expect(refreshed.body).toContain('"fresh":true');
    const freshConnection = (await f.db.pool.query<{id:string}>("SELECT id FROM app.cloudflare_connections WHERE tenant_id=$1 AND account_id IS NULL",[f.tenantId])).rows[0];
    expect(await api("DELETE",url+"/"+freshConnection.id)).toHaveProperty("status",200);
    expect((await call(fresh,"GET","/accounts/one/widgets")).message.result.isError).toBe(true);
    expect((await f.db.pool.query("SELECT encrypted_credentials FROM app.cloudflare_connections WHERE id=$1",[old])).rows[0].encrypted_credentials).toBe(encrypted);
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await f.cleanup();
  }
});

it.skipIf(!database)("returns only fixed callback diagnostics through the Worker", async () => {
  const f = await loadingFixture(database!);
  try {
    Object.assign(f.env, config);
    const privateText = "fixture-do-not-expose";
    const password = config.CLOUDFLARE_OAUTH_CLIENT_SECRET;
    const token = "fixture-private-access";
    const refresh = "fixture-private-refresh";
    const code = "fixture-private-code";
    const api = (method: string, path: string, cookie = f.cookie) => worker.fetch(new Request(f.env.APP_ORIGIN + path,
      { method, headers: { Cookie: cookie, Origin: f.env.APP_ORIGIN } }), f.env, {} as ExecutionContext);
    const start = async () => {
      const response = await api("POST", url + "/authorize");
      expect(response.status).toBe(200);
      const cookie = f.cookie + "; " + response.headers.get("Set-Cookie")!.split(";")[0];
      const { authorizationUrl } = await response.json() as { authorizationUrl: string };
      const state = new URL(authorizationUrl).searchParams.get("state")!;
      return { cookie, state };
    };
    const expectFailure = async (attempt: Awaited<ReturnType<typeof start>>, diagnostic: string) => {
      const query = new URLSearchParams({ code, state: attempt.state, upstream_details: privateText });
      const response = await api("GET", "/oauth/cloudflare/callback?" + query, attempt.cookie);
      expect(response.status).toBe(303);
      const location = response.headers.get("Location");
      expect(location).toBe(f.env.APP_ORIGIN + "/integrations?cloudflare=failed&cloudflare_error=" + diagnostic);
      expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
      const headerValues: string[] = [];
      response.headers.forEach(value => headerValues.push(value));
      const visible = JSON.stringify(headerValues) + await response.text();
      for (const value of [privateText,password,token,refresh,code,attempt.state,f.cookie, f.userId, f.tenantId])
        expect(visible).not.toContain(value);
    };

    const provider = vi.fn();
    vi.stubGlobal("fetch", provider);
    const noConfig = await start();
    delete f.env.CLOUDFLARE_OAUTH_CLIENT_SECRET;
    await expectFailure(noConfig, "configuration");
    f.env.CLOUDFLARE_OAUTH_CLIENT_SECRET = password;
    const corrupted = await start();
    await f.db.pool.query("UPDATE app.cloudflare_oauth_attempts SET verifier=$2 WHERE tenant_id=$1", [f.tenantId,privateText]);
    await expectFailure(corrupted, "attempt");
    expect(provider).not.toHaveBeenCalled();

    type Case = { error?: string; status: number; diagnostic: string };
    for (const failure of [
      { error: "invalid_client", status: 401, diagnostic: "token_client_rejected" },
      { error: "unauthorized_client", status: 400, diagnostic: "token_client_rejected" },
      { error: "invalid_grant", status: 400, diagnostic: "token_grant_rejected" },
      { error: privateText, status: 400, diagnostic: "token_rejected" },
      { status: 502, diagnostic: "token_rejected" },
      { status: 200, diagnostic: "token_invalid_response" },
    ] satisfies Case[]) {
      const upstream = failure.error
        ? Response.json({ error: failure.error, error_description: privateText, access_token: token }, { status: failure.status })
        : new Response(privateText, { status: failure.status });
      provider.mockResolvedValueOnce(upstream);
      await expectFailure(await start(), failure.diagnostic);
    }

    provider.mockRejectedValueOnce(new Error(privateText));
    await expectFailure(await start(), "token_unreachable");

    const store = await start();
    provider.mockResolvedValueOnce(Response.json({ access_token: token, refresh_token: refresh, expires_in: 300, token_type: "bearer" }));
    await f.db.pool.query("ALTER TABLE app.cloudflare_connections ADD CHECK (encrypted_credentials IS NULL)");
    await expectFailure(store, "storage");
    expect((await f.db.pool.query("SELECT id FROM app.cloudflare_connections WHERE tenant_id=$1", [f.tenantId])).rowCount).toBe(0);
  } finally {
    vi.unstubAllGlobals();
    await f.cleanup();
  }
});
