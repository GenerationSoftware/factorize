import { adoptLegacyCredential } from "./oauth-installations";
import { cloudflareCallback, cloudflareOAuthCallback, pruneCloudflareOAuth } from "./cloudflare-oauth";
import { mcpOAuthChallenge, withRefreshAdmission } from "./mcp-oauth-auth";
import { pruneTotp } from "./totp";
import { googleSignInCallback } from "./auth-api";
import { clearExpiredGoogleSignIns, googleCallbackPath } from "./google-sign-in";
import { AlarmCoordinator as BaseAlarmCoordinator } from "./alarm-coordinator";
import { pruneRevokedMcpSubscriptions } from "./postgres/mcp-event-outbox";
import { wakeMcpDeliveries } from "./events/storage/event-match-repository";
import { staticApp, securityHeaders } from "./static-app";
import { OAuthProvider, AuthorizationError, getOAuthApi, type AuthRequest, type OAuthProviderOptions } from "@cloudflare/workers-oauth-provider";
import app from "./index";
import { readBrowserSession } from "./browser-session";
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
import { authenticateVmRequest, VM_GRANT_HEADER, VM_PROOF_HEADER } from "./vm-auth";

const scopes = [...ACCESS_SCOPES, "apps:manage"];
// Keep accepting grants issued by the pre-resource-scope protocol. New
// consent screens and metadata advertise only the canonical scopes above.
const oauthScopes = [...AGENT_SCOPES];
async function currentOwner(request: Request, env: Env) {
  const session = await readBrowserSession(request, env);
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
    if (url.pathname !== "/authorize" && url.pathname !== "/device") return app.fetch(request, { ...env, OAUTH_PROVIDER: env.OAUTH_PROVIDER ?? getOAuthApi(providerOptions(env), env) }, ctx);
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
      const result = await consentDecision(env, session, { request: String(form.get("request") ?? ""), signature: String(form.get("signature") ?? ""), decision, scopes: form.getAll("scope").map(String) as any }, request);
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

export class AlarmCoordinator extends BaseAlarmCoordinator {
  protected override eventEnv(): Env {
    return { ...this.env, OAUTH_PROVIDER: this.env.OAUTH_PROVIDER ?? getOAuthApi(providerOptions(this.env), this.env) };
  }
}
const backend = { async fetch(request: Request, env: Env, ctx: ExecutionContext) {
  if (new URL(request.url).hostname === "git.factorize.sh") return new Response("Not found", { status: 404 });
  if (new URL(request.url).pathname === cloudflareCallback) return cloudflareOAuthCallback(request, env);
  if (new URL(request.url).pathname === googleCallbackPath) return googleSignInCallback(request, env);
  if (new URL(request.url).pathname === "/oauth/x/callback") return request.method === "GET" ? xOAuthCallback(request, env) : new Response("Method not allowed", { status: 405, headers: { Allow: "GET" } });
  const oidc = await oidcRequest(request, env);
  if (oidc) return oidc;
  const staticResponse = !["/authorize", "/device"].includes(new URL(request.url).pathname) ? await staticApp(request, env) : null;
  if (staticResponse) return staticResponse;
  const oauth = provider(env);
  const url = new URL(request.url);
  const apiEnv = { ...env, OAUTH_PROVIDER: env.OAUTH_PROVIDER ?? getOAuthApi(providerOptions(env), env) };
  if (url.pathname.startsWith("/internal/")) return new Response("Not found", {status: 404});
  if ((url.pathname === "/mcp" || url.pathname.startsWith("/api/v1/")) &&
      (request.headers.has(VM_GRANT_HEADER) || request.headers.has(VM_PROOF_HEADER))) {
    const auth = await authenticateVmRequest(apiEnv, request);
    if (!auth) return Response.json({ error: { code: "invalid_token", message: "Invalid VM authorization." } }, {
      status: 401, headers: { "WWW-Authenticate": 'Bearer error="invalid_token"', "Cache-Control": "no-store" },
    });
    return protectedApiFetch(request, apiEnv, auth, ctx);
  }
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
    const tokenScopes = normalizeScopes(token.scope).filter(scope => normalizeScopes(props.scopes).includes(scope));
    if (!props.oauthInstallationId) await adoptLegacyCredential(apiEnv, props, token.grantId, token.grant.clientId);
    return protectedApiFetch(request,apiEnv,{...props,authMethod:"oauth",scopes:tokenScopes,oauthGrantId:token.grantId,oauthClientId:token.grant.clientId,oauthExpiresAt:token.expiresAt},ctx);
  }
  if (isBrowserAuthOperation(request.method, url.pathname)) return protectedApiFetch(request, apiEnv, null, ctx);
  if (url.pathname.startsWith("/api/v1") && !request.headers.has("Authorization")) {
    // Validate the browser cookie and its revocation here; the service performs the authoritative owner,
    // verified-email and session-version lookup once for this API request.
    const session = await readBrowserSession(request, env);
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
    const exchange = async (credentialRequest: Request, credentialEnv: Env, execution: ExecutionContext) => {
      const form = await credentialRequest.clone().formData().catch(() => null);
      const redirect = form?.get("redirect_uri");
      return withRefreshAdmission(credentialEnv, tokenExchangeCallback =>
        new OAuthProvider<Env>({ ...providerOptions(credentialEnv), tokenExchangeCallback }).fetch(credentialRequest, credentialEnv, execution),
        form?.get("grant_type") === "refresh_token", typeof redirect === "string" ? redirect : null);
    };
    const form = await request.clone().formData().catch(() => null);
    if (form?.get("grant_type") === DEVICE_GRANT) return deviceToken(request, env, { fetch: exchange }, ctx);
    const response = await exchange(request, env, ctx);
    if (response.ok && form?.get("grant_type") === "authorization_code") ctx.waitUntil(wakeMcpDeliveries(env).catch(() => {}));
    return response;
  }
  const response = await oauth.fetch(request, env, ctx);
  if (url.pathname === "/mcp" && response.status === 401) {
    // The provider rejects these before handing off to Factorize. Only its
    // fixed OAuth fields are inspected, not any credential or arbitrary error.
    const error = await response.clone().json<{error?: unknown; error_description?: unknown}>().catch(() => null);
    if (error?.error === "invalid_token") return mcpOAuthChallenge(env, error.error_description === "Access token expired" ? "token_expired" : "invalid_token");
    if (!request.headers.has("Authorization")) return mcpOAuthChallenge(env);
  }
  if (url.pathname === "/.well-known/oauth-authorization-server") return addDeviceMetadata(response, env.APP_ORIGIN);
  return response;
} } satisfies ExportedHandler<Env>;

export default {
  async scheduled(_event: ScheduledController, env: Env) {
    // Ensure the alarm sweep starts even if a producer's immediate wake was missed.
    await wakeMcpDeliveries(env).catch(() => {});
    const db = databaseFor(env);
    await pruneRevokedMcpSubscriptions(db);
    await db.pool.query(`DELETE FROM app.oauth_installation_issuances WHERE id IN
      (SELECT id FROM app.oauth_installation_issuances WHERE expires_at<now()-interval '1 day' ORDER BY expires_at LIMIT 1000)`);
    await db.pool.query(`DELETE FROM app.oauth_installations WHERE (tenant_id,id) IN (
      SELECT i.tenant_id,i.id FROM app.oauth_installations i WHERE i.active_grant_id IS NULL AND i.created_at<now()-interval '1 day'
        AND NOT EXISTS (SELECT 1 FROM app.oauth_installation_issuances p WHERE (p.tenant_id,p.installation_id)=(i.tenant_id,i.id))
      ORDER BY i.created_at LIMIT 1000)`);
    // Retire expired VM proofs and incomplete enrollments.
    await clearExpiredGoogleSignIns(db.pool);
    await pruneCloudflareOAuth(db.pool);
    await pruneTotp(db.pool);
    await db.pool.query(`DELETE FROM app.revoked_browser_sessions WHERE digest IN
      (SELECT digest FROM app.revoked_browser_sessions WHERE expires_at<now()-interval '1 day' ORDER BY expires_at LIMIT 5000)`);
    await db.pool.query(`DELETE FROM app.vm_permission_proofs WHERE (tenant_id,grant_id,proof_id) IN
      (SELECT tenant_id,grant_id,proof_id FROM app.vm_permission_proofs WHERE expires_at<now() ORDER BY expires_at LIMIT 5000)`);
    await db.pool.query(`UPDATE app.vm_permission_grants SET revoked_at=now(),updated_at=now(),updated_by='system:enrollment-timeout',
      cleaned_at=CASE WHEN provider_kind='fly' THEN now() ELSE NULL END
      WHERE activated_at IS NULL AND revoked_at IS NULL AND created_at<now()-interval '1 hour'`);
  },
  async fetch(request: Request, env: Env, ctx: ExecutionContext) { return securityHeaders(request, await backend.fetch(request, env, ctx)); } } satisfies ExportedHandler<Env>;
