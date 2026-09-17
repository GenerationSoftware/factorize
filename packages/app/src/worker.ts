import { OAuthProvider, AuthorizationError, getOAuthApi, type AuthRequest, type OAuthProviderOptions } from "@cloudflare/workers-oauth-provider";
import app, { readSession, requestCookie } from "./index";
import { ProtectedApiHandler, protectedApiFetch } from "./protected-api";
import { hmac } from "./crypto";
import { addDeviceMetadata, DEVICE_GRANT, deviceAuthorization, deviceClientRegistration, deviceLoginRedirect, deviceToken, deviceVerification } from "./device-oauth";
import type { Env, OAuthProps } from "./types";
import { authenticateAccessToken } from "./access-tokens";
import { AuthStore } from "./auth-do";

const scopes = ["flows:read", "flows:write", "runs:read", "runs:write"];
const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
async function currentOwner(request: Request, env: Env) {
  const session = await readSession(requestCookie(request, "factorize_session"), env.SESSION_SIGNING_SECRET);
  if (!session) return null;
  const stub = env.TENANTS.get(env.TENANTS.idFromName(`tenant:${session.tenantId}`));
  const response = await stub.fetch(`https://tenant/members/${encodeURIComponent(session.userId)}`);
  if (!response.ok) return null;
  const member = await response.json() as { role?: string; session_version?: number };
  return member.role === "owner" && member.session_version === session.sessionVersion ? session : null;
}

function oauthError(error: AuthorizationError): Response {
  if (!error.redirectUri) return new Response(error.description, { status: 400 });
  const redirect = new URL(error.redirectUri);
  redirect.searchParams.set("error", error.code);
  redirect.searchParams.set("error_description", error.description);
  if (error.state) redirect.searchParams.set("state", error.state);
  if (error.issuer) redirect.searchParams.set("iss", error.issuer);
  return Response.redirect(redirect, 302);
}

const defaultHandler: ExportedHandler<Env> = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname !== "/authorize" && url.pathname !== "/device") return app.fetch(request, env, ctx);
    try {
      const session = await currentOwner(request, env);
      if (!session) {
        return deviceLoginRedirect(env.APP_ORIGIN, url.pathname + url.search);
      }
      if (url.pathname === "/device") return deviceVerification(request, env, env.OAUTH_PROVIDER!, session);
      if (request.method === "GET") {
        const parsed = await env.OAUTH_PROVIDER!.parseAuthRequest(request);
        const client = await env.OAUTH_PROVIDER!.lookupClient(parsed.clientId);
        if (!client) return new Response("Unknown OAuth client", { status: 400 });
        const payload = btoa(JSON.stringify(parsed));
        const signature = await hmac(`${payload}.${session.tenantId}.${session.userId}`, env.SESSION_SIGNING_SECRET);
        const requested = parsed.scope.filter(scope => scopes.includes(scope));
        return new Response(`<!doctype html><html><head><meta charset="utf-8"><title>Authorize Factorize</title><link rel="stylesheet" href="/styles.css"></head><body><main><h1>Authorize ${escape(client.clientName ?? "this client")}</h1><p>Signed in as ${escape(session.email)}. This client is requesting:</p><form method="post"><input type="hidden" name="request" value="${escape(payload)}"><input type="hidden" name="signature" value="${signature}">${requested.map(scope => `<label><input type="checkbox" name="scope" value="${scope}" checked> ${scope}</label><br>`).join("")}<p><button name="decision" value="allow">Allow</button> <button name="decision" value="deny">Deny</button></p></form></main></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
      }
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
      const form = await request.formData(), payload = String(form.get("request") ?? ""), signature = String(form.get("signature") ?? "");
      if (!payload || signature !== await hmac(`${payload}.${session.tenantId}.${session.userId}`, env.SESSION_SIGNING_SECRET)) return new Response("Invalid consent request", { status: 400 });
      const parsed = JSON.parse(atob(payload)) as AuthRequest;
      if (form.get("decision") !== "allow") {
        const redirect = new URL(parsed.redirectUri); redirect.searchParams.set("error", "access_denied"); redirect.searchParams.set("state", parsed.state); if (parsed.issuer) redirect.searchParams.set("iss", parsed.issuer);
        return Response.redirect(redirect, 302);
      }
      const granted = form.getAll("scope").map(String).filter(scope => parsed.scope.includes(scope) && scopes.includes(scope));
      const props: OAuthProps = { tenantId: session.tenantId, userId: session.userId, sessionVersion: session.sessionVersion, scopes: granted };
      const { redirectTo } = await env.OAUTH_PROVIDER!.completeAuthorization({ request: parsed, userId: session.userId, metadata: { tenantId: session.tenantId }, scope: granted, props });
      return Response.redirect(redirectTo, 302);
    } catch (error) { if (error instanceof AuthorizationError) return oauthError(error); throw error; }
  },
};

function providerOptions(env: Env): OAuthProviderOptions<Env> { return {
  apiRoute: ["/api/v1", "/mcp"], apiHandler: ProtectedApiHandler, defaultHandler,
  authorizeEndpoint: "/authorize", tokenEndpoint: "/oauth/token", clientRegistrationEndpoint: "/oauth/register",
  scopesSupported: scopes, allowImplicitFlow: false, allowPlainPKCE: false,
  accessTokenTTL: 3600, refreshTokenTTL: 2_592_000,
  clientIdMetadataDocumentEnabled: true,
  resourceMetadata: { resource: `${env.APP_ORIGIN}/mcp`, authorization_servers: [env.APP_ORIGIN], scopes_supported: scopes, bearer_methods_supported: ["header"], resource_name: "Factorize jobs" },
}; }
function provider(env: Env) { return new OAuthProvider<Env>(providerOptions(env)); }

export { TenantV2, Tenant, GitHubInstallationRegistryV2, GitHubInstallationRegistry } from "./index";
export { AuthStore } from "./auth-do";
export default { async fetch(request: Request, env: Env, ctx: ExecutionContext) {
  const oauth = provider(env);
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/v1") && !request.headers.has("Authorization")) {
    const session = await currentOwner(request, env);
    if (!session) return Response.json({ error: { code: "invalid_token", message: "Unauthorized" } }, { status: 401 });
    return protectedApiFetch(request, env, { tenantId: session.tenantId, userId: session.userId, sessionVersion: session.sessionVersion, scopes }, ctx);
  }
  if ((url.pathname === "/mcp" || url.pathname.startsWith("/api/v1")) && request.headers.get("Authorization")?.startsWith("Bearer fzt_")) {
    const auth = await authenticateAccessToken(request, env);
    if (!auth) return Response.json({ error: { code: "invalid_token", message: "The access token is invalid, expired, or revoked." } }, { status: 401, headers: { "WWW-Authenticate": "Bearer error=\"invalid_token\"" } });
    return protectedApiFetch(request, env, auth, ctx);
  }
  if (url.pathname === "/oauth/device_authorization") return deviceAuthorization(request, env, getOAuthApi(providerOptions(env), env), scopes);
  if (url.pathname === "/oauth/register") return deviceClientRegistration(request, env, oauth, ctx);
  if (url.pathname === "/oauth/token" && request.method === "POST") {
    const clone = request.clone();
    const form = await clone.formData().catch(() => null);
    if (form?.get("grant_type") === DEVICE_GRANT) return deviceToken(request, env, oauth, ctx);
  }
  const response = await oauth.fetch(request, env, ctx);
  if (url.pathname === "/.well-known/oauth-authorization-server") return addDeviceMetadata(response, env.APP_ORIGIN);
  return response;
} } satisfies ExportedHandler<Env>;
