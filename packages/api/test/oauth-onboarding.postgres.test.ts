import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadingFixture } from "./helpers/loading-fixture";
import { protectedApiFetch } from "../src/protected-api";
import { deviceAuthorization, deviceToken, DEVICE_GRANT } from "../src/device-oauth";
import { readSession } from "../src/session";
vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {}, DurableObject: class {} }));
vi.mock("@cloudflare/workers-oauth-provider", () => ({ OAuthProvider: class {}, AuthorizationError: class extends Error {}, getOAuthApi: vi.fn() }));
const password = "correct horse battery staple";
describe.skipIf(!process.env.AUTH_TEST_DATABASE_URL)("MCP onboarding public boundaries with PostgreSQL", () => {
  let f: Awaited<ReturnType<typeof loadingFixture>>, emails: string[] = [];
  const grant = vi.fn(async ({ request }: any) => ({ redirectTo: `${request.redirectUri}?code=grant&state=${request.state}` }));
  const oauth = {
    lookupClient: async (id: string) => id === "client" ? { clientId: id, clientName: "MCP CLI", redirectUris: ["http://127.0.0.1/callback"], tokenEndpointAuthMethod: "none" } : null,
    parseAuthRequest: async (request: Request) => {
      const q = new URL(request.url).searchParams;
      if (q.get("redirect_uri") !== "http://127.0.0.1/callback" || q.get("code_challenge_method") !== "S256") throw new Error("invalid redirect/PKCE");
      return { responseType: "code", clientId: q.get("client_id"), redirectUri: q.get("redirect_uri"), scope: ["flows:read"], state: q.get("state"), codeChallenge: q.get("code_challenge"), codeChallengeMethod: "S256", resource: f.env.APP_ORIGIN + "/mcp", issuer: f.env.APP_ORIGIN };
    }, completeAuthorization: grant,
  };
  beforeAll(async () => { f = await loadingFixture(process.env.AUTH_TEST_DATABASE_URL!); Object.assign(f.env, { OAUTH_PROVIDER: oauth, POSTMARK_SERVER_TOKEN: "test-only", POSTMARK_FROM_EMAIL: "accounts@example.test", POSTMARK_MESSAGE_STREAM: "outbound" }); });
  afterAll(async () => { await f?.cleanup(); });
  afterEach(() => { vi.unstubAllGlobals(); emails = []; grant.mockClear(); });
  function mail() { vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init: RequestInit) => { emails.push(JSON.parse(String(init.body)).TextBody); return Response.json({ ErrorCode: 0 }); })); }
  const token = (i = emails.length - 1) => new URL(emails[i].match(/https:\/\/\S+/)![0]).searchParams.get("token")!;
  const email = () => `onboarding_${crypto.randomUUID()}@example.test`;
  const call = (path: string, body: object, cookie = "", origin = f.env.APP_ORIGIN) => protectedApiFetch(new Request(f.env.APP_ORIGIN + path, { method: "POST", headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify(body) }), f.env, null, {} as ExecutionContext);
  const tokenBody = async (response: Response) => await response.json() as { error?: string; access_token?: string };
  const cookieOf = (response: Response) => response.headers.get("Set-Cookie")!.split(";")[0];
  const sessionOf = (cookie: string) => readSession(decodeURIComponent(cookie.split("=").slice(1).join("=")), f.env.SESSION_SIGNING_SECRET);
  function destination(state: string) { return "/authorize?" + new URLSearchParams({ client_id: "client", response_type: "code", redirect_uri: "http://127.0.0.1/callback", scope: "flows:read", state, code_challenge: `challenge-${state}`, code_challenge_method: "S256" }); }
  async function start(state: string, returnTo = destination(state)) {
    const response = await call("/api/v1/auth/connections", { returnTo }); expect(response.status).toBe(200);
    expect(response.headers.get("Set-Cookie")).toContain("HttpOnly");
    return { ...await response.json() as any, cookie: cookieOf(response), destination: returnTo };
  }
  async function consent(returnTo: string, cookie: string, decision: "allow" | "deny" = "allow") {
    const previewResponse = await call("/api/v1/oauth/consent/preview", { authorizationQuery: returnTo.split("?")[1] }, cookie); expect(previewResponse.status).toBe(200);
    const preview = await previewResponse.json() as any;
    const input = { request: preview.request, signature: preview.signature, decision, scopes: ["flows:read"] };
    return { response: await call("/api/v1/oauth/consent/decision", input, cookie), input };
  }
  it("signs up, verifies, signs in automatically and explicitly consents once with original state/PKCE", async () => {
    mail(); const a = await start("new-user"), account = email();
    expect((await call("/api/v1/auth/signup", { email: account, password, connection: a.connection }, a.cookie)).status).toBe(202);
    expect(await (await call("/api/v1/auth/connections/resume", { connection: a.connection }, a.cookie)).json()).toMatchObject({ pending: true, clientName: "MCP CLI" });
    const verification = token(); const verified = await call("/api/v1/auth/email-verification/complete", { token: verification }, a.cookie);
    expect(verified.status).toBe(200); const body = await verified.json() as any, cookie = a.cookie + "; " + cookieOf(verified);
    expect(await sessionOf(cookieOf(verified))).toMatchObject({ email: account });
    expect(body.returnTo).toBe(a.destination + `&connection=${a.connection}`); expect(grant).not.toHaveBeenCalled();
    expect((await call("/api/v1/auth/email-verification/complete", { token: verification }, a.cookie)).status).toBe(400);
    const approved = await consent(body.returnTo, cookie); expect(approved.response.status).toBe(200);
    expect(grant).toHaveBeenCalledWith(expect.objectContaining({ request: expect.objectContaining({ state: "new-user", codeChallenge: "challenge-new-user", redirectUri: "http://127.0.0.1/callback" }) }));
    expect((await call("/api/v1/oauth/consent/decision", approved.input, cookie)).status).toBe(400);
    expect((await call("/api/v1/auth/connections/resume", { connection: a.connection }, a.cookie)).status).toBe(400); expect(grant).toHaveBeenCalledTimes(1);
  });
  it("verifies in another browser but allows callback consent only in the initiating browser; denial is final", async () => {
    mail(); const a = await start("another-browser"), account = email();
    await call("/api/v1/auth/signup", { email: account, password, connection: a.connection }, a.cookie);
    const verified = await call("/api/v1/auth/email-verification/complete", { token: token() }); expect(await verified.json()).toEqual({ ok: true, crossBrowser: true });
    const foreign = cookieOf(verified), returnTo = a.destination + `&connection=${a.connection}`;
    expect((await call("/api/v1/oauth/consent/preview", { authorizationQuery: returnTo.split("?")[1] }, foreign)).status).toBe(400);
    expect((await call("/api/v1/auth/connections/resume", { connection: a.connection }, foreign)).status).toBe(400);
    const resumed = await call("/api/v1/auth/connections/resume", { connection: a.connection }, a.cookie); expect(await resumed.json()).toMatchObject({ returnTo });
    const cookie = a.cookie + "; " + cookieOf(resumed);
    expect(await (await call("/api/v1/auth/connections/resume", { connection: a.connection }, cookie)).json()).toMatchObject({ returnTo });
    const denied = await consent(returnTo, cookie, "deny"); expect(denied.response.status).toBe(200);
    expect(new URL((await denied.response.json() as any).redirectTo).searchParams.get("error")).toBe("access_denied");
    expect((await call("/api/v1/oauth/consent/decision", denied.input, cookie)).status).toBe(400); expect(grant).not.toHaveBeenCalled();
  });
  it("isolates simultaneous requests through resend, existing-account login and password recovery", async () => {
    mail(); const a = await start("a"), b = await start("b"), account = email(), cookies = a.cookie + "; " + b.cookie;
    expect(a.cookie.split("=")[0]).not.toBe(b.cookie.split("=")[0]);
    await call("/api/v1/auth/signup", { email: account, password, connection: a.connection }, cookies); const first = token();
    await call("/api/v1/auth/email-verification/request", { email: account, connection: b.connection }, cookies); const second = token();
    for (const [t, c] of [[first, a], [second, b]]) { const verified = await call("/api/v1/auth/email-verification/complete", { token: t }, cookies); expect(verified.status).toBe(200); expect((await verified.json() as any).returnTo).toContain(`connection=${c.connection}`); }
    const c = await start("existing"), signed = await call("/api/v1/auth/login", { email: account, password, connection: c.connection }, c.cookie);
    expect(signed.status).toBe(200); const signedBody = await signed.json() as any; expect(signedBody.returnTo).toContain("state=existing");
    expect((await consent(signedBody.returnTo, c.cookie + "; " + cookieOf(signed))).response.status).toBe(200);
    const d = await start("recovery"); await call("/api/v1/auth/password-reset/request", { email: account, connection: d.connection }, d.cookie);
    const reset = await call("/api/v1/auth/password-reset/complete", { token: token(), password: "replacement long password" }, d.cookie);
    expect(reset.status).toBe(200); const body = await reset.json() as any; expect(body.returnTo).toContain(`connection=${d.connection}`);
    expect((await consent(body.returnTo, d.cookie + "; " + cookieOf(reset))).response.status).toBe(200);
  });
  it("rejects forged/expired connections and revoked verification without extending the client request", async () => {
    mail(); for (const returnTo of ["https://evil.test", "//evil.test", destination("bad").replace("127.0.0.1", "evil.test"), destination("bad").replace("S256", "plain")]) expect((await call("/api/v1/auth/connections", { returnTo })).status).toBe(400);
    const a = await start("expired"), account = email();
    expect((await call("/api/v1/auth/signup", { email: account, password, connection: a.connection })).status).toBe(400);
    await call("/api/v1/auth/signup", { email: account, password, connection: a.connection }, a.cookie); const verification = token();
    await f.db.pool.query("UPDATE app.oauth_connections SET expires_at=now()-interval '1 second' WHERE id=$1", [a.connection]);
    expect((await call("/api/v1/auth/email-verification/request", { email: account, connection: a.connection }, a.cookie)).status).toBe(400);
    const verified = await call("/api/v1/auth/email-verification/complete", { token: verification }, a.cookie); expect(verified.status).toBe(200); expect(await verified.json()).toMatchObject({ returnTo: "/auth/login?expired=1" });
    expect((await call("/api/v1/auth/connections/resume", { connection: a.connection }, a.cookie)).status).toBe(400); expect(grant).not.toHaveBeenCalled();
    const b = await start("revoked"); await call("/api/v1/auth/password-reset/request", { email: account, connection: b.connection }, b.cookie);
    const reset = await call("/api/v1/auth/password-reset/complete", { token: token(), password }), session = await sessionOf(cookieOf(reset));
    await f.db.pool.query("UPDATE app.members SET session_version=session_version+1 WHERE user_id=$1", [session!.userId]);
    expect((await call("/api/v1/auth/connections/resume", { connection: b.connection }, b.cookie)).status).toBe(403);
  });
  async function device() { return await (await deviceAuthorization(new Request(f.env.APP_ORIGIN + "/oauth/device_authorization", { method: "POST", body: new URLSearchParams({ client_id: "client", scope: "flows:read" }) }), f.env, oauth as any, ["flows:read"])).json() as any; }
  it("continues device signup in the verification browser and rejects unsigned, cross-owner and forged consent", async () => {
    mail(); const issued = await device(), a = await start("device", `/device?user_code=${issued.user_code}`), account = email();
    await call("/api/v1/auth/signup", { email: account, password, connection: a.connection }, a.cookie);
    const verified = await call("/api/v1/auth/email-verification/complete", { token: token() }), cookie = cookieOf(verified);
    expect((await verified.json() as any).returnTo).toContain("/device?user_code="); expect(grant).not.toHaveBeenCalled();
    const preview = await (await call("/api/v1/oauth/device/preview", { userCode: issued.user_code }, cookie)).json() as any;
    const input = { userCode: issued.user_code, decision: "allow", signature: preview.signature };
    expect((await call("/api/v1/oauth/device/decision", { ...input, signature: "forged" }, cookie)).status).toBe(403);
    expect((await call("/api/v1/oauth/device/decision", { userCode: issued.user_code, decision: "allow" }, cookie)).status).toBe(400);
    expect((await call("/api/v1/oauth/device/decision", input, f.cookie)).status).toBe(403);
    expect((await call("/api/v1/oauth/device/decision", input, cookie, "https://evil.test")).status).toBe(403);
    expect((await call("/api/v1/oauth/device/decision", input, cookie)).status).toBe(200);
    expect((await call("/api/v1/oauth/device/decision", input, cookie)).status).toBe(400); expect(grant).toHaveBeenCalledTimes(1);
  });
  it("serializes polls with pending, slow_down, denied, expired and successful single-use token outcomes", async () => {
    const issued = await device(), fetchToken = vi.fn(async () => Response.json({ access_token: "token", token_type: "bearer" }));
    const poll = (code = issued.device_code, client = "client") => deviceToken(new Request(f.env.APP_ORIGIN + "/oauth/token", { method: "POST", body: new URLSearchParams({ grant_type: DEVICE_GRANT, client_id: client, device_code: code }) }), f.env, { fetch: fetchToken }, {} as ExecutionContext);
    expect((await tokenBody(await poll(issued.device_code, "other"))).error).toBe("invalid_grant");
    const results = await Promise.all([poll(), poll()]); expect((await Promise.all(results.map(tokenBody))).map(r => r.error).sort()).toEqual(["authorization_pending", "slow_down"]);
    expect((await tokenBody(await poll())).error).toBe("slow_down");
    expect((await f.db.pool.query("SELECT record FROM app.oauth_device_authorizations WHERE device_code=$1", [issued.device_code])).rows[0].record.interval).toBe(15);
    const p = await (await call("/api/v1/oauth/device/preview", { userCode: issued.user_code }, f.cookie)).json() as any;
    await call("/api/v1/oauth/device/decision", { userCode: issued.user_code, signature: p.signature, decision: "deny" }, f.cookie);
    expect((await tokenBody(await poll())).error).toBe("access_denied"); expect(fetchToken).not.toHaveBeenCalled();
    const expired = await device(); await f.db.pool.query("UPDATE app.oauth_device_authorizations SET expires_at=now()-interval '1 second',record=jsonb_set(record,'{expiresAt}',to_jsonb(1)) WHERE device_code=$1", [expired.device_code]);
    expect((await tokenBody(await poll(expired.device_code))).error).toBe("expired_token"); expect((await call("/api/v1/oauth/device/preview", { userCode: expired.user_code }, f.cookie)).status).toBe(400);
    const approved = await device(), preview = await (await call("/api/v1/oauth/device/preview", { userCode: approved.user_code }, f.cookie)).json() as any;
    await call("/api/v1/oauth/device/decision", { userCode: approved.user_code, signature: preview.signature, decision: "allow" }, f.cookie);
    const tokens = await Promise.all([poll(approved.device_code), poll(approved.device_code)]);
    expect((await Promise.all(tokens.map(tokenBody))).map(r => r.access_token ?? r.error).sort()).toEqual(["expired_token", "token"]); expect(fetchToken).toHaveBeenCalledTimes(1);
  });
});
