import { totpAt } from "../src/auth/application/totp";
import { expect, it, vi } from "vitest";
import { protectedApiFetch } from "../src/protected-api";
import { googleSignInCallback } from "../src/auth/api/auth-api";
import { hashPassword, tokenDigest } from "../src/auth/application/auth";
import { loadingFixture } from "./helpers/loading-fixture";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {}, DurableObject: class {} }));
vi.mock("@cloudflare/workers-oauth-provider", () => ({ OAuthProvider: class {}, AuthorizationError: class extends Error {}, getOAuthApi: vi.fn() }));

const url = process.env.AUTH_TEST_DATABASE_URL;
const password = "some fixture password";
const signedPart = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

it.skipIf(!url)("links only after confirming the original password and reuses the existing workspace", async () => {
  const f = await loadingFixture(url!);
  try {
    const h = await harness(f);
    await f.db.pool.query("INSERT INTO app.auth_accounts(id,user_id,provider,provider_account_id,password_hash) VALUES ($1,$2::uuid,'credential',$2::uuid::text,$3)", [crypto.randomUUID(), f.userId, await hashPassword(password)]);
    const email = (await f.db.pool.query<{email:string}>("SELECT email FROM app.auth_users WHERE id=$1", [f.userId])).rows[0].email;
    const first = await h.google("existing-subject", email);
    expect(first.result.headers.get("Location")).toBe(f.env.APP_ORIGIN + "/auth/google");
    expect(first.result.headers.getSetCookie()).toEqual([]);
    const pending = await h.api("GET", "/auth/google/pending", undefined, first.browser);
    expect(await pending.json()).toEqual({ email, mode: "link" });
    expect((await h.api("POST", "/auth/google/finish", { password: "incorrect password" }, first.browser)).status).toBe(401);
    expect((await f.db.pool.query("SELECT 1 FROM app.auth_accounts WHERE provider='google' AND user_id=$1", [f.userId])).rows).toHaveLength(0);
    const finish = await h.api("POST", "/auth/google/finish", { password }, first.browser);
    expect(finish.status, await finish.clone().text()).toBe(200);
    expect(await finish.json()).toEqual({ ok: true, returnTo: "/clients" });
    const cookie = h.sessionCookie(finish);
    expect(await (await h.api("GET", "/session", undefined, cookie)).json()).toMatchObject({ user: { id: f.userId }, team: { id: f.tenantId }, hasPassword: true });

    // Google can change its email metadata; subsequent sign-in is bound to the stable subject.
    const returning = await h.google("existing-subject", "updated@gmail.com");
    expect(returning.result.headers.get("Location")).toBe(f.env.APP_ORIGIN + "/clients");
    expect(await (await h.api("GET", "/session", undefined, h.sessionCookie(returning.result))).json()).toMatchObject({ user: { id: f.userId, email }, team: { id: f.tenantId } });
    expect((await h.api("POST", "/auth/password-reset/request", { email })).status).toBe(200);
    expect(h.mail.map(message => message.To)).toEqual([email]);
    const byPassword = await h.api("POST", "/auth/login", { email, password });
    expect(byPassword.status).toBe(200);
    expect(await (await h.api("GET", "/session", undefined, h.sessionCookie(byPassword))).json()).toMatchObject({ user: { id: f.userId }, team: { id: f.tenantId } });
  } finally {
    vi.unstubAllGlobals();
    await f.cleanup();
  }
});

it.skipIf(!url)("checks username availability but enforces it at signup and adds a first password with fresh Google proof and email", async () => {
  const f = await loadingFixture(url!);
  try {
    const h = await harness(f);
    const newEmail = "google-new-user@gmail.com";
    const { browser, result } = await h.google("signup-subject", newEmail);
    expect(result.headers.get("Location")).toBe(f.env.APP_ORIGIN + "/auth/google");
    const checkName = async (username: string) => (await h.api("POST", "/auth/google/username", { username }, browser)).json();
    const competing = "available-now";
    expect(await checkName(competing)).toEqual({ available: true });
    await f.db.pool.query("UPDATE app.auth_users SET username=$2 WHERE id=$1", [f.userId, competing]);
    const conflict = await h.api("POST", "/auth/google/finish", { username: competing }, browser);
    expect(conflict.status).toBe(409);
    expect(await checkName(competing)).toEqual({ available: false });
    expect((await f.db.pool.query("SELECT 1 FROM app.auth_users WHERE lower(email)=$1", [newEmail])).rows).toHaveLength(0);
    const finish = await h.api("POST", "/auth/google/finish", { username: "google-factory" }, browser);
    expect(finish.status, await finish.clone().text()).toBe(200);
    const cookie = h.sessionCookie(finish);
    const session = await (await h.api("GET", "/session", undefined, cookie)).json() as { user:{ id: string }; team:{ id: string }; hasPassword:boolean };
    expect(session).toMatchObject({ authenticated: true, user: { email: newEmail }, hasPassword: false });
    expect(session.team.id).not.toBe(f.tenantId);
    expect((await h.api("POST", "/auth/password/set-request", undefined)).status).toBe(401);
    expect((await h.api("POST", "/auth/password-reset/request", { email: newEmail })).status).toBe(200);
    expect(h.mail).toHaveLength(0);
    const proof = await h.google("signup-subject", newEmail, cookie);
    expect(proof.result.headers.get("Location")).toBe(f.env.APP_ORIGIN + "/auth/google");
    expect(await (await h.api("GET", "/auth/google/pending", undefined, proof.browser)).json()).toEqual({ email: newEmail, mode: "set-password" });
    expect((await h.api("POST", "/auth/google/email/request", undefined, proof.browser)).status).toBe(200);
    expect(h.mail).toHaveLength(1);
    expect(h.mail[0].To).toBe(newEmail);
    const link = new URL(h.mail[0].TextBody.match(/https:\/\/\S+/)![0]);
    const token = link.searchParams.get("token");
    const reset = await h.api("POST", "/auth/google/password/complete", { token, password }, proof.browser);
    expect(reset.status, await reset.clone().text()).toBe(200);
    const next = h.sessionCookie(reset);
    expect(await (await h.api("GET", "/session", undefined, next)).json()).toMatchObject({ user: { id: session.user.id }, team: { id: session.team.id }, hasPassword: true, googleManagedRecovery: true });
    expect((await h.api("POST", "/auth/password-reset/request", { email: newEmail })).status).toBe(200);
    expect(h.mail).toHaveLength(1);
  } finally {
    vi.unstubAllGlobals();
    await f.cleanup();
  }
});

it.skipIf(!url)("lets new Google users on a third-party email domain confirm that address without creating a password", async () => {
  const f = await loadingFixture(url!);
  try {
    const h = await harness(f);
    const email = "google-external@example.test";
    const { browser, result } = await h.google("external-subject", email);
    expect(result.headers.get("Location")).toBe(f.env.APP_ORIGIN + "/auth/google");
    const state = () => h.api("GET", "/auth/google/pending", undefined, browser).then(response => response.json());
    expect(await state()).toEqual({ email, mode: "verify-email" });
    expect((await h.api("POST", "/auth/google/email/request", undefined, browser)).status).toBe(200);
    expect(h.mail).toHaveLength(1);
    expect(h.mail[0].To).toBe(email);
    const confirmation = new URL(h.mail[0].TextBody.match(/https:\/\/\S+/)![0]);
    expect(confirmation.pathname).toBe("/auth/google");
    const token = confirmation.searchParams.get("token");
    expect((await h.api("POST", "/auth/google/email/verify", { token }, browser)).status).toBe(200);
    expect(await state()).toEqual({ email, mode: "signup" });
    const signup = await h.api("POST", "/auth/google/finish", { username: "external-google" }, browser);
    expect(signup.status, await signup.clone().text()).toBe(200);
    const existing = await (await h.api("GET", "/session", undefined, h.sessionCookie(signup))).json() as { user: { id: string }; team: { id: string } };
    expect(existing).toMatchObject({ authenticated: true, user: { email }, hasPassword: false, googleManagedRecovery: false });
    const returning = await h.google("external-subject", "different@gmail.com");
    expect(await (await h.api("GET", "/session", undefined, h.sessionCookie(returning.result))).json()).toMatchObject({
      user: { id: existing.user.id, email }, team: { id: existing.team.id }, googleManagedRecovery: false,
    });
  } finally {
    vi.unstubAllGlobals();
    await f.cleanup();
  }
});

it.skipIf(!url)("retires managed recovery authority and old links when the linked Google email changes", async () => {
  const f = await loadingFixture(url!);
  try {
    const h = await harness(f);
    const oldEmail = "google-old@gmail.com", newEmail = "google-current@gmail.com";
    const signup = await h.google("managed-subject", oldEmail);
    const created = await h.api("POST", "/auth/google/finish", { username: "managed-google" }, signup.browser);
    expect(created.status).toBe(200);
    const previousSession = h.sessionCookie(created);
    const initial = await (await h.api("GET", "/session", undefined, previousSession)).json() as { user: { id: string }; team: { id: string } };
    const oldProof = await h.google("managed-subject", oldEmail, previousSession);
    expect((await h.api("POST", "/auth/google/email/request", undefined, oldProof.browser)).status).toBe(200);
    const previousGoogleLink = new URL(h.mail[0].TextBody.match(/https:\/\/\S+/)![0]).searchParams.get("token");
    await f.db.pool.query("INSERT INTO app.auth_reset_tokens(digest,user_id,expires_at,purpose) VALUES($1,$2,now()+interval '1 hour','reset')",
      [await tokenDigest("outstanding-previous-link", f.env.SESSION_SIGNING_SECRET), initial.user.id]);

    const changed = await h.google("managed-subject", newEmail);
    const nextSession = h.sessionCookie(changed.result);
    expect(await (await h.api("GET", "/session", undefined, nextSession)).json()).toMatchObject({
      user: { id: initial.user.id, email: newEmail }, team: { id: initial.team.id }, hasPassword: false, googleManagedRecovery: true,
    });
    expect(await (await h.api("GET", "/session", undefined, previousSession)).json()).toEqual({ authenticated: false });
    const row = (await f.db.pool.query("SELECT used_at FROM app.auth_reset_tokens WHERE user_id=$1", [initial.user.id])).rows[0];
    expect(row.used_at).toBeInstanceOf(Date);
    const stale = await h.api("POST", "/auth/google/password/complete", { token: previousGoogleLink, password }, oldProof.browser);
    expect(stale.status).toBe(400);
    expect((await h.api("POST", "/auth/password-reset/request", { email: oldEmail })).status).toBe(200);
    expect(h.mail).toHaveLength(1);
    const freshProof = await h.google("managed-subject", newEmail, nextSession);
    expect((await h.api("POST", "/auth/google/email/request", undefined, freshProof.browser)).status).toBe(200);
    expect(h.mail.map(msg => msg.To)).toEqual([oldEmail, newEmail]);
  } finally {
    vi.unstubAllGlobals();
    await f.cleanup();
  }
});

it.skipIf(!url)("verifies a changed non-authoritative address before enabling managed password recovery", async () => {
  const f = await loadingFixture(url!);
  try {
    const h = await harness(f);
    const oldEmail = "google-managed@gmail.com", newEmail = "changed@example.test";
    const signup = await h.google("managed-external", oldEmail);
    const created = await h.api("POST", "/auth/google/finish", { username: "managed-external" }, signup.browser);
    const existing = h.sessionCookie(created);
    const fresh = await h.google("managed-external", newEmail, existing);
    expect(fresh.result.headers.get("Location")).toBe(f.env.APP_ORIGIN + "/auth/google");
    expect(await (await h.api("GET", "/session", undefined, existing)).json()).toEqual({ authenticated: false });
    expect((await h.api("POST", "/auth/google/email/request", undefined, fresh.browser)).status).toBe(200);
    expect(h.mail.map(msg => msg.To)).toEqual([newEmail]);
    const token = new URL(h.mail[0].TextBody.match(/https:\/\/\S+/)![0]).searchParams.get("token");
    const completed = await h.api("POST", "/auth/google/password/complete", { token, password }, fresh.browser);
    expect(completed.status, await completed.clone().text()).toBe(200);
    const newSession = h.sessionCookie(completed);
    expect(await (await h.api("GET", "/session", undefined, newSession)).json()).toMatchObject({
      user: { email: newEmail }, hasPassword: true, googleManagedRecovery: true,
    });
    await h.google("managed-external", newEmail);
    expect((await h.api("GET", "/session", undefined, newSession)).status).toBe(200);
    expect(await (await h.api("GET", "/session", undefined, newSession)).json()).toMatchObject({ authenticated: true, user: { email: newEmail } });
  } finally {
    vi.unstubAllGlobals();
    await f.cleanup();
  }
});

it.skipIf(!url)("keeps the managed account separate when Google later reports an address in use", async () => {
  const f = await loadingFixture(url!);
  try {
    const h = await harness(f);
    const email = "google-second@gmail.com";
    const initial = await h.google("subject-two", email);
    const created = await h.api("POST", "/auth/google/finish", { username: "google-two" }, initial.browser);
    const cookie = h.sessionCookie(created);
    const account = await (await h.api("GET", "/session", undefined, cookie)).json() as { user: { id: string }; team: { id: string } };
    const claimed = "owner-google@gmail.com";
    await f.db.pool.query("UPDATE app.auth_users SET email=$1 WHERE id=$2", [claimed, f.userId]);
    const fresh = await h.google("subject-two", claimed);
    const session = h.sessionCookie(fresh.result);
    expect(await (await h.api("GET", "/session", undefined, session)).json()).toMatchObject({ user: { id: account.user.id, email }, team: { id: account.team.id } });
    const blocked = await h.google("subject-two", claimed, session);
    expect(blocked.result.headers.get("Location")).toBe(f.env.APP_ORIGIN + "/auth/login?google=collision");
    expect(h.mail).toHaveLength(0);
    expect((await f.db.pool.query("SELECT google_recovery_suspended FROM app.auth_users WHERE id=$1", [account.user.id])).rows[0].google_recovery_suspended).toBe(true);
  } finally {
    vi.unstubAllGlobals();
    await f.cleanup();
  }
});

it.skipIf(!url)("checks the start limit before allocating a Google sign-in attempt", async () => {
  const f = await loadingFixture(url!);
  try {
    const h = await harness(f);
    vi.mocked(f.env.GOOGLE_SIGN_IN_START_LIMIT!.limit).mockResolvedValue({ success: false });
    const response = await h.api("POST", "/auth/google/start", { returnTo: "/clients" });
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect((await f.db.pool.query("SELECT * FROM app.google_sign_in_attempts")).rows).toHaveLength(0);
  } finally {
    vi.unstubAllGlobals();
    await f.cleanup();
  }
});

it.skipIf(!url)("lets Google-only owners enroll with fresh linked Google proof and requires a second factor at Google sign-in", async () => {
  const f = await loadingFixture(url!);
  try {
    const h = await harness(f);
    f.env.TOTP_ENCRYPTION_KEY = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
    const email = "google-totp@gmail.com", subject = "google-totp-subject";
    const initial = await h.google(subject, email);
    const created = await h.api("POST", "/auth/google/finish", { username: "google-totp" }, initial.browser);
    const owner = h.sessionCookie(created);
    const status = () => h.api("GET", "/auth/two-factor", undefined, owner).then(r => r.json());
    expect(await status()).toMatchObject({ enabled: false, method: "google", googleVerified: false });
    expect((await h.api("POST", "/auth/two-factor/enrollment", {}, owner)).status).toBe(401);
    const fresh = await h.google(subject, email, owner, true);
    expect(fresh.result.headers.get("Location")).toBe(f.env.APP_ORIGIN + "/settings/two-factor");
    expect(fresh.result.headers.getSetCookie()).toEqual([]);
    const prepared = await h.api("POST", "/auth/two-factor/enrollment", {}, owner + "; " + fresh.browser);
    expect(prepared.status, await prepared.clone().text()).toBe(200);
    const { secret } = await prepared.json() as { secret: string };
    const pending = prepared.headers.get("Set-Cookie")!.split(";")[0];
    const enabled = await h.api("POST", "/auth/two-factor/enable", { code: await totpAt(secret, Math.floor(Date.now() / 30_000)) }, owner + "; " + pending);
    expect(enabled.status, await enabled.clone().text()).toBe(200);
    const { recoveryCodes } = await enabled.json() as { recoveryCodes: string[] };
    const login = await h.google(subject, email);
    expect(login.result.headers.get("Location")).toBe(f.env.APP_ORIGIN + "/auth/two-factor");
    expect(h.sessionCookie(login.result)).toBe("factorize_session=");
    const challenge = login.result.headers.getSetCookie().find(row => row.startsWith("__Host-factorize_totp_login="))!.split(";")[0];
    const completed = await h.api("POST", "/auth/two-factor/challenge", { code: recoveryCodes[0] }, challenge);
    expect(completed.status, await completed.clone().text()).toBe(200);
    const authenticated = h.sessionCookie(completed);
    expect(await (await h.api("GET", "/session", undefined, authenticated)).json()).toMatchObject({ authenticated: true, user: { email } });

    const removal = await h.google(subject, email, authenticated, true);
    expect(removal.result.headers.get("Location")).toBe(f.env.APP_ORIGIN + "/settings/two-factor");
    const disabled = await h.api("POST", "/auth/two-factor/disable", { code: recoveryCodes[1] }, authenticated + "; " + removal.browser);
    expect(disabled.status, await disabled.clone().text()).toBe(200);
    expect(await (await h.api("GET", "/auth/two-factor", undefined, h.sessionCookie(disabled))).json()).toMatchObject({ enabled: false });
  } finally {
    vi.unstubAllGlobals();
    await f.cleanup();
  }
});

async function harness(f: Awaited<ReturnType<typeof loadingFixture>>) {
  const env = Object.assign(f.env, {
    GOOGLE_SIGN_IN_CLIENT_ID: "google-fixture", GOOGLE_SIGN_IN_CLIENT_SECRET: "fixture-secret",
    GOOGLE_SIGN_IN_START_LIMIT: { limit: vi.fn(async () => ({ success: true })) },
    POSTMARK_SERVER_TOKEN: "fixture", POSTMARK_FROM_EMAIL: "test@example.test", POSTMARK_MESSAGE_STREAM: "outbound",
  });
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const publicKey = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const mail: { To:string; TextBody:string }[] = [];
  let token: string;
  let challenge: string;
  let issuedAt = Math.floor(Date.now() / 1000) - 20;
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
    if (url === "https://oauth2.googleapis.com/token") {
      const body = options!.body as URLSearchParams;
      const actual = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body.get("code_verifier")!))).toString("base64url");
      expect(actual).toBe(challenge);
      expect(body.get("redirect_uri")).toBe(env.APP_ORIGIN + "/oauth/google/sign-in/callback");
      return Response.json({ id_token: token });
    }
    if (url === "https://www.googleapis.com/oauth2/v3/certs") return Response.json({ keys: [{ ...publicKey, kid: "test", alg: "RS256", use: "sig" }] });
    if (url === "https://api.postmarkapp.com/email") {
      mail.push(JSON.parse(String(options?.body)));
      return Response.json({ ErrorCode: 0 });
    }
    throw new Error("Unexpected fixture endpoint");
  }));
  const api = (method: string, path: string, body?: unknown, cookie = "") => protectedApiFetch(new Request(env.APP_ORIGIN + "/api/v1" + path, {
    method, headers: { Cookie: cookie, Origin: env.APP_ORIGIN, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  }), env, null, {} as ExecutionContext);
  const google = async (subject: string, email: string, passwordSession?: string, totpSettings = false) => {
    const start = passwordSession ? await api("POST", totpSettings ? "/auth/two-factor/google" : "/auth/password/set-request", undefined, passwordSession) : await api("POST", "/auth/google/start", { returnTo: "/clients" });
    expect(start.status, await start.clone().text()).toBe(200);
    const browser = start.headers.get("Set-Cookie")!.split(";")[0];
    const authorization = new URL((await start.json() as { authorizationUrl:string }).authorizationUrl);
    expect(authorization.origin).toBe("https://accounts.google.com");
    expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
    challenge = authorization.searchParams.get("code_challenge")!;
    const now = Math.floor(Date.now()/1000);
    const encoded = signedPart({ alg: "RS256", kid: "test" }) + "." + signedPart({
      iss: "https://accounts.google.com", sub: subject, aud: env.GOOGLE_SIGN_IN_CLIENT_ID, exp: now+3600, iat: ++issuedAt,
      email, email_verified: true, nonce: authorization.searchParams.get("nonce"),
    });
    token = encoded + "." + Buffer.from(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(encoded))).toString("base64url");
    const redirect = new URL(authorization.searchParams.get("redirect_uri")!);
    redirect.search = new URLSearchParams({ state: authorization.searchParams.get("state")!, code: "fixture-code" }).toString();
    const result = await googleSignInCallback(new Request(redirect, { headers: { Cookie: browser } }), env);
    return { browser, result };
  };
  const sessionCookie = (response: Response) => response.headers.getSetCookie().find(row => row.startsWith("factorize_session="))!.split(";")[0];
  return { google, sessionCookie, api, mail };
}
