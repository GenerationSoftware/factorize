import { createServer } from "node:http";
import { Buffer } from "node:buffer";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadingFixture } from "./helpers/loading-fixture";
import { accessTokenDigest } from "../src/access-tokens";
import { ApiService } from "../src/flow-service";
import { signSession } from "../src/session";
import worker from "../src/worker";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {}, DurableObject: class {} }));
vi.mock("@cloudflare/workers-oauth-provider", () => ({ OAuthProvider: class {}, AuthorizationError: class extends Error {}, getOAuthApi: vi.fn() }));

const dbUrl = process.env.AUTH_TEST_DATABASE_URL;
describe.skipIf(!dbUrl)("Sign in with Factorize", () => {
  let f: Awaited<ReturnType<typeof loadingFixture>>;
  let callback: ReturnType<typeof createServer>;
  let redirectUri: string;
  const context = { waitUntil() {} } as ExecutionContext;
  const verifier = "z".repeat(64);
  const request = (path: string, init?: RequestInit) => worker.fetch(new Request(f.env.APP_ORIGIN + path, init), f.env, context);
  const token = (body: Record<string,string>, clientId: string, secret: string) => request("/oauth/apps/token", {
    method: "POST", headers: { Authorization: "Basic " + Buffer.from(clientId + ":" + secret).toString("base64") }, body: new URLSearchParams(body),
  });
  const authorize = async (clientId: string, options: Record<string,string> = {}) => {
    const query = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code",
      code_challenge: await accessTokenDigest(verifier), code_challenge_method: "S256", nonce: "sample-nonce", state: "sample-state", ...options });
    return request("/oauth/apps/authorize?" + query);
  };
  const decide = (requestId: string, cookie: string, decision = "allow") => request("/api/v1/app-consent/decision", {
    method: "POST", headers: { Cookie: cookie, Origin: f.env.APP_ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify({ requestId, decision }),
  });
  const reqId = (response: Response) => new URL(response.headers.get("Location")!).searchParams.get("request")!;
  const appApi = (tenantId = f.tenantId) => new ApiService(f.env, { ...f.auth, tenantId, scopes: ["apps:manage", "team:read", "team:write"] });
  async function register(isPublic = false) {
    const app = await appApi().createApp({ name: "Sample server", redirectUris: [redirectUri], public: isPublic });
    const { clientSecret } = await appApi().rotateAppSecret(app.id);
    return { id: app.id, secret: clientSecret };
  }
  async function receiveCode(id: string, cookie = f.cookie, options?: Record<string,string>) {
    const started = await authorize(id, options);
    expect(started.status).toBe(302);
    const approval = await decide(reqId(started), cookie);
    expect(approval.status).toBe(200);
    const { redirectTo } = await approval.json() as { redirectTo: string };
    const arrived = await fetch(redirectTo);
    const response = await arrived.json() as { code: string; state: string };
    expect(response.state).toBe("sample-state");
    return response.code;
  }
  const exchange = (id: string, secret: string, code: string, codeVerifier = verifier) => token({ grant_type: "authorization_code", code, code_verifier: codeVerifier, redirect_uri: redirectUri }, id, secret);
  const refresh = (id: string, secret: string, value: string) => token({ grant_type: "refresh_token", refresh_token: value }, id, secret);

  beforeAll(async () => {
    f = await loadingFixture(dbUrl!);
    callback = createServer((incoming, outgoing) => {
      const query = new URL(incoming.url!, redirectUri).searchParams;
      outgoing.setHeader("Content-Type","application/json");
      outgoing.end(JSON.stringify({ code: query.get("code"), state: query.get("state") }));
    });
    await new Promise<void>(resolve => callback.listen(0, "127.0.0.1", resolve));
    const address = callback.address();
    if (!address || typeof address === "string") throw new Error("Callback server is unavailable");
    redirectUri = `http://127.0.0.1:${address.port}/callback`;
  });
  afterAll(async () => {
    if (callback) await new Promise<void>(resolve => callback.close(() => resolve()));
    await f?.cleanup();
  });

  it("discovers and signs an identity-only login to a server app", async () => {
    const { id, secret } = await register();
    const discovery = await request("/oauth/apps/.well-known/openid-configuration");
    expect(discovery.status).toBe(200);
    const metadata = await discovery.json() as { issuer: string; jwks_uri: string };
    expect(metadata.issuer).toBe(f.env.APP_ORIGIN + "/oauth/apps");
    const code = await receiveCode(id);
    const response = await exchange(id, secret, code);
    expect(response.status).toBe(200);
    const issued = await response.json() as { id_token: string; access_token: string; scope: string };
    expect(issued.scope).toBe("openid");
    const [header,payload,signature] = issued.id_token.split(".");
    const { kid } = JSON.parse(Buffer.from(header,"base64url").toString());
    const claims = JSON.parse(Buffer.from(payload,"base64url").toString());
    expect(claims).toMatchObject({ iss: metadata.issuer, aud: id, nonce: "sample-nonce", sub: f.userId });
    expect(claims).not.toHaveProperty("email");
    expect(issued).not.toHaveProperty("refresh_token");
    const jwks = await request(new URL(metadata.jwks_uri).pathname);
    const { keys } = await jwks.json() as { keys: Array<JsonWebKey & { kid: string }> };
    const key = await crypto.subtle.importKey("jwk", keys.find(item => item.kid === kid)!, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    expect(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, Buffer.from(signature,"base64url"), new TextEncoder().encode(header+"."+payload))).toBe(true);
    expect((await request("/api/v1/runs", { headers: { Authorization: "Bearer " + issued.access_token } })).status).toBe(403);
    expect(await (await request("/oauth/apps/userinfo", { headers: { Authorization: "Bearer " + issued.access_token } })).json()).toEqual({ sub: f.userId });
    expect((await exchange(id, secret, code)).status).toBe(400);
  });

  it("checks redirect, scope, client secret, and PKCE before issuing access and revokes it per connection", async () => {
    const { id, secret } = await register();
    const wrongRedirect = await authorize(id, { redirect_uri: redirectUri + "?unexpected=1" });
    expect(wrongRedirect.status).toBe(400);
    expect(wrongRedirect.headers.get("Location")).toBeNull();
    const unsupported = await authorize(id, { scope: "openid invalid:scope" });
    expect(new URL(unsupported.headers.get("Location")!).searchParams.get("error")).toBe("invalid_scope");

    const started = await authorize(id);
    const denied = await decide(reqId(started), f.cookie, "deny");
    const denial = await denied.json() as { redirectTo: string };
    expect(new URL(denial.redirectTo).searchParams.get("error")).toBe("access_denied");
    expect((await decide(reqId(started), f.cookie)).status).toBe(404);

    const code = await receiveCode(id, f.cookie, { scope: "openid email runs:read offline_access" });
    expect((await exchange(id, "a".repeat(43), code)).status).toBe(401);
    expect((await exchange(id, secret, code, "b".repeat(64))).status).toBe(400);
    const response = await exchange(id, secret, code);
    expect(response.status).toBe(200);
    const issued = await response.json() as { access_token: string; refresh_token: string };
    const apiHeaders = { Authorization: "Bearer " + issued.access_token };
    expect((await request("/api/v1/runs", { headers: apiHeaders })).status).toBe(200);
    expect(await (await request("/oauth/apps/userinfo", { headers: apiHeaders })).json()).toMatchObject({ sub: f.userId, email_verified: true });
    const refreshed = await refresh(id, secret, issued.refresh_token);
    expect(refreshed.status).toBe(200);
    expect((await refresh(id, secret, issued.refresh_token)).status).toBe(400);
    const next = await refreshed.json() as { refresh_token: string };
    const connection = (await appApi().listConnectedApps()).find(value => value.appId === id)!;
    await appApi().revokeConnectedApp(connection.id);
    expect((await request("/api/v1/runs", { headers: apiHeaders })).status).toBe(401);
    expect((await refresh(id, secret, next.refresh_token)).status).toBe(400);
  });

  it("permits public sign-in across teams and invalidates credentials on rotation or disable", async () => {
    const sessionVersion = f.auth.sessionVersion;
    await f.db.pool.query("INSERT INTO app.members(tenant_id,user_id,email,role,session_version) VALUES($1,$2,'owner@example.test','owner',$3)",
      [f.otherTenant, f.userId, sessionVersion]);
    const cookie = "factorize_session=" + await signSession({
      tenantId:f.otherTenant,userId:f.userId,email:"owner@example.test",sessionVersion,exp:Math.floor(Date.now()/1000)+3600,
    }, f.env.SESSION_SIGNING_SECRET);
    const { id, secret } = await register();
    expect((await decide(reqId(await authorize(id)), cookie)).status).toBe(404);
    await appApi().updateApp(id, { name:"Sample server", redirectUris:[redirectUri], public:true, enabled:true });
    const code = await receiveCode(id, cookie, {scope:"openid offline_access runs:read"});
    const response = await exchange(id, secret, code);
    expect(response.status).toBe(200);
    const issued = await response.json() as { access_token: string; refresh_token: string };
    const apiHeaders = { Authorization: "Bearer " + issued.access_token };
    const result = await request("/api/v1/runs", { headers:apiHeaders });
    expect(result.status).toBe(200);
    expect((await result.json() as {items:unknown[]}).items).toEqual([]);
    const rotated = await appApi().rotateAppSecret(id);
    expect((await refresh(id, secret, issued.refresh_token)).status).toBe(401);
    expect((await refresh(id, rotated.clientSecret, issued.refresh_token)).status).toBe(400);
    expect((await request("/api/v1/runs", { headers:apiHeaders })).status).toBe(401);
    const newCode = await receiveCode(id,cookie,{scope:"openid runs:read"});
    const newest = await (await exchange(id,rotated.clientSecret,newCode)).json() as {access_token:string};
    await appApi().updateApp(id,{name:"Sample server",redirectUris:[redirectUri],public:true,enabled:false});
    expect((await request("/api/v1/runs",{headers:{Authorization:"Bearer "+newest.access_token}})).status).toBe(401);
  });
});
