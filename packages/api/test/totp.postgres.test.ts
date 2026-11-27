import { expect, it, vi } from "vitest";
import { hashPassword, tokenDigest } from "../src/auth/application/auth";
import { protectedApiFetch } from "../src/protected-api";
import { totpAt } from "../src/auth/application/totp";
import { loadingFixture } from "./helpers/loading-fixture";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {}, DurableObject: class {} }));
vi.mock("@cloudflare/workers-oauth-provider", () => ({ OAuthProvider: class {}, AuthorizationError: class extends Error {}, getOAuthApi: vi.fn() }));

const url = process.env.AUTH_TEST_DATABASE_URL;
const password = "original fixture password";
const newPassword = "replacement fixture password";
const runtimeKey = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
const cookie = (response: Response, prefix: string) => response.headers.getSetCookie().find(value => value.startsWith(prefix))!.split(";")[0];
const challenge = (response: Response) => cookie(response, "__Host-factorize_totp_login=");
const session = (response: Response) => cookie(response, "factorize_session=");
const currentSlot = () => Math.floor(Date.now() / 30_000);

it("generates the standard SHA1 authenticator value", async () => {
  expect(await totpAt("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 1)).toBe("287082");
});

it.skipIf(!url)("authenticator settings require the password and keep password and MCP session issuance behind the second factor", async () => {
  const f = await loadingFixture(url!);
  try {
    const h = await harness(f);
    const start = h.api("POST", "/auth/two-factor/enrollment", { password }, f.cookie);
    const setup = await start;
    expect(setup.status, await setup.clone().text()).toBe(200);
    const { secret, uri } = await setup.json() as { secret: string; uri: string };
    expect(new URL(uri).searchParams.get("secret")).toBe(secret);
    expect((await f.db.pool.query("SELECT encrypted_secret FROM app.auth_totp_enrollments")).rows[0].encrypted_secret).not.toContain(secret);
    const setupCookie = cookie(setup, "__Host-factorize_totp_enroll=");
    const slot = currentSlot();
    const enabled = await h.api("POST", "/auth/two-factor/enable", { code: await totpAt(secret, slot) }, f.cookie + "; " + setupCookie);
    expect(enabled.status, await enabled.clone().text()).toBe(200);
    const { recoveryCodes } = await enabled.json() as { recoveryCodes: string[] };
    expect(recoveryCodes).toHaveLength(10);
    expect(new Set(recoveryCodes).size).toBe(10);
    expect((await f.db.pool.query("SELECT digest FROM app.auth_totp_recovery_codes")).rows.every(row => !recoveryCodes.includes(row.digest))).toBe(true);
    expect(await (await h.api("GET", "/session", undefined, f.cookie)).json()).toEqual({ authenticated: false });
    const activeCookie = session(enabled);
    const status = await (await h.api("GET", "/auth/two-factor", undefined, activeCookie)).json();
    expect(status).toEqual({ enabled: true, available: true, method: "password", googleVerified: false });

    const destination = "/authorize?" + new URLSearchParams({ client_id: "mcp-test", redirect_uri: "https://client.test/callback", response_type: "code", state: "fixture", code_challenge: "a-fixture-challenge", code_challenge_method: "S256" });
    const started = await h.api("POST", "/auth/connections", { returnTo: destination });
    expect(started.status).toBe(200);
    const { connection } = await started.json() as {connection: string};
    const connectionCookie = cookie(started, "factorize_connection_");
    const login = await h.api("POST", "/auth/login", { email: h.email, password, connection }, connectionCookie);
    expect(await login.json()).toEqual({ ok: true, returnTo: "/auth/two-factor" });
    expect(session(login)).toBe("factorize_session=");
    expect((await f.db.pool.query("SELECT user_id,used_at FROM app.oauth_connections WHERE id=$1", [connection])).rows[0]).toEqual({ user_id: null, used_at: null });
    const second = challenge(login);
    expect(await (await h.api("GET", "/session", undefined, second)).json()).toEqual({ authenticated: false });
    const attemptedConsent = await h.api("POST", "/oauth/consent/preview", { authorizationQuery: destination.split("?")[1] + "&connection=" + connection }, connectionCookie + "; " + second);
    expect(attemptedConsent.status).toBe(401);
    const verified = await h.api("POST", "/auth/two-factor/challenge", { code: recoveryCodes[0] }, connectionCookie + "; " + second);
    expect(verified.status, await verified.clone().text()).toBe(200);
    const result = await verified.json() as {returnTo: string};
    expect(result.returnTo).toBe(destination + "&connection=" + connection);
    expect((await f.db.pool.query("SELECT user_id,used_at FROM app.oauth_connections WHERE id=$1", [connection])).rows[0]).toEqual({ user_id: f.userId, used_at: null });
    const authenticated = session(verified);
    expect(await (await h.api("GET", "/session", undefined, authenticated)).json()).toMatchObject({ user: { id: f.userId }, team: { id: f.tenantId } });
    expect((await h.api("POST", "/oauth/consent/preview", { authorizationQuery: result.returnTo.split("?")[1] }, connectionCookie + "; " + authenticated)).status).toBe(200);

    const another = await h.api("POST", "/auth/login", { email: h.email, password });
    expect((await h.api("POST", "/auth/two-factor/challenge", { code: recoveryCodes[0] }, challenge(another))).status).toBe(401);
    const other = await h.api("POST", "/auth/login", { email: h.email, password });
    const pairedResult = await Promise.all([another, other].map(response =>
      h.api("POST", "/auth/two-factor/challenge", { code: recoveryCodes[1] }, challenge(response))));
    expect(pairedResult.map(response => response.status).sort()).toEqual([200, 401]);
    expect((await h.api("POST", "/auth/two-factor/disable", { password: "incorrect fixture password", code: recoveryCodes[2] }, authenticated)).status).toBe(401);
    const disabled = await h.api("POST", "/auth/two-factor/disable", { password, code: recoveryCodes[2] }, authenticated);
    expect(disabled.status, await disabled.clone().text()).toBe(200);
    expect(await (await h.api("GET", "/auth/two-factor", undefined, session(disabled))).json()).toMatchObject({ enabled: false });
    expect((await f.db.pool.query("SELECT 1 FROM app.auth_totp_recovery_codes")).rows).toHaveLength(0);
  } finally {
    await f.cleanup();
  }
});

it.skipIf(!url)("does not accept the same authenticator interval twice and does not bypass 2FA after password reset", async () => {
  const f = await loadingFixture(url!);
  try {
    const h = await harness(f);
    const setup = await h.api("POST", "/auth/two-factor/enrollment", { password }, f.cookie);
    const { secret } = await setup.json() as {secret: string};
    const fixtureClock = currentSlot() * 30_000 + 5000;
    vi.spyOn(Date, "now").mockReturnValue(fixtureClock);
    const setupCode = await totpAt(secret, currentSlot());
    const enabled = await h.api("POST", "/auth/two-factor/enable", { code: setupCode }, f.cookie + "; " + cookie(setup, "__Host-factorize_totp_enroll="));
    expect(enabled.status).toBe(200);
    const { recoveryCodes } = await enabled.json() as { recoveryCodes: string[] };
    const first = await h.api("POST", "/auth/login", { email: h.email, password });
    expect((await h.api("POST", "/auth/two-factor/challenge", { code: setupCode }, challenge(first))).status).toBe(401);
    const second = await h.api("POST", "/auth/login", { email: h.email, password });
    const acceptableCode = await totpAt(secret, currentSlot() + 1);
    const exactOnce = await Promise.all([first, second].map(response =>
      h.api("POST", "/auth/two-factor/challenge", { code: acceptableCode }, challenge(response))));
    expect(exactOnce.map(response => response.status).sort()).toEqual([200, 401]);
    vi.restoreAllMocks();

    // Simulate a previously mailed, ordinary reset link in the disposable DB.
    const resetToken = "local-reset-fixture";
    await f.db.pool.query("INSERT INTO app.auth_reset_tokens(digest,user_id,expires_at,purpose) VALUES($1,$2,now()+interval '1 hour','reset')", [
      await tokenDigest(resetToken, f.env.SESSION_SIGNING_SECRET), f.userId,
    ]);
    const reset = await h.api("POST", "/auth/password-reset/complete", { token: resetToken, password: newPassword });
    expect(await reset.json()).toEqual({ ok: true, returnTo: "/auth/two-factor" });
    expect(session(reset)).toBe("factorize_session=");
    const afterReset = await h.api("POST", "/auth/two-factor/challenge", { code: recoveryCodes[0] }, challenge(reset));
    expect(afterReset.status).toBe(200);
    expect(await (await h.api("GET", "/auth/two-factor", undefined, session(afterReset))).json()).toMatchObject({ enabled: true });
  } finally {
    vi.restoreAllMocks();
    await f.cleanup();
  }
});

it.skipIf(!url)("expires pending logins and throttles repeated code checks across browser challenges", async () => {
  const f = await loadingFixture(url!);
  try {
    const h = await harness(f);
    const prepared = await h.api("POST", "/auth/two-factor/enrollment", { password }, f.cookie);
    const { secret } = await prepared.json() as { secret: string };
    const enabled = await h.api("POST", "/auth/two-factor/enable", { code: await totpAt(secret, currentSlot()) }, f.cookie + "; " + cookie(prepared, "__Host-factorize_totp_enroll="));
    const { recoveryCodes } = await enabled.json() as { recoveryCodes: string[] };
    const login = () => h.api("POST", "/auth/login", { email: h.email, password });
    const expired = await login();
    await f.db.pool.query("UPDATE app.auth_totp_challenges SET expires_at=now()-interval '1 second' WHERE user_id=$1", [f.userId]);
    expect((await h.api("POST", "/auth/two-factor/challenge", { code: recoveryCodes[0] }, challenge(expired))).status).toBe(400);
    const left = await login(), right = await login();
    await f.db.pool.query("UPDATE app.auth_totp_limits SET attempts=9 WHERE user_id=$1 AND kind='code'", [f.userId]);
    expect((await h.api("POST", "/auth/two-factor/challenge", { code: "not-an-authenticator-code" }, challenge(left))).status).toBe(401);
    expect((await h.api("POST", "/auth/two-factor/challenge", { code: recoveryCodes[0] }, challenge(right))).status).toBe(429);
    await f.db.pool.query("UPDATE app.auth_totp_limits SET expires_at=now()-interval '1 second' WHERE user_id=$1 AND kind='code'", [f.userId]);
    expect((await h.api("POST", "/auth/two-factor/challenge", { code: recoveryCodes[0] }, challenge(right))).status).toBe(200);
  } finally {
    await f.cleanup();
  }
});

async function harness(f: Awaited<ReturnType<typeof loadingFixture>>) {
  const email = (await f.db.pool.query<{ email:string }>("SELECT email FROM app.auth_users WHERE id=$1", [f.userId])).rows[0].email;
  await f.db.pool.query("INSERT INTO app.auth_accounts(id,user_id,provider,provider_account_id,password_hash) VALUES($1,$2::uuid,'credential',$2::uuid::text,$3)",
    [crypto.randomUUID(), f.userId, await hashPassword(password)]);
  const oauth = {
    listUserGrants: async () => ({ items: [] }),
    lookupClient: async () => ({ clientId: "mcp-test", clientName: "MCP fixture", redirectUris: ["https://client.test/callback"], tokenEndpointAuthMethod: "none" }),
    parseAuthRequest: async (request: Request) => {
      const q = new URL(request.url).searchParams;
      return { responseType: "code", clientId: q.get("client_id"), redirectUri: q.get("redirect_uri"), scope: ["team:read"], state: q.get("state"), codeChallenge: q.get("code_challenge"), codeChallengeMethod: q.get("code_challenge_method"), resource: f.env.APP_ORIGIN + "/mcp" };
    },
  };
  Object.assign(f.env, { TOTP_ENCRYPTION_KEY: runtimeKey(), OAUTH_PROVIDER: oauth });
  const api = (method: string, path: string, body?: unknown, cookie = "") => protectedApiFetch(new Request(f.env.APP_ORIGIN + "/api/v1" + path, {
    method, headers: { Cookie: cookie, Origin: f.env.APP_ORIGIN, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  }), f.env, null, {} as ExecutionContext);
  return { api, email };
}
