import { staticApp, securityHeaders } from "./static-app";
import { OAuthProvider, AuthorizationError, getOAuthApi, type AuthRequest, type OAuthProviderOptions } from "@cloudflare/workers-oauth-provider";
import app from "./index";
import { readSession, requestCookie } from "./session";
import { isBrowserAuthOperation } from "./api-contract";
import { ProtectedApiHandler, protectedApiFetch } from "./protected-api";
import { hmac } from "./crypto";
import { addDeviceMetadata, DEVICE_GRANT, deviceAuthorization, deviceClientRegistration, deviceLoginRedirect, deviceToken, deviceVerification } from "./device-oauth";
import type { Env, OAuthProps } from "./types";
import { authenticateAccessToken } from "./access-tokens";
import { artifactUpload } from "./artifact-upload";
import { traceChunkUpload } from "./trace-chunk-upload";
import { databaseFor } from "./postgres/database";
import { IdentityRepository } from "./postgres/identity-repository";

const scopes = ["flows:read", "flows:write", "runs:read", "runs:write"];
async function currentOwner(request: Request, env: Env) {
  const session = await readSession(requestCookie(request, "factorize_session"), env.SESSION_SIGNING_SECRET);
  if (!session) return null;
  const member = await new IdentityRepository(databaseFor(env), session.tenantId).member(session.userId);
  return member?.role === "owner" && member.sessionVersion === session.sessionVersion ? session : null;
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
      if (request.method === "POST" && (request.headers.get("Origin") !== env.APP_ORIGIN || request.headers.get("Sec-Fetch-Site") === "cross-site")) return new Response("Invalid request origin", { status: 403 });
      const session = await currentOwner(request, env);
      if (!session) {
        return deviceLoginRedirect(env.APP_ORIGIN, url.pathname + url.search);
      }
      if (url.pathname === "/device") return request.method === "GET" || request.method === "HEAD" ? (await staticApp(request, env))! : deviceVerification(request, env, env.OAUTH_PROVIDER!, session);
      if (request.method === "GET" || request.method === "HEAD") {
        const parsed = await env.OAUTH_PROVIDER!.parseAuthRequest(request);
        const client = await env.OAUTH_PROVIDER!.lookupClient(parsed.clientId);
        if (!client) return new Response("Unknown OAuth client", { status: 400 });
        return (await staticApp(request, env))!;
      }
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
      const form = await request.formData(), payload = String(form.get("request") ?? ""), signature = String(form.get("signature") ?? "");
      if (!payload || signature !== await hmac(`${payload}.${session.tenantId}.${session.userId}`, env.SESSION_SIGNING_SECRET)) return new Response("Invalid consent request", { status: 400 });
      const parsed = JSON.parse(atob(payload)) as AuthRequest;
      const client = await env.OAUTH_PROVIDER!.lookupClient(parsed.clientId);
      if (!client || !client.redirectUris.includes(parsed.redirectUri)) return new Response("Invalid consent request", { status: 400 });
      if (form.get("decision") !== "allow") {
        const redirect = new URL(parsed.redirectUri); redirect.searchParams.set("error", "access_denied"); redirect.searchParams.set("state", parsed.state); if (parsed.issuer) redirect.searchParams.set("iss", parsed.issuer);
        return Response.redirect(redirect, 302);
      }
      const granted = form.getAll("scope").map(String).filter(scope => parsed.scope.includes(scope) && scopes.includes(scope));
      const props: OAuthProps = { tenantId: session.tenantId, userId: session.userId, sessionVersion: session.sessionVersion, scopes: granted, authMethod: "oauth" };
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

export { AlarmCoordinator } from "./alarm-coordinator";
const backend = { async fetch(request: Request, env: Env, ctx: ExecutionContext) {
  const staticResponse = !["/authorize", "/device"].includes(new URL(request.url).pathname) ? await staticApp(request, env) : null;
  if (staticResponse) return staticResponse;
  const oauth = provider(env);
  const url = new URL(request.url);
  const apiEnv = { ...env, OAUTH_PROVIDER: env.OAUTH_PROVIDER ?? getOAuthApi(providerOptions(env), env) };
  const traceChunkMatch = url.pathname.match(/^\/internal\/run-trace-chunks\/([^/]+)$/);
  if (traceChunkMatch) return traceChunkUpload(request, env, decodeURIComponent(traceChunkMatch[1]!));
  const artifactMatch = url.pathname.match(/^\/internal\/run-artifacts\/([^/]+)$/);
  if (artifactMatch) return artifactUpload(request, env, decodeURIComponent(artifactMatch[1]!));
  if (isBrowserAuthOperation(request.method, url.pathname)) return protectedApiFetch(request, apiEnv, null, ctx);
  if (url.pathname.startsWith("/api/v1") && !request.headers.has("Authorization")) {
    // Signature and expiry here; the service performs the authoritative owner,
    // verified-email and session-version lookup once for this API request.
    const session = await readSession(requestCookie(request, "factorize_session"), env.SESSION_SIGNING_SECRET);
    if (!session) return Response.json({ error: { code: "invalid_token", message: "Unauthorized" } }, { status: 401 });
    return protectedApiFetch(request, apiEnv, { tenantId: session.tenantId, userId: session.userId, sessionVersion: session.sessionVersion, scopes, authMethod: "session" }, ctx);
  }
  if ((url.pathname === "/mcp" || url.pathname.startsWith("/api/v1")) && request.headers.get("Authorization")?.startsWith("Bearer fzt_")) {
    const auth = await authenticateAccessToken(request, env);
    if (!auth) return Response.json({ error: { code: "invalid_token", message: "The access token is invalid, expired, or revoked." } }, { status: 401, headers: { "WWW-Authenticate": "Bearer error=\"invalid_token\"" } });
    return protectedApiFetch(request, apiEnv, auth, ctx);
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

export default { async fetch(request: Request, env: Env, ctx: ExecutionContext) { return securityHeaders(request, await backend.fetch(request, env, ctx)); } } satisfies ExportedHandler<Env>;
