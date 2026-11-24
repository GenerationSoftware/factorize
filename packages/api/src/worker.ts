import { gitHttpsFetch } from "./git-https";
import { SkillLibrary } from "./skill-library";
import { staticApp, securityHeaders } from "./static-app";
import { OAuthProvider, AuthorizationError, getOAuthApi, type AuthRequest, type OAuthProviderOptions } from "@cloudflare/workers-oauth-provider";
import app from "./index";
import { readSession, requestCookie } from "./session";
import { isBrowserAuthOperation } from "./api-contract";
import { ProtectedApiHandler, protectedApiFetch } from "./protected-api";
import { startConnection, connectionFor } from "./oauth-continuation";
import { consentDecision } from "./consent-api";
import { addDeviceMetadata, DEVICE_GRANT, deviceAuthorization, deviceClientRegistration, deviceToken, deviceVerification } from "./device-oauth";
import type { Env, OAuthProps } from "./types";
import { AGENT_SCOPES, ACCESS_SCOPES, authenticateAccessToken, normalizeScopes } from "./access-tokens";
import { databaseFor } from "./postgres/database";
import { IdentityRepository } from "./postgres/identity-repository";
import { oidcApiAuth, oidcRequest } from "./oidc-provider";
import { xOAuthCallback } from "./x-oauth-callback";

const scopes = [...ACCESS_SCOPES, "apps:manage"];
// Keep accepting grants issued by the pre-resource-scope protocol. New
// consent screens and metadata advertise only the canonical scopes above.
const oauthScopes = [...AGENT_SCOPES];
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
      if (request.method === "GET" || request.method === "HEAD") {
        let connection = url.searchParams.get("connection");
        if (!connection && (!session || url.pathname === "/authorize")) {
          const started = await startConnection(request, env, url.pathname + url.search);
          if (!started) return new Response("Invalid or expired MCP request. Start a new connection from your client.", { status: 400 });
          connection = started.connection;
          url.searchParams.set("connection", connection);
          return new Response(null, { status: 302, headers: { Location: session ? url.toString() : `${env.APP_ORIGIN}/auth/login?connection=${connection}`, "Set-Cookie": started.cookie, "Cache-Control": "no-store" } });
        }
        if (connection && !await connectionFor(env, connection)) return new Response("This MCP connection expired or already completed. Start a new connection from your client.", { status: 400 });
        if (!session) return Response.redirect(`${env.APP_ORIGIN}/auth/login${connection ? `?connection=${connection}` : ""}`, 302);
      }
      if (!session) return new Response("Sign in before approving this request.", { status: 401 });
      if (url.pathname === "/device") return request.method === "GET" || request.method === "HEAD" ? (await staticApp(request, env))! : deviceVerification(request, env, env.OAUTH_PROVIDER!, session);
      if (request.method === "GET" || request.method === "HEAD") {
        const parsed = await env.OAUTH_PROVIDER!.parseAuthRequest(request);
        const client = await env.OAUTH_PROVIDER!.lookupClient(parsed.clientId);
        if (!client) return new Response("Unknown OAuth client", { status: 400 });
        return (await staticApp(request, env))!;
      }
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
      const form = await request.formData();
      const decision = form.get("decision");
      if (decision !== "allow" && decision !== "deny") return new Response("Invalid decision", { status: 400 });
      const result = await consentDecision(env, session, { request: String(form.get("request") ?? ""), signature: String(form.get("signature") ?? ""), decision, scopes: form.getAll("scope").map(String) as any });
      return result ? Response.redirect(result.redirectTo, 302) : new Response("Invalid, expired, or already completed consent request. Restart from your client.", { status: 400 });
    } catch (error) { if (error instanceof AuthorizationError) return oauthError(error); throw error; }
  },
};

function providerOptions(env: Env): OAuthProviderOptions<Env> { return {
  apiRoute: ["/api/v1", "/mcp"], apiHandler: ProtectedApiHandler, defaultHandler,
  authorizeEndpoint: "/authorize", tokenEndpoint: "/oauth/token", clientRegistrationEndpoint: "/oauth/register",
  scopesSupported: oauthScopes, allowImplicitFlow: false, allowPlainPKCE: false,
  accessTokenTTL: 3600, refreshTokenTTL: 2_592_000,
  clientIdMetadataDocumentEnabled: true,
  resourceMetadata: { resource: `${env.APP_ORIGIN}/mcp`, authorization_servers: [env.APP_ORIGIN], scopes_supported: [...AGENT_SCOPES], bearer_methods_supported: ["header"], resource_name: "Factorize triggers" },
}; }
function provider(env: Env) { return new OAuthProvider<Env>(providerOptions(env)); }

export { AlarmCoordinator } from "./alarm-coordinator";
const backend = { async fetch(request: Request, env: Env, ctx: ExecutionContext) {
  if (new URL(request.url).hostname === "git.factorize.sh") return gitHttpsFetch(request, env, ctx);
  if (new URL(request.url).pathname === "/oauth/x/callback") return request.method === "GET" ? xOAuthCallback(request, env) : new Response("Method not allowed", { status: 405, headers: { Allow: "GET" } });
  const oidc = await oidcRequest(request, env);
  if (oidc) return oidc;
  const staticResponse = !["/authorize", "/device"].includes(new URL(request.url).pathname) ? await staticApp(request, env) : null;
  if (staticResponse) return staticResponse;
  const oauth = provider(env);
  const url = new URL(request.url);
  const apiEnv = { ...env, OAUTH_PROVIDER: env.OAUTH_PROVIDER ?? getOAuthApi(providerOptions(env), env) };
  if (url.pathname.startsWith("/internal/")) return new Response("Not found", {status: 404});
  if (url.pathname.startsWith("/api/v1/") && /^Bearer fza_/i.test(request.headers.get("Authorization") ?? "")) {
    const auth = await oidcApiAuth(request, env);
    if (!auth) return Response.json({ error: { code: "invalid_token" } }, {status: 401, headers: { "WWW-Authenticate": 'Bearer error="invalid_token"', "Cache-Control": "no-store" } });
    return protectedApiFetch(request, apiEnv, auth, ctx);
  }
  const proxyEndpoint = request.method === "POST" && ["/api/v1/agent/requests","/api/v1/agent/responses/read"].includes(url.pathname);
  const reflectionEndpoint = request.method === "GET" && url.pathname === "/api/v1/agent/reflection";
  if ((proxyEndpoint || reflectionEndpoint) && request.headers.get("Authorization")?.startsWith("Bearer ")) {
    // These HTTP operations are part of the agent resource only with explicit
    // proxy consent. Other REST operations retain their normal audience check.
    const token = await apiEnv.OAUTH_PROVIDER.unwrapToken<OAuthProps>(request.headers.get("Authorization")!.slice(7));
    const props = token?.grant.props;
    if (!token || token.audience !== env.APP_ORIGIN+"/mcp" || !props || props.userId !== token.userId || token.expiresAt <= Date.now()/1000)
      return Response.json({error:{code:"invalid_token"}},{status:401});
    const effective = normalizeScopes(token.scope).filter(scope => normalizeScopes(props.scopes).includes(scope));
    if (!effective.includes("proxy:use")) return Response.json({error:{code:"insufficient_scope"}},{status:403, headers:{"WWW-Authenticate":'Bearer error="insufficient_scope", scope="proxy:use"'}});
    return protectedApiFetch(request,apiEnv,{...props,authMethod:"oauth",scopes:effective,oauthGrantId:token.grantId,oauthClientId:token.grant.clientId,oauthExpiresAt:token.expiresAt},ctx);
  }
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
  if (url.pathname === "/oauth/device_authorization") return deviceAuthorization(request, env, getOAuthApi(providerOptions(env), env), oauthScopes);
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

export default {
  async scheduled(_event: ScheduledController, env: Env) {
    // Retry missed deliveries and refresh managed remotes in oldest-checked order.
    const db = databaseFor(env);
    if (env.SKILL_ARTIFACTS) {
      const pending = await db.pool.query("SELECT tenant_id FROM app.skill_library_backfill ORDER BY attempted_at NULLS FIRST,tenant_id LIMIT 5");
      for (const row of pending.rows) {
        try { await new SkillLibrary(env, row.tenant_id).migrate(); }
        catch {
          await db.pool.query("UPDATE app.skill_library_backfill SET attempted_at=now(),error='Migration failed. Verify Artifacts access and published skill contents.' WHERE tenant_id=$1", [row.tenant_id]);
        }
      }
    }
    const rows = await db.pool.query("SELECT tenant_id FROM app.skill_libraries WHERE (checked_at IS NULL OR checked_at < now()-interval '5 minutes') AND NOT EXISTS (SELECT 1 FROM app.skill_library_backfill pending WHERE pending.tenant_id=skill_libraries.tenant_id) ORDER BY checked_at NULLS FIRST LIMIT 10");
    for (const row of rows.rows) await new SkillLibrary(env,row.tenant_id).sync();
  },
  async fetch(request: Request, env: Env, ctx: ExecutionContext) { return securityHeaders(request, await backend.fetch(request, env, ctx)); } } satisfies ExportedHandler<Env>;
