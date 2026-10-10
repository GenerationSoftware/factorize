import { inspectDevice, decideDevice } from "./device-oauth";
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
const token = z.string().min(1).max(512).meta({ writeOnly: true });
export const authInputs = {
  login: z.object({ email, password, returnTo: z.string().max(4096).optional() }).strict(),
  signup: z.object({ email, password }).strict(),
  request: z.object({ email }).strict(),
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
export type AuthAction = "session" | "login" | "signup" | "verification-request" | "verification" | "reset-request" | "reset" | "password" | "logout" | "consent-preview" | "consent-decision" | "device-preview" | "device-decision";

export async function executeAuth(action: AuthAction, request: Request, env: Env, input: Record<string, unknown> = {}): Promise<Response> {
  // These operations use browser cookies only. Ignore neither a bad bearer nor a
  // good bearer and silently fall back to a potentially unrelated browser identity.
  if (request.headers.has("Authorization")) return failure(403, "An interactive browser session is required.");
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
      const result = action === "device-preview" ? await inspectDevice(env, String(input.userCode)) : await decideDevice(env, env.OAUTH_PROVIDER, session, String(input.userCode), input.decision as "allow" | "deny");
      return result ? authJson(result) : failure(400, "Invalid or expired device code.");
    }
    if (action === "consent-preview" || action === "consent-decision") {
      if (!session) return failure(401, "Sign in before authorizing a client.");
      try {
        const data = action === "consent-preview" ? await consentPreview(env, session, consentPreviewInput.parse(input)) : await consentDecision(env, session, consentDecisionInput.parse(input));
        return data ? authJson(data) : failure(400, "Invalid or expired authorization request.");
      } catch { return failure(400, "Invalid authorization request."); }
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
    const identity = result.body;
    const member = await new IdentityRepository(databaseFor(env), identity.tenantId).member(identity.userId);
    if (member?.role !== "owner" || member.sessionVersion !== identity.sessionVersion) return failure(403, "This account cannot access the workspace.");
    const lifetime = 7 * 24 * 60 * 60;
    const response = authJson({ ok: true, returnTo: safeReturnTo(requestCookie(request, "factorize_oauth_return") ?? input.returnTo as string | undefined) });
    response.headers.append("Set-Cookie", sessionCookie(env, await signSession({ ...identity, exp: Math.floor(Date.now() / 1000) + lifetime }, env.SESSION_SIGNING_SECRET), lifetime));
    response.headers.append("Set-Cookie", serialize("factorize_oauth_return", "", { httpOnly: true, secure: new URL(env.APP_ORIGIN).protocol === "https:", sameSite: "Lax", path: "/", maxAge: 0 }));
    return response;
  }
  const result = action === "signup" ? await repo.signup(input)
    : action === "verification-request" ? await repo.requestEmail(input, "verify")
    : action === "verification" ? await repo.completeVerification(String(input.token))
    : action === "reset-request" ? await repo.requestReset(input)
    : await repo.completeReset(input);
  // The new public signup contract intentionally does not enumerate accounts.
  // Keep legacy form status compatibility until those screens are cut over.
  if (action === "signup" && (result.status === 201 || result.status === 409)) return authJson({ ok: true }, 202);
  return result.status < 300 ? authJson({ ok: true }) : failure(result.status, "error" in result.body ? result.body.error : "Request failed.");
}
