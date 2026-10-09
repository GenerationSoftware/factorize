import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { Database } from "../src/postgres/database";
import { AuthRepository } from "../src/postgres/auth-repository";
import { ConnectionRepository } from "../src/postgres/connection-repository";
import { IdentityRepository } from "../src/postgres/identity-repository";
import { ApiService } from "../src/flow-service";
import { protectedApiFetch } from "../src/protected-api";
import { tokenDigest } from "../src/auth";
import { hmac } from "../src/crypto";
import { signSetupState } from "../src/github";
import app, { readSession, signSession } from "../src/index";
import type { Env } from "../src/types";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {} }));

// CI provides a disposable PostgreSQL service. Each suite owns a fresh database.
describe.skipIf(!process.env.AUTH_TEST_DATABASE_URL)("native authentication with PostgreSQL", () => {
  let db: Database, admin: Database, env: Env, auth: AuthRepository;
  const databaseName = `auth_test_${crypto.randomUUID().replaceAll("-", "")}`;
  const legacyUser = crypto.randomUUID(), legacyTenant = crypto.randomUUID();
  const password = "correct horse battery staple";
  let sent: Array<{ To: string; TextBody: string; Subject: string }> = [];
  beforeAll(async () => {
    admin = new Database({ connectionString: process.env.AUTH_TEST_DATABASE_URL });
    await admin.pool.query(`CREATE DATABASE ${databaseName}`);
    const url = new URL(process.env.AUTH_TEST_DATABASE_URL!); url.pathname = `/${databaseName}`;
    db = new Database({ connectionString: url.toString() });
    const dir = new URL("../migrations/", import.meta.url);
    for (const file of (await readdir(dir)).filter(f => f.endsWith(".sql")).sort()) {
      if (file === "0008_native_accounts.sql") {
        await new IdentityRepository(db, legacyTenant).upsertOwner(legacyUser, "Legacy@Example.test");
        await new ConnectionRepository(db, legacyTenant, btoa("a".repeat(32))).put("linear", { organizationId: legacyTenant, accessToken: "existing-token" });
      }
      await db.pool.query(await readFile(new URL(file, dir), "utf8"));
    }
    env = { ASSETS: { fetch: async () => new Response("Static entry", { headers: { "Content-Type": "text/html" } }) } as unknown as Fetcher, DATABASE: db, APP_ORIGIN: "https://factorize.test", SESSION_SIGNING_SECRET: "test-signing-secret", CREDENTIAL_ENCRYPTION_KEY: btoa("a".repeat(32)), POSTMARK_SERVER_TOKEN: "test-postmark", POSTMARK_FROM_EMAIL: "accounts@example.test", POSTMARK_MESSAGE_STREAM: "outbound", LINEAR_CLIENT_ID: "client", LINEAR_CLIENT_SECRET: "test-client-secret", LINEAR_WEBHOOK_SIGNING_SECRET: "test-webhook" } as Env;
    auth = new AuthRepository(db, env);
  });
  afterEach(() => { vi.unstubAllGlobals(); sent = []; });
  afterAll(async () => { await db?.close(); if (admin) { await admin.pool.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`); await admin.close(); } });
  function mail() {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://api.postmarkapp.com/email");
      expect(init.headers).toMatchObject({ "X-Postmark-Server-Token": "test-postmark" });
      const body = JSON.parse(String(init.body)); expect(body.MessageStream).toBe("outbound"); sent.push(body);
      return Response.json({ ErrorCode: 0 });
    }));
  }
  function token(index = sent.length - 1) { return new URL(sent[index]!.TextBody.match(/https:\/\/\S+/)![0]).searchParams.get("token")!; }
  async function registered() {
    mail(); const email = `user_${crypto.randomUUID().slice(0, 8)}@example.test`;
    expect((await auth.signup({ email, password })).status).toBe(201);
    return { email, verification: token() };
  }
  async function verified() { const user = await registered(); expect((await auth.completeVerification(user.verification)).status).toBe(200); return user; }
  async function sessionFor(email: string) {
    const login = await auth.login({ email, password }); expect(login.status).toBe(200);
    const identity = login.body as { tenantId: string; userId: string; email: string };
    const member = await new IdentityRepository(db, identity.tenantId).member(identity.userId);
    const session = { ...identity, sessionVersion: member!.sessionVersion, exp: Math.floor(Date.now() / 1000) + 3600 };
    return { ...session, cookie: `factorize_session=${await signSession(session, env.SESSION_SIGNING_SECRET)}` };
  }
  function post(path: string, body: Record<string, string>, cookie = "", origin = env.APP_ORIGIN) {
    return app.request(path, { method: "POST", headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) }, env);
  }

  async function sessionBody(cookie: string) {
    const response = await protectedApiFetch(new Request(env.APP_ORIGIN + "/api/v1/session", { headers: { Cookie: cookie } }), env, null, {} as ExecutionContext);
    return response.json();
  }

  it("serves the complete JSON native-auth lifecycle through the public dispatcher", async () => {
    mail();
    const email = `api_${crypto.randomUUID().slice(0, 8)}@example.test`;
    const json = (path: string, input?: object, cookie = "") => protectedApiFetch(
      new Request(env.APP_ORIGIN + path, {
        method: input ? "POST" : "GET",
        headers: { Origin: env.APP_ORIGIN, Cookie: cookie, "Content-Type": "application/json" },
        ...(input ? { body: JSON.stringify(input) } : {}),
      }), env, null, {} as ExecutionContext,
    );
    expect((await json("/api/v1/auth/signup", { email, password })).status).toBe(202);
    const verification = token();
    expect((await json("/api/v1/auth/signup", { email, password })).status).toBe(202);
    expect((await json("/api/v1/auth/login", { email, password })).status).toBe(403);
    expect((await json("/api/v1/auth/email-verification/complete", { token: verification })).status).toBe(200);
    expect((await json("/api/v1/auth/email-verification/complete", { token: verification })).status).toBe(400);
    const login = await json("/api/v1/auth/login", { email, password, returnTo: "/device?user_code=ABCD-EFGH" });
    expect(login.status).toBe(200);
    expect(await login.json()).toEqual({ ok: true, returnTo: "/device?user_code=ABCD-EFGH" });
    const cookie = login.headers.get("Set-Cookie")!.split(";")[0];
    const active = await (await json("/api/v1/session", undefined, cookie)).json() as any;
    expect(active).toMatchObject({ authenticated: true, user: { email }, workspace: { role: "owner" } });
    const workspaceId = active.workspace.id;
    await db.pool.query("UPDATE app.tenants SET name='API workspace' WHERE id=$1", [workspaceId]);
    expect(await (await json("/api/v1/session", undefined, cookie)).json()).toMatchObject({ workspace: { name: "API workspace" } });
    const delegate = new ApiService(env, {
      tenantId: workspaceId, userId: active.user.id,
      sessionVersion: (await new IdentityRepository(db, workspaceId).member(active.user.id))!.sessionVersion,
      scopes: ["flows:read"], authMethod: "oauth",
    });
    expect(await delegate.listJobs()).toEqual([]);
    expect((await json("/api/v1/auth/logout", {}, cookie)).status).toBe(200);
    expect(await (await json("/api/v1/session", undefined, cookie)).json()).toEqual({ authenticated: false });
    await expect(delegate.listJobs()).rejects.toMatchObject({ status: 401 });
    const next = await json("/api/v1/auth/login", { email, password });
    const nextCookie = next.headers.get("Set-Cookie")!.split(";")[0];
    expect((await json("/api/v1/auth/password-reset/request", { email })).status).toBe(200);
    const reset = token();
    expect((await json("/api/v1/auth/password-reset/complete", { token: reset, password: "replacement long password" })).status).toBe(200);
    expect(await (await json("/api/v1/session", undefined, nextCookie)).json()).toEqual({ authenticated: false });
    expect((await json("/api/v1/auth/password-reset/complete", { token: reset, password })).status).toBe(400);
    const final = await json("/api/v1/auth/login", { email, password: "replacement long password" });
    expect(final.status).toBe(200);
    const finalCookie = final.headers.get("Set-Cookie")!.split(";")[0];
    expect((await json("/api/v1/auth/password", { currentPassword: "replacement long password", password }, finalCookie)).status).toBe(200);
    expect(await (await json("/api/v1/session", undefined, finalCookie)).json()).toEqual({ authenticated: false });
  });

  it("requires an email, delivers verification, and denies access before verification", async () => {
    mail(); expect((await auth.signup({ email: "not-an-email", password })).status).toBe(400);
    const user = await registered();
    expect(sent[0]!.Subject).toBe("Verify your Factorize email");
    expect((await auth.login({ email: user.email, password })).status).toBe(403);
    expect((await auth.completeReset({ token: user.verification, password })).status).toBe(400);
    expect((await auth.completeVerification(user.verification)).status).toBe(200);
    expect((await auth.completeVerification(user.verification)).status).toBe(400);
    expect((await auth.login({ email: user.email.toUpperCase(), password })).status).toBe(200);
    expect((await auth.login({ email: user.email, password: "incorrect password" })).status).toBe(401);
    expect((await auth.signup({ email: user.email.toUpperCase(), password })).status).toBe(409);
  });
  it("signup never sets a session; email link GET does not consume verification", async () => {
    mail(); const email = `route_${crypto.randomUUID().slice(0, 8)}@example.test`;
    const response = await post("/auth/signup", { email, password });
    expect(response.status).toBe(201); expect(response.headers.get("set-cookie")).toBeNull();
    const link = token(); expect((await app.request(`/auth/verify?token=${link}`, {}, env)).status).toBe(200);
    expect((await auth.login({ email, password })).status).toBe(403);
    expect((await post("/auth/verify", { token: link })).status).toBe(303);
    const login = await post("/auth/login", { email, password }); expect(login.status).toBe(303);
    expect(login.headers.get("location")).toBe("/settings/integrations"); expect(login.headers.get("set-cookie")).toContain("HttpOnly");
    const loggedIn = await sessionFor(email);
    expect(await sessionBody(loggedIn.cookie)).toMatchObject({ authenticated: true });
  });
  it("expires verification and supports resending without changing credentials", async () => {
    const user = await registered();
    await db.pool.query("UPDATE app.auth_reset_tokens SET expires_at=now()-interval '1 second' WHERE digest=$1", [await tokenDigest(user.verification, env.SESSION_SIGNING_SECRET)]);
    expect((await auth.completeVerification(user.verification)).status).toBe(400);
    await auth.requestEmail({ email: user.email }, "verify");
    expect((await auth.completeVerification(token())).status).toBe(200);
  });
  it("sends reset email, enforces purpose and expiry, consumes once, and revokes browser sessions", async () => {
    const user = await verified(), session = await sessionFor(user.email);
    expect((await app.request("/jobs", { headers: { Cookie: session.cookie } }, env)).status).toBe(200);
    await auth.requestReset({ email: user.email }); const reset = token();
    expect((await auth.completeVerification(reset)).status).toBe(400);
    const newPassword = "replacement long password";
    expect((await auth.completeReset({ token: reset, password: newPassword })).status).toBe(200);
    expect((await auth.completeReset({ token: reset, password })).status).toBe(400);
    expect((await auth.login({ email: user.email, password })).status).toBe(401);
    expect((await auth.login({ email: user.email, password: newPassword })).status).toBe(200);
    expect(await sessionBody(session.cookie)).toEqual({ authenticated: false });
    await auth.requestReset({ email: user.email }); const expired = token();
    await db.pool.query("UPDATE app.auth_reset_tokens SET expires_at=now()-interval '1 second' WHERE digest=$1", [await tokenDigest(expired, env.SESSION_SIGNING_SECRET)]);
    expect((await auth.completeReset({ token: expired, password })).status).toBe(400);
    const count = sent.length; expect((await auth.requestReset({ email: "unknown@example.test" })).body).toEqual({ ok: true }); expect(sent).toHaveLength(count);
  });
  it("serializes concurrent attempts to redeem a reset link", async () => {
    const user = await verified(); await auth.requestReset({ email: user.email }); const reset = token();
    const outcomes = await Promise.all([auth.completeReset({ token: reset, password }), auth.completeReset({ token: reset, password })]);
    expect(outcomes.map(r => r.status).sort()).toEqual([200, 400]);
  });
  it("serializes different reset links and invalidates delegated API access", async () => {
    const user = await verified(), session = await sessionFor(user.email);
    const service = new ApiService(env, { ...session, scopes: ["flows:read"], authMethod: "oauth" });
    expect(await service.listJobs()).toEqual([]);
    await expect(new ApiService(env, { ...session, tenantId: legacyTenant, scopes: ["flows:read"], authMethod: "oauth" }).listJobs()).rejects.toMatchObject({ status: 401 });
    await auth.requestReset({ email: user.email }); const first = token();
    await auth.requestReset({ email: user.email }); const second = token();
    const outcomes = await Promise.all([auth.completeReset({ token: first, password }), auth.completeReset({ token: second, password })]);
    expect(outcomes.map(r => r.status).sort()).toEqual([200, 400]);
    await expect(service.listJobs()).rejects.toMatchObject({ status: 401 });
  });
  it("requires current password for change, rejects CSRF, and invalidates sessions on logout", async () => {
    const user = await verified(), session = await sessionFor(user.email);
    expect((await post("/auth/password-change", { currentPassword: password, password }, session.cookie, "https://evil.test")).status).toBe(403);
    expect((await post("/auth/password-change", { currentPassword: "incorrect password", password }, session.cookie)).status).toBe(401);
    const changed = await post("/auth/password-change", { currentPassword: password, password: "new changed password" }, session.cookie);
    expect(changed.status).toBe(303); expect((await auth.login({ email: user.email, password: "new changed password" })).status).toBe(200);
    expect(await sessionBody(session.cookie)).toEqual({ authenticated: false });
    const other = await verified(), active = await sessionFor(other.email);
    expect((await post("/auth/logout", {}, active.cookie)).status).toBe(302);
    expect(await sessionBody(active.cookie)).toEqual({ authenticated: false });
  });
  it("migrates legacy Linear users through email proof while preserving workspace and connection", async () => {
    mail();
    expect((await auth.signup({ email: "legacy@example.test", password })).status).toBe(409);
    await auth.requestReset({ email: "legacy@example.test" });
    expect((await auth.completeReset({ token: token(), password })).status).toBe(200);
    const login = await auth.login({ email: "legacy@example.test", password });
    expect(login.body).toMatchObject({ userId: legacyUser, tenantId: legacyTenant });
    expect(await new ConnectionRepository(db, legacyTenant, env.CREDENTIAL_ENCRYPTION_KEY).get("linear")).toMatchObject({ accessToken: "existing-token" });
    expect((await db.pool.query("SELECT tenant_id FROM app.linear_workspaces WHERE organization_id=$1", [legacyTenant])).rows[0].tenant_id).toBe(legacyTenant);
  });
  it("does not promote legacy members on reset or accept a cookie for another tenant", async () => {
    const userId = crypto.randomUUID(); await new IdentityRepository(db, legacyTenant).upsertOwner(userId, "member@example.test");
    mail(); await auth.requestReset({ email: "member@example.test" });
    expect((await auth.completeReset({ token: token(), password })).status).toBe(200);
    expect((await auth.login({ email: "member@example.test", password })).status).toBe(403);
    const user = await verified(), session = await sessionFor(user.email);
    const forgedTenantCookie = await signSession({ ...session, tenantId: legacyTenant }, env.SESSION_SIGNING_SECRET);
    expect(await sessionBody(`factorize_session=${forgedTenantCookie}`)).toEqual({ authenticated: false });
  });
  it("uses native login as the primary entry and requires authentication to connect Linear", async () => {
    const home = await app.request("/", {}, env);
    expect(home.status).toBe(200); expect(home.headers.get("Content-Type")).toContain("text/html");
    expect((await app.request("/auth/linear", {}, env)).headers.get("location")).toBe("/auth/login");
    expect((await app.request("/auth/linear/callback?code=fake&state=fake", {}, env)).status).toBe(400);
  });
  it("binds Linear OAuth to the authenticated account and routes webhooks through the explicit mapping", async () => {
    const user = await verified(), session = await sessionFor(user.email), organizationId = crypto.randomUUID();
    const start = await app.request("/auth/linear", { headers: { Cookie: session.cookie } }, env);
    const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
    const cookie = `${session.cookie}; linear_oauth_state=${encodeURIComponent(state)}`;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("/oauth/token") ? Response.json({ access_token: "new-token", refresh_token: "refresh" }) : Response.json({ data: { viewer: { id: crypto.randomUUID(), email: "linear@example.test" }, organization: { id: organizationId, name: "Workspace" } } })));
    const callback = await app.request(`/auth/linear/callback?code=code&state=${encodeURIComponent(state)}`, { headers: { Cookie: cookie } }, env);
    expect(callback.status).toBe(302); expect(callback.headers.get("location")).toBe("/settings/integrations");
    expect(callback.headers.get("set-cookie")).not.toContain("factorize_session");
    expect((await db.pool.query("SELECT tenant_id FROM app.linear_workspaces WHERE organization_id=$1", [organizationId])).rows[0].tenant_id).toBe(session.tenantId);
    expect(await new ConnectionRepository(db, session.tenantId, env.CREDENTIAL_ENCRYPTION_KEY).get("linear")).toMatchObject({ organizationId });
    const raw = JSON.stringify({ organizationId, webhookTimestamp: Date.now(), type: "Issue", action: "create" });
    const webhook = await app.request("/webhooks/linear", { method: "POST", body: raw, headers: { "linear-delivery": "delivery", "linear-signature": Buffer.from(await hmac(raw, env.LINEAR_WEBHOOK_SIGNING_SECRET), "base64").toString("hex") } }, env);
    expect(webhook.status).toBe(200);
    expect((await db.pool.query("SELECT tenant_id FROM app.webhook_deliveries WHERE delivery_id='linear:delivery'")).rows[0].tenant_id).toBe(session.tenantId);
    const other = await verified(), otherSession = await sessionFor(other.email);
    expect((await app.request(`/auth/linear/callback?code=code&state=${encodeURIComponent(state)}`, { headers: { Cookie: `${otherSession.cookie}; linear_oauth_state=${encodeURIComponent(state)}` } }, env)).status).toBe(400);
    expect(await new ConnectionRepository(db, otherSession.tenantId, env.CREDENTIAL_ENCRYPTION_KEY).putLinear(organizationId, {})).toBe(false);
    expect(await new ConnectionRepository(db, otherSession.tenantId, env.CREDENTIAL_ENCRYPTION_KEY).get("linear")).toBeNull();
    const expired = await signSetupState({ tenantId: session.tenantId, userId: session.userId, nonce: "expired", exp: 1 }, env.SESSION_SIGNING_SECRET);
    expect((await app.request(`/auth/linear/callback?code=code&state=${expired}`, { headers: { Cookie: `${session.cookie}; linear_oauth_state=${expired}` } }, env)).status).toBe(400);
    expect(await readSession(session.cookie.slice("factorize_session=".length), env.SESSION_SIGNING_SECRET)).toMatchObject({ tenantId: session.tenantId });
  });
  it("fails closed on missing Postmark configuration and allows retry after delivery failure", async () => {
    const broken = new AuthRepository(db, { ...env, POSTMARK_SERVER_TOKEN: undefined });
    await expect(broken.signup({ email: "config@example.test", password })).rejects.toThrow("Authentication email requires");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ErrorCode: 400 }, { status: 422 })));
    await expect(auth.signup({ email: "retry@example.test", password })).rejects.toThrow("Postmark");
    expect((await auth.login({ email: "retry@example.test", password })).status).toBe(403);
    mail(); await auth.requestEmail({ email: "retry@example.test" }, "verify");
    expect((await auth.completeVerification(token())).status).toBe(200);
  });
});
