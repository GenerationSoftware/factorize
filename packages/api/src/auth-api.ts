import { connectionFor, originalBrowser, startConnection, connectionDestination } from "./oauth-continuation";
import { inspectDevice, decideDevice, deviceConsentSignature, safeEqual } from "./device-oauth";
import { consentPreview, consentDecision, consentPreviewInput, consentDecisionInput } from "./consent-api";
import { serialize } from "hono/utils/cookie";
import { z } from "zod";
import { AuthRepository } from "./postgres/auth-repository";
import { IdentityRepository } from "./postgres/identity-repository";
import { databaseFor } from "./postgres/database";
import { readSession, requestCookie, signSession, type Session } from "./session";
import type { Env } from "./types";

export const SESSION_SCOPES = ["flows:read", "flows:write", "runs:read", "runs:write"] as const;
const email = z.string().trim().toLowerCase().email().max(320);
const password = z.string().min(12).max(200).meta({ writeOnly: true });
const connection = z.uuid().optional();
const token = z.string().min(1).max(512).meta({ writeOnly: true });
export const authInputs = {
  login: z.object({ email, password, returnTo: z.string().max(8192).optional(), connection }).strict(),
  signup: z.object({ email, password, connection }).strict(),
  request: z.object({ email, connection }).strict(),
  verify: z.object({ token }).strict(),
  reset: z.object({ token, password }).strict(),
  change: z.object({ currentPassword: password, password }).strict(),
};
export const sessionResponse = z.discriminatedUnion("authenticated", [
  z.object({ authenticated: z.literal(false) }).strict(),
  z.object({
    authenticated: z.literal(true),
    user: z.object({ id: z.string(), email: z.email() }).strict(),
    workspace: z.object({ id: z.string(), name: z.string().nullable(), role: z.literal("owner") }).strict(),
    capabilities: z.array(z.enum(SESSION_SCOPES)),
    expiresAt: z.iso.datetime(),
  }).strict(),
]);
export const authSuccess = z.object({ ok: z.literal(true) }).strict();
export const continuationSuccess = authSuccess.extend({ returnTo: z.string().optional(), crossBrowser: z.boolean().optional(), pending: z.boolean().optional(), clientName: z.string().optional(), expiresAt: z.iso.datetime().optional() });
export const connectionStartInput = z.object({ returnTo: z.string().min(1).max(8192) }).strict();
export const connectionStartSuccess = z.object({ connection: z.uuid(), clientName: z.string(), expiresAt: z.iso.datetime() });
export const connectionResumeInput = z.object({ connection: z.uuid() }).strict();
export const loginSuccess = authSuccess.extend({ returnTo: z.string() });

/** Only local application/protocol destinations; never trust a return cookie or form field. */
export function safeReturnTo(value: string | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\x00-\x20]/.test(value)) return "/settings/integrations";
  try {
    const url = new URL(value, "https://local.invalid");
    if (url.origin !== "https://local.invalid") return "/settings/integrations";
    if (!/^\/(?:authorize|device|jobs(?:\/[^/]+(?:\/(?:edit|settings))?)?|job-runs\/[^/]+|settings(?:\/(?:integrations|api-keys|password))?)$/.test(url.pathname)) return "/settings/integrations";
    return url.pathname + url.search + url.hash;
  } catch { return "/settings/integrations"; }
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
async function currentSession(request: Request, env: Env): Promise<Session | null> {
  const session = await readSession(requestCookie(request, "factorize_session"), env.SESSION_SIGNING_SECRET);
  if (!session) return null;
  const member = await new IdentityRepository(databaseFor(env), session.tenantId).member(session.userId);
  return member?.role === "owner" && member.sessionVersion === session.sessionVersion ? { ...session, email: member.email } : null;
}
export type AuthAction = "connection-start" | "connection-resume" | "session" | "login" | "signup" | "verification-request" | "verification" | "reset-request" | "reset" | "password" | "logout" | "consent-preview" | "consent-decision" | "device-preview" | "device-decision";

export async function executeAuth(action: AuthAction, request: Request, env: Env, input: Record<string, unknown> = {}): Promise<Response> {
  // These operations use browser cookies only. Ignore neither a bad bearer nor a
  // good bearer and silently fall back to a potentially unrelated browser identity.
  if (request.headers.has("Authorization")) return failure(403, "An interactive browser session is required.");
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
    const resumed = await databaseFor(env).pool.query("UPDATE app.oauth_connections SET ready=false WHERE id=$1 AND ready=true AND expires_at>now() AND used_at IS NULL RETURNING id", [pending.id]);
    if (!resumed.rows.length) return authJson({ ok: true, pending: true, clientName: pending.client_name, expiresAt: pending.expires_at.toISOString() });
    return signedIn(env, { userId: pending.user_id, email: member.email, tenantId: member.tenant_id, sessionVersion: member.session_version }, { ok: true, returnTo: connectionDestination(pending) });
  }
  if (input.connection && ["login", "signup", "verification-request", "reset-request"].includes(action)) {
    const pending = await connectionFor(env, String(input.connection));
    if (!pending || !await originalBrowser(request, env, pending)) return failure(400, "Invalid or expired connection. Restart connecting from your MCP client.");
  }
  if (action === "session" || action === "logout" || action === "password" || action === "consent-preview" || action === "consent-decision" || action === "device-preview" || action === "device-decision") {
    const session = await currentSession(request, env);
    if (action === "session") {
      if (!session) return authJson({ authenticated: false });
      const workspace = (await databaseFor(env).pool.query<{ name: string | null }>("SELECT name FROM app.tenants WHERE id=$1", [session.tenantId])).rows[0];
      return authJson(sessionResponse.parse({
        authenticated: true, user: { id: session.userId, email: session.email },
        workspace: { id: session.tenantId, name: workspace?.name ?? null, role: "owner" },
        capabilities: [...SESSION_SCOPES], expiresAt: new Date(session.exp * 1000).toISOString(),
      }));
    }
    if (action === "device-preview" || action === "device-decision") {
      if (!session) return failure(401, "Sign in before authorizing a device.");
      if (!env.OAUTH_PROVIDER) return failure(400, "Device authorization is unavailable.");
      const preview = await inspectDevice(env, String(input.userCode));
      if (!preview) return failure(400, "This device request is invalid, expired, or already completed. Start a new connection in your client.");
      const signature = await deviceConsentSignature(env, session, preview);
      if (action === "device-preview") return authJson({ ...preview, signature });
      if (!safeEqual(String(input.signature), signature)) return failure(403, "Invalid device consent. Review the device request before approving it.");
      const result = await decideDevice(env, env.OAUTH_PROVIDER, session, preview.userCode, input.decision as "allow" | "deny");
      return result ? authJson(result) : failure(400, "This device request has expired or already completed. Start a new connection in your client.");
    }
    if (action === "consent-preview" || action === "consent-decision") {
      if (!session) return failure(401, "Sign in before authorizing a client.");
      try {
        const data = action === "consent-preview" ? await consentPreview(env, session, consentPreviewInput.parse(input), request) : await consentDecision(env, session, consentDecisionInput.parse(input));
        return data ? authJson(data) : failure(400, "This authorization request is invalid, expired, or already completed. Start a new connection from your MCP client.");
      } catch { return failure(400, "This authorization request could not be validated. Return to the browser where you started connecting, or start a new connection from your MCP client."); }
    }
    if (action === "logout") {
      if (session) await new IdentityRepository(databaseFor(env), session.tenantId).revoke(session.userId);
      const response = authJson({ ok: true });
      response.headers.append("Set-Cookie", sessionCookie(env, "", 0));
      return response;
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
    let returnTo = safeReturnTo(input.returnTo as string | undefined);
    if (input.connection) {
      const pending = await connectionFor(env, String(input.connection));
      if (!pending || pending.user_id && pending.user_id !== identity.userId) return failure(403, "Sign in with the account used for this connection.");
      const bound = await databaseFor(env).pool.query("UPDATE app.oauth_connections SET user_id=$2,ready=false WHERE id=$1 AND (user_id IS NULL OR user_id=$2) AND expires_at>now() AND used_at IS NULL RETURNING id", [pending.id, identity.userId]);
      if (!bound.rows.length) return failure(400, "This connection expired or belongs to another account. Restart from your MCP client.");
      returnTo = connectionDestination(pending);
    }
    return signedIn(env, identity, { ok: true, returnTo });
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
    if (pending && sameBrowser) await databaseFor(env).pool.query("UPDATE app.oauth_connections SET ready=false WHERE id=$1", [pending.id]);
    const continuation = pending
      ? pending.kind === "device" || sameBrowser ? { returnTo: connectionDestination(pending) } : { crossBrowser: true }
      : { returnTo: identity.connection ? "/auth/login?expired=1" : "/settings/integrations" };
    return signedIn(env, identity, { ok: true, ...continuation });
  }
  if ((action === "verification" || action === "reset") && result.status === 200 && "userId" in result.body && result.body.userId && !result.body.tenantId) return failure(403, "This account needs a workspace owner invitation.");
  // The new public signup contract intentionally does not enumerate accounts.
  // Keep legacy form status compatibility until those screens are cut over.
  if (action === "signup" && (result.status === 201 || result.status === 409)) return authJson({ ok: true }, 202);
  return result.status < 300 ? authJson({ ok: true }) : failure(result.status, "error" in result.body ? result.body.error ?? "Request failed." : "Request failed.");
}

async function signedIn(env: Env, identity: { tenantId: string; userId: string; email: string; sessionVersion: number }, body: unknown) {
  const lifetime = 7 * 24 * 60 * 60;
  const response = authJson(body);
  response.headers.append("Set-Cookie", sessionCookie(env, await signSession({ tenantId: identity.tenantId, userId: identity.userId, email: identity.email, sessionVersion: identity.sessionVersion, exp: Math.floor(Date.now() / 1000) + lifetime }, env.SESSION_SIGNING_SECRET), lifetime));
  return response;
}
