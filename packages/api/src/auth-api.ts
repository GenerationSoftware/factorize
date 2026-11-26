import { beginTotpEnrollment, beginTotpLogin, clearTotpEnrollCookie, clearTotpLoginCookie, disableTotp, enableTotp, finishTotpLogin, totpStatus } from "./totp";
import { clearGoogleCookie, finishGooglePassword, finishGoogleSignIn, googleEnabled, googlePending, googleUsernameAvailable, redeemGoogleCallback, requestGoogleEmail, startGoogleSignIn, verifyGoogleEmail, type GoogleIdentity } from "./google-sign-in";
import { GoogleCallbackFailure, reportGoogleCallbackFailure } from "./google-callback-diagnostics";
import { usernameSchema } from "./usernames";
import { integrationConsentLabels } from "./agent-api";
import { ACCESS_SCOPES } from "./access-tokens";
import { connectionFor, originalBrowser, startConnection, connectionDestination } from "./oauth-continuation";
import { inspectDevice, decideDevice, deviceConsentSignature, safeEqual } from "./device-oauth";
import { ConsentPreviewError, consentPreview, consentDecision, consentPreviewInput, consentDecisionInput } from "./consent-api";
import { serialize } from "hono/utils/cookie";
import { z } from "zod";
import { AuthRepository } from "./postgres/auth-repository";
import { IdentityRepository } from "./postgres/identity-repository";
import { databaseFor } from "./postgres/database";
import { requestCookie, signSession, type Session } from "./session";
import { readBrowserSession, revokeBrowserSession } from "./browser-session";
import type { Env } from "./types";

export const SESSION_SCOPES = [...ACCESS_SCOPES, "apps:manage"] as const;
const email = z.string().trim().toLowerCase().email().max(320);
const password = z.string().min(12).max(200).meta({ writeOnly: true });
const connection = z.uuid().optional();
const token = z.string().min(1).max(512).meta({ writeOnly: true });
export const authInputs = {
  login: z.object({ email: z.string().trim().toLowerCase().min(1).max(320), password, returnTo: z.string().max(8192).optional(), connection }).strict(),
  signup: z.object({ email, username: usernameSchema, password, connection }).strict(),
  request: z.object({ email, connection }).strict(),
  verify: z.object({ token }).strict(),
  reset: z.object({ token, password }).strict(),
  googleStart: z.object({ returnTo: z.string().max(8192).optional(), connection }).strict(),
  googleFinish: z.union([z.object({ username: usernameSchema }).strict(), z.object({ password }).strict()]),
  googleUsername: z.object({ username: usernameSchema }).strict(),
  totpBegin: z.object({ password: password.optional() }).strict(),
  totpEnroll: z.object({ code: z.string().trim().regex(/^\d{6}$/) }).strict(),
  totpCode: z.object({ code: z.string().trim().min(1).max(64) }).strict(),
  totpDisable: z.object({ password: password.optional(), code: z.string().trim().min(1).max(64) }).strict(),
  change: z.object({ currentPassword: password, password }).strict(),
};
export const sessionResponse = z.discriminatedUnion("authenticated", [
  z.object({ authenticated: z.literal(false) }).strict(),
  z.object({
    authenticated: z.literal(true),
    user: z.object({ id: z.string(), email: z.email() }).strict(),
    team: z.object({ id: z.string(), name: z.string().nullable(), role: z.literal("owner") }).strict(),
    capabilities: z.array(z.enum(SESSION_SCOPES)),
    expiresAt: z.iso.datetime(),
    googleManagedRecovery: z.boolean().optional(),
    hasPassword: z.boolean().optional(),
  }).strict(),
]);
export const authSuccess = z.object({ ok: z.literal(true) }).strict();
export const continuationSuccess = authSuccess.extend({ returnTo: z.string().optional(), crossBrowser: z.boolean().optional(), pending: z.boolean().optional(), clientName: z.string().optional(), expiresAt: z.iso.datetime().optional() });
export const connectionStartInput = z.object({ returnTo: z.string().min(1).max(8192) }).strict();
export const connectionStartSuccess = z.object({ connection: z.uuid(), clientName: z.string(), expiresAt: z.iso.datetime() });
export const connectionResumeInput = z.object({ connection: z.uuid() }).strict();
export const googleAvailability = z.object({ enabled: z.boolean() });
export const googleStartResult = z.object({ authorizationUrl: z.url() });
export const googlePendingResult = z.object({ email: z.email(), mode: z.enum(["link", "signup", "verify-email", "set-password"]) });
export const googleUsernameResult = z.object({ available: z.boolean() });
export const loginSuccess = authSuccess.extend({ returnTo: z.string() });

export const totpStatusResponse = z.object({ enabled: z.boolean(), available: z.boolean(), method: z.enum(["password", "google", "unavailable"]), googleVerified: z.boolean() });
export const totpSetupResponse = z.object({ secret: z.string(), uri: z.string() });
export const totpEnabledResponse = authSuccess.extend({ recoveryCodes: z.array(z.string()).length(10) });

/** Only local application/protocol destinations; never trust a return cookie or form field. */
export function safeReturnTo(value: string | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\x00-\x20]/.test(value)) return "/integrations";
  try {
    const url = new URL(value, "https://local.invalid");
    if (url.origin !== "https://local.invalid") return "/integrations";
    if (!/^\/(?:authorize|device|integrations|events|vms|app-consent|clients(?:\/[^/]+)?|apps(?:\/registered)?|workloads(?:\/[^/]+)?|triggers(?:\/[^/]+(?:\/(?:edit|settings(?:\/(?:general|context|events))?))?)?|settings(?:\/(?:two-factor|profile|permissions|apps|integrations|api-keys(?:\/new)?|authorized-clients|password))?)$/.test(url.pathname)) return "/integrations";
    return url.pathname + url.search + url.hash;
  } catch { return "/integrations"; }
}

export function validBrowserOrigin(request: Request, env: Env): boolean {
  return request.headers.get("Origin") === env.APP_ORIGIN && request.headers.get("Sec-Fetch-Site") !== "cross-site";
}
export function authJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "X-Factorize-Contract": "gen-2157-static-v1", "X-Factorize-Webhook-Conditions": "v1", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", Pragma: "no-cache" } });
}
const failure = (status: number, message: string) => authJson({ error: { code: status === 401 ? "invalid_token" : status === 403 ? "forbidden" : "invalid_request", message } }, status);
function sessionCookie(env: Env, value: string, maxAge: number): string {
  return serialize("factorize_session", value, { httpOnly: true, secure: new URL(env.APP_ORIGIN).protocol === "https:", sameSite: "Lax", path: "/", maxAge });
}
async function limitGoogleStart(request: Request, env: Env) {
  if (!env.GOOGLE_SIGN_IN_START_LIMIT) return failure(503, "Google sign-in is temporarily unavailable.");
  // Cloudflare sets CF-Connecting-IP on ingress. Do not trust X-Forwarded-For.
  const { success } = await env.GOOGLE_SIGN_IN_START_LIMIT.limit({ key: request.headers.get("CF-Connecting-IP") ?? "unknown" });
  if (success) return null;
  const response = failure(429, "Too many Google sign-in attempts. Try again in a minute.");
  response.headers.set("Retry-After", "60");
  return response;
}
async function currentSession(request: Request, env: Env): Promise<Session | null> {
  const session = await readBrowserSession(request, env);
  if (!session) return null;
  const member = await new IdentityRepository(databaseFor(env), session.tenantId).member(session.userId);
  return member?.role === "owner" && member.sessionVersion === session.sessionVersion ? { ...session, email: member.email } : null;
}
export type AuthAction = "totp-status" | "totp-google" | "totp-begin" | "totp-enable" | "totp-disable" | "totp-challenge" | "google-available" | "google-start" | "google-pending" | "google-username" | "google-email-request" | "google-email-verify" | "google-password-complete" | "google-finish" | "password-set-request" | "profile" | "profile-update" | "connection-start" | "connection-resume" | "session" | "login" | "signup" | "verification-request" | "verification" | "reset-request" | "reset" | "password" | "logout" | "consent-preview" | "consent-decision" | "device-preview" | "device-decision";

export async function executeAuth(action: AuthAction, request: Request, env: Env, input: Record<string, unknown> = {}): Promise<Response> {
  // These operations use browser cookies only. Ignore neither a bad bearer nor a
  // good bearer and silently fall back to a potentially unrelated browser identity.
  if (request.headers.has("Authorization")) return failure(403, "An interactive browser session is required.");
  if (action === "totp-challenge") {
    const result = await finishTotpLogin(request, env, authInputs.totpCode.parse(input).code);
    if ("status" in result) return failure(result.status, result.message);
    let returnTo = result.returnTo;
    const next = new URL(returnTo, env.APP_ORIGIN);
    const connectionId = ["/authorize", "/device"].includes(next.pathname) ? next.searchParams.get("connection") : null;
    if (connectionId) {
      const pending = await connectionFor(env, connectionId);
      const sameBrowser = pending ? await originalBrowser(request, env, pending) : false;
      if (!pending || (pending.user_id && pending.user_id !== result.identity.userId) ||
          (!sameBrowser && (pending.kind !== "device" || pending.user_id !== result.identity.userId))) {
        returnTo = "/auth/login?expired=1";
      } else if (sameBrowser && !await bindInteractiveConnection(env, pending.id, result.identity.userId)) {
        returnTo = "/auth/login?expired=1";
      }
    }
    const response = await issueSession(env, result.identity, { ok: true, returnTo });
    response.headers.append("Set-Cookie", clearTotpLoginCookie(env));
    return response;
  }
  if (action.startsWith("totp-")) {
    const session = await currentSession(request, env);
    if (!session) return failure(401, "Sign in to manage two-factor authentication.");
    if (action === "totp-status") return authJson(await totpStatus(request, env, session));
    if (action === "totp-google") {
      const status = await totpStatus(request, env, session);
      if (status.method !== "google") return failure(403, "Confirm your current Factorize password instead.");
      const limited = await limitGoogleStart(request, env);
      if (limited) return limited;
      const { cookie, authorizationUrl } = await startGoogleSignIn(env, "/settings/two-factor", undefined, session.userId, session.sessionVersion);
      const response = authJson({ authorizationUrl });
      response.headers.append("Set-Cookie", cookie);
      return response;
    }
    if (action === "totp-begin") {
      const result = await beginTotpEnrollment(request, env, session, authInputs.totpBegin.parse(input).password);
      if ("status" in result) return failure(result.status, result.message);
      const response = authJson({ secret: result.secret, uri: result.uri });
      response.headers.append("Set-Cookie", result.cookie);
      return response;
    }
    if (action === "totp-enable" || action === "totp-disable") {
      const result = action === "totp-enable" ? await enableTotp(request, env, session, authInputs.totpEnroll.parse(input).code)
        : await disableTotp(request, env, session, authInputs.totpDisable.parse(input));
      if ("status" in result) return failure(result.status, result.message);
      // The user proved every required factor in this already signed-in browser.
      const response = await issueSession(env, result.identity, "recoveryCodes" in result ? { ok: true, recoveryCodes: result.recoveryCodes } : { ok: true });
      response.headers.append("Set-Cookie", clearTotpEnrollCookie(env));
      return response;
    }
  }
  if (action === "google-available") return authJson({ enabled: googleEnabled(env) });
  if (action.startsWith("google-")) {
    if (!googleEnabled(env)) return failure(404, "Google sign-in is not available.");
    if (action === "google-start") {
      const limited = await limitGoogleStart(request, env);
      if (limited) return limited;
      const parsed = authInputs.googleStart.parse(input);
      if (parsed.connection) {
        const pending = await connectionFor(env, parsed.connection);
        if (!pending || !await originalBrowser(request, env, pending)) return failure(400, "This connection expired. Restart from your MCP client.");
      }
      const { cookie, authorizationUrl } = await startGoogleSignIn(env, safeReturnTo(parsed.returnTo), parsed.connection);
      const response = authJson({ authorizationUrl });
      response.headers.append("Set-Cookie", cookie);
      return response;
    }
    if (action === "google-pending") {
      const pending = await googlePending(request, env);
      return pending ? authJson(pending) : failure(400, "This Google sign-in expired. Start again from Factorize.");
    }
    if (action === "google-email-request") {
      return await requestGoogleEmail(request, env) ? authJson({ ok: true }) : failure(400, "This Google signup expired. Start again from Factorize.");
    }
    if (action === "google-email-verify") {
      return await verifyGoogleEmail(request, env, authInputs.verify.parse(input).token) ? authJson({ ok: true })
        : failure(400, "This link is invalid or expired. Open it in the browser where you started Google signup, or start again.");
    }
    if (action === "google-username") {
      const available = await googleUsernameAvailable(request, env, authInputs.googleUsername.parse(input).username);
      return available === null ? failure(400, "This Google signup expired. Start again from Factorize.") : authJson({ available });
    }
    if (action === "google-password-complete") {
      const result = await finishGooglePassword(request, env, authInputs.reset.parse(input));
      if ("status" in result) return failure(result.status, result.message);
      const response = await signedIn(env, result.identity, { ok: true, returnTo: "/settings/password" });
      response.headers.append("Set-Cookie", clearGoogleCookie(env));
      return response;
    }
    if (action === "google-finish") {
      const result = await finishGoogleSignIn(request, env, authInputs.googleFinish.parse(input));
      if ("status" in result) return failure(result.status, result.message);
      const response = await completeInteractiveSignIn(request, env, result.identity, result.returnTo, result.connection);
      response.headers.append("Set-Cookie", clearGoogleCookie(env));
      return response;
    }
  }
  if (action === "password-set-request") {
    const session = await currentSession(request, env);
    if (!session) return failure(401, "Sign in before setting a password.");
    if (!googleEnabled(env)) return failure(404, "Google sign-in is not available.");
    const limited = await limitGoogleStart(request, env);
    if (limited) return limited;
    const account = (await databaseFor(env).pool.query<{ google_recovery_managed: boolean; google_linked: boolean; has_password: boolean }>(`SELECT google_recovery_managed,
      EXISTS (SELECT 1 FROM app.auth_accounts WHERE user_id=u.id AND provider='google') google_linked,
      EXISTS (SELECT 1 FROM app.auth_accounts WHERE user_id=u.id AND provider='credential' AND password_hash IS NOT NULL) has_password
      FROM app.auth_users u WHERE id=$1`, [session.userId])).rows[0];
    if (!account?.google_linked) return failure(400, "Use password recovery for this account.");
    if (account.has_password && !account.google_recovery_managed) return failure(409, "You already have a password. Use Change password instead.");
    const { cookie, authorizationUrl } = await startGoogleSignIn(env, "/settings/password", undefined, session.userId);
    const response = authJson({ authorizationUrl });
    response.headers.append("Set-Cookie", cookie);
    return response;
  }
  if (action === "connection-start") {
    try {
      const started = await startConnection(request, env, String(input.returnTo));
      if (!started) return failure(400, "Invalid or expired MCP request. Restart connecting from your client.");
      const { cookie, ...body } = started;
      const response = authJson(body); response.headers.append("Set-Cookie", cookie); return response;
    } catch { return failure(400, "Invalid MCP request. Restart connecting from your client."); }
  }
  if (action === "connection-resume") {
    const pending = await connectionFor(env, String(input.connection));
    if (!pending || !await originalBrowser(request, env, pending)) return failure(400, "Invalid or expired connection. Restart connecting from your MCP client.");
    if (!pending.ready || !pending.user_id) {
      // A refresh after the one-time session handoff must still reach consent.
      const session = pending.user_id ? await currentSession(request, env) : null;
      if (session?.userId === pending.user_id) return authJson({ ok: true, returnTo: connectionDestination(pending) });
      return authJson({ ok: true, pending: true, clientName: pending.client_name, expiresAt: pending.expires_at.toISOString() });
    }
    const member = (await databaseFor(env).pool.query<{ tenant_id: string; session_version: number; email: string }>("SELECT m.tenant_id,m.session_version,u.email FROM app.members m JOIN app.auth_users u ON u.id=m.user_id WHERE m.user_id=$1 AND m.role='owner' AND u.email_verified ORDER BY m.created_at,m.tenant_id LIMIT 1", [pending.user_id])).rows[0];
    if (!member || member.session_version !== pending.ready_version) return failure(403, "This verification session was revoked. Sign in again to continue.");
    const identity = { userId: pending.user_id, email: member.email, tenantId: member.tenant_id, sessionVersion: member.session_version };
    const handoff = { ok: true, returnTo: connectionDestination(pending) };
    const challenge = await challengeFor(env, identity, handoff.returnTo);
    if (challenge) return challenge;
    const resumed = await databaseFor(env).pool.query("UPDATE app.oauth_connections SET ready=false WHERE id=$1 AND ready=true AND expires_at>now() AND used_at IS NULL RETURNING id", [pending.id]);
    if (!resumed.rows.length) return authJson({ ok: true, pending: true, clientName: pending.client_name, expiresAt: pending.expires_at.toISOString() });
    return issueSession(env, identity, handoff);
  }
  if (input.connection && ["login", "signup", "verification-request", "reset-request"].includes(action)) {
    const pending = await connectionFor(env, String(input.connection));
    if (!pending || !await originalBrowser(request, env, pending)) return failure(400, "Invalid or expired connection. Restart connecting from your MCP client.");
  }
  if (action === "logout") {
    await revokeBrowserSession(request, env);
    const response = authJson({ ok: true });
    response.headers.append("Set-Cookie", clearTotpLoginCookie(env));
    response.headers.append("Set-Cookie", sessionCookie(env, "", 0));
    return response;
  }
  if (action === "profile" || action === "profile-update" || action === "session" || action === "password" || action === "consent-preview" || action === "consent-decision" || action === "device-preview" || action === "device-decision") {
    const session = await currentSession(request, env);
    if (action === "profile" || action === "profile-update") {
      if (!session) return failure(401, "Sign in to manage your profile.");
      const repo = new AuthRepository(databaseFor(env), env);
      if (action === "profile") return authJson(await repo.profile(session.userId));
      const result = await repo.updateProfile(session.userId, String(input.username));
      return result.status === 200 ? authJson(result.body) : failure(result.status, (result.body as {error:string}).error);
    }
    if (action === "session") {
      if (!session) return authJson({ authenticated: false });
      const workspace = (await databaseFor(env).pool.query<{ name: string | null; has_password: boolean; google_managed_recovery: boolean }>(`SELECT name,
        (SELECT google_recovery_managed FROM app.auth_users WHERE id=$2) google_managed_recovery, EXISTS (SELECT 1 FROM app.auth_accounts
        WHERE user_id=$2 AND provider='credential' AND password_hash IS NOT NULL) has_password FROM app.tenants WHERE id=$1`, [session.tenantId, session.userId])).rows[0];
      return authJson(sessionResponse.parse({
        authenticated: true, user: { id: session.userId, email: session.email },
        team: { id: session.tenantId, name: workspace?.name ?? null, role: "owner" },
        capabilities: [...SESSION_SCOPES], hasPassword: workspace?.has_password, googleManagedRecovery: workspace?.google_managed_recovery, expiresAt: new Date(session.exp * 1000).toISOString(),
      }));
    }
    if (action === "device-preview" || action === "device-decision") {
      if (!session) return failure(401, "Sign in before authorizing a device.");
      if (!env.OAUTH_PROVIDER) return failure(400, "Device authorization is unavailable.");
      const preview = await inspectDevice(env, String(input.userCode));
      if (!preview) return failure(400, "This device request is invalid, expired, or already completed. Start a new connection in your client.");
      const signature = await deviceConsentSignature(env, session, preview);
      if (action === "device-preview") return authJson({ ...preview, signature, integrationLabels: await integrationConsentLabels(env, session.tenantId, preview.scopes) });
      if (!safeEqual(String(input.signature), signature)) return failure(403, "Invalid device consent. Review the device request before approving it.");
      const result = await decideDevice(env, env.OAUTH_PROVIDER, session, preview.userCode, input.decision as "allow" | "deny");
      return result ? authJson(result) : failure(400, "This device request has expired or already completed. Start a new connection in your client.");
    }
    if (action === "consent-preview" || action === "consent-decision") {
      if (!session) return failure(401, "Sign in before authorizing a client.");
      try {
        const data = action === "consent-preview" ? await consentPreview(env, session, consentPreviewInput.parse(input), request) : await consentDecision(env, session, consentDecisionInput.parse(input), request);
        return data ? authJson(data) : failure(400, "This approval is no longer current. Reload the request and review the permissions again. If the connection link has expired or was already used, start Reconnect in your MCP client.");
      } catch (error) {
        if (error instanceof ConsentPreviewError) return failure(400, error.message);
        return failure(400, "Factorize couldn't validate this connection. Start Reconnect in your MCP client and use the fresh authorization link.");
      }
    }
    if (!session) return failure(401, "The request is not authorized.");
    const result = await new AuthRepository(databaseFor(env), env).changePassword(session.userId, input);
    if (result.status !== 200) return failure(result.status, "error" in result.body ? result.body.error : "Password change failed.");
    const response = authJson({ ok: true });
    response.headers.append("Set-Cookie", sessionCookie(env, "", 0));
    return response;
  }
  const repo = new AuthRepository(databaseFor(env), env);
  if (action === "login") {
    const result = await repo.login(input);
    if (result.status !== 200 || !result.body.userId || !result.body.tenantId || !result.body.email || result.body.sessionVersion === undefined) return failure(result.status, "error" in result.body ? (result.body.error ?? "Sign in failed.") : "Sign in failed.");
    const identity = result.body as { userId: string; tenantId: string; email: string; sessionVersion: number; connection?: string };
    const member = await new IdentityRepository(databaseFor(env), identity.tenantId).member(identity.userId);
    if (member?.role !== "owner" || member.sessionVersion !== identity.sessionVersion) return failure(403, "This account cannot access the workspace.");
    return completeInteractiveSignIn(request, env, identity, safeReturnTo(input.returnTo as string | undefined), input.connection as string | undefined);
  }
  const result = action === "signup" ? await repo.signup(input)
    : action === "verification-request" ? await repo.requestEmail(input, "verify")
    : action === "verification" ? await repo.completeVerification(String(input.token))
    : action === "reset-request" ? await repo.requestReset(input)
    : await repo.completeReset(input);
  if ((action === "verification" || action === "reset") && result.status === 200 && "userId" in result.body && result.body.userId && result.body.email && result.body.tenantId && result.body.sessionVersion !== undefined) {
    const identity = result.body as { userId: string; tenantId: string; email: string; sessionVersion: number; connection?: string };
    const member = await new IdentityRepository(databaseFor(env), identity.tenantId).member(identity.userId);
    if (member?.role !== "owner" || member.sessionVersion !== identity.sessionVersion) return failure(403, "This account cannot access the workspace.");
    const pending = identity.connection ? await connectionFor(env, identity.connection) : null;
    const sameBrowser = pending ? await originalBrowser(request, env, pending) : false;
    const continuation = pending
      ? pending.kind === "device" || sameBrowser ? { returnTo: connectionDestination(pending) } : { crossBrowser: true }
      : { returnTo: identity.connection ? "/auth/login?expired=1" : "/integrations" };
    const challenge = await challengeFor(env, identity, continuation.returnTo ?? "/integrations");
    if (challenge) return challenge;
    if (pending && sameBrowser) await databaseFor(env).pool.query("UPDATE app.oauth_connections SET ready=false WHERE id=$1", [pending.id]);
    return issueSession(env, identity, { ok: true, ...continuation });
  }
  if ((action === "verification" || action === "reset") && result.status === 200 && "userId" in result.body && result.body.userId && !result.body.tenantId) return failure(403, "This account needs a workspace owner invitation.");
  // The new public signup contract intentionally does not enumerate accounts.
  // Keep legacy form status compatibility until those screens are cut over.
  if (action === "signup" && (result.status === 201 || result.status === 409 && (!("error" in result.body) || result.body.error !== "That username is already taken."))) return authJson({ ok: true }, 202);
  return result.status < 300 ? authJson({ ok: true }) : failure(result.status, "error" in result.body ? result.body.error ?? "Request failed." : "Request failed.");
}

async function bindInteractiveConnection(env: Env, id: string, userId: string) {
  return !!(await databaseFor(env).pool.query(`UPDATE app.oauth_connections SET user_id=$2,ready=false
    WHERE id=$1 AND (user_id IS NULL OR user_id=$2) AND expires_at>now() AND used_at IS NULL RETURNING id`, [id, userId])).rows.length;
}

async function completeInteractiveSignIn(request: Request, env: Env, identity: GoogleIdentity, returnTo: string, connection?: string) {
  if (connection) {
    const pending = await connectionFor(env, connection);
    if (!pending || !await originalBrowser(request, env, pending)) return failure(400, "This connection expired. Restart from your MCP client.");
    if (pending.user_id && pending.user_id !== identity.userId) return failure(403, "Sign in with the account used for this connection.");
    returnTo = connectionDestination(pending);
    const challenge = await challengeFor(env, identity, returnTo);
    if (challenge) return challenge;
    if (!await bindInteractiveConnection(env, pending.id, identity.userId)) return failure(400, "This connection expired or belongs to another account. Restart from your MCP client.");
    return issueSession(env, identity, { ok: true, returnTo });
  }
  return signedIn(env, identity, { ok: true, returnTo });
}

export async function googleSignInCallback(request: Request, env: Env) {
  if (request.method !== "GET") return new Response(null, { status: 405, headers: { Allow: "GET" } });
  const redirect = (target: string) => new Response(null, { status: 303, headers: {
    Location: new URL(target, env.APP_ORIGIN).href, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
  } });
  if (request.headers.has("Authorization")) {
    reportGoogleCallbackFailure(request, "authorization_header");
    return redirect("/auth/login?google=failed");
  }
  try {
    const result = await redeemGoogleCallback(request, env);
    if ("status" in result) return redirect(result.status === 409 ? "/auth/login?google=collision" : result.status === 403 ? "/auth/login?google=account" : "/auth/login?google=failed");
    if ("totpSettings" in result) return redirect("/settings/two-factor");
    if ("pending" in result) return redirect("/auth/google");
    const signed = await completeInteractiveSignIn(request, env, result.identity, result.returnTo, result.connection);
    if (!signed.ok) {
      reportGoogleCallbackFailure(request, "connection_unavailable");
      return redirect("/auth/login?google=connection");
    }
    const { returnTo } = loginSuccess.parse(await signed.json());
    const response = redirect(returnTo);
    for (const value of signed.headers.getSetCookie()) response.headers.append("Set-Cookie", value);
    response.headers.append("Set-Cookie", clearGoogleCookie(env));
    return response;
  } catch (error) {
    reportGoogleCallbackFailure(request, error instanceof GoogleCallbackFailure ? error.code : "session_completion");
    // Never reflect provider errors, authorization codes, or token data.
    return redirect("/auth/login?google=failed");
  }
}

async function challengeFor(env: Env, identity: GoogleIdentity, returnTo: string) {
  const challenge = await beginTotpLogin(env, identity, returnTo);
  if (challenge === null) return null;
  if (challenge === false) return failure(429, "Too many two-factor requests. Wait five minutes and try again.");
  const response = authJson({ ok: true, returnTo: "/auth/two-factor" });
  response.headers.append("Set-Cookie", sessionCookie(env, "", 0));
  response.headers.append("Set-Cookie", challenge);
  return response;
}

async function signedIn(env: Env, identity: GoogleIdentity, body: { ok?: boolean; returnTo?: string; crossBrowser?: boolean }) {
  return await challengeFor(env, identity, body.returnTo ?? "/integrations") ?? issueSession(env, identity, body);
}

async function issueSession(env: Env, identity: GoogleIdentity, body: unknown) {
  const lifetime = 7 * 24 * 60 * 60;
  const response = authJson(body);
  response.headers.append("Set-Cookie", sessionCookie(env, await signSession({ tenantId: identity.tenantId, userId: identity.userId, email: identity.email, sessionVersion: identity.sessionVersion, browserNonce: crypto.randomUUID(), exp: Math.floor(Date.now() / 1000) + lifetime }, env.SESSION_SIGNING_SECRET), lifetime));
  return response;
}
