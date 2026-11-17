import { requestCookie, readSession } from "./session";
import { databaseFor } from "./postgres/database";
import { IdentityRepository } from "./postgres/identity-repository";
import { XConnectionRepository } from "./postgres/x-connection-repository";
import { readXOAuthState } from "./x-oauth";
import type { Env } from "./types";

const cookie = "factorize_x_oauth_state";
const clearCookie = `${cookie}=; HttpOnly; Secure; SameSite=Lax; Path=/oauth/x/callback; Max-Age=0`;
const settings = (env: Env, result: string) => {
  const target = new URL("/settings/integrations", env.APP_ORIGIN);
  target.searchParams.set("x", result);
  return Response.redirect(target.toString(), 303);
};

/** X's registered redirect URI is fixed; all credentials and the PKCE verifier
 * stay server-side. The attempt row is consumed atomically before any exchange. */
export async function xOAuthCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url), clear = { "Set-Cookie": clearCookie, "Cache-Control": "no-store" };
  const fail = (result: string) => {
    const response = settings(env, result);
    for (const [key, value] of Object.entries(clear)) response.headers.set(key, value);
    return response;
  };
  const session = await readSession(requestCookie(request, "factorize_session"), env.SESSION_SIGNING_SECRET);
  if (!session) return fail("session_required");
  const database = databaseFor(env), identities = new IdentityRepository(database, session.tenantId);
  const member = await identities.member(session.userId);
  if (member?.role !== "owner" || member.sessionVersion !== session.sessionVersion) return fail("session_required");

  const state = url.searchParams.get("state") ?? undefined;
  const verified = await readXOAuthState(state, requestCookie(request, cookie), session, env.SESSION_SIGNING_SECRET);
  if (!verified) return fail("expired");
  const repository = new XConnectionRepository(database, session.tenantId, env.CREDENTIAL_ENCRYPTION_KEY);
  const attempt = await repository.consumeOAuthAttempt(verified.nonce);
  if (!attempt || attempt.userId !== session.userId || attempt.sessionVersion !== session.sessionVersion || attempt.connectionId !== verified.connectionId
    || JSON.stringify(attempt.scopes) !== JSON.stringify(verified.scopes)) return fail("expired");

  if (url.searchParams.has("error")) return fail(url.searchParams.get("error") === "access_denied" ? "denied" : "failed");
  const code = url.searchParams.get("code");
  const credentials = await repository.clientCredentials(verified.connectionId);
  if (!code || !credentials) { await repository.resetOAuthAttempt(verified.connectionId); return fail("failed"); }

  const redirectUri = `${env.APP_ORIGIN}/oauth/x/callback`;
  try {
    const tokenResponse = await fetch("https://api.x.com/2/oauth2/token", {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Basic ${btoa(`${credentials.clientId}:${credentials.clientSecret}`)}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: attempt.verifier }),
    });
    if (!tokenResponse.ok) throw new Error("token_exchange_failed");
    const token = await tokenResponse.json() as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; scope?: unknown };
    if (typeof token.access_token !== "string" || typeof token.refresh_token !== "string" || typeof token.expires_in !== "number" || token.expires_in <= 0 || typeof token.scope !== "string") throw new Error("invalid_token_response");
    const grantedScopes = [...new Set(token.scope.split(/\s+/).filter(Boolean))].sort();
    if (verified.scopes.some(scope => !grantedScopes.includes(scope))) { await repository.resetOAuthAttempt(verified.connectionId); return fail("scope_mismatch"); }

    const meResponse = await fetch("https://api.x.com/2/users/me?user.fields=id%2Cusername", {
      headers: { Authorization: `Bearer ${token.access_token}`, Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(15_000),
    });
    if (!meResponse.ok) throw new Error("identity_verification_failed");
    const me = await meResponse.json() as { data?: { id?: unknown; username?: unknown } };
    if (typeof me.data?.id !== "string" || typeof me.data.username !== "string" || !me.data.username) throw new Error("invalid_identity_response");
    await repository.completeOAuth(verified.connectionId, {
      accessToken: token.access_token, refreshToken: token.refresh_token,
      expiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString(), accountId: me.data.id,
      accountHandle: me.data.username, grantedScopes,
    });
    return fail("connected");
  } catch {
    await repository.resetOAuthAttempt(verified.connectionId);
    return fail("failed");
  }
}
