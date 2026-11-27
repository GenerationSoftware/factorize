import { appConfig } from "../../config/runtime";
import { adoptLegacyCredential } from "../../access-control/application/oauth-installations";

import { mcpOAuthChallenge, withRefreshAdmission } from "../../transport/mcp/mcp-oauth-auth";

import { wakeMcpDeliveries } from "../../subscriptions/application/wake-delivery";
import { staticApp } from "../../runtime/static-app";
import { OAuthProvider, AuthorizationError, getOAuthApi, type OAuthProviderOptions } from "@cloudflare/workers-oauth-provider";
import app from "../../index";
import { readBrowserSession } from "../application/browser-session";

import { ProtectedApiHandler, protectedApiFetch } from "../../protected-api";
import { startConnection, connectionFor } from "../application/oauth-continuation";
import { consentDecision } from "../application/consent-api";
import { addDeviceMetadata, DEVICE_GRANT, deviceAuthorization, deviceClientRegistration, deviceToken, deviceVerification } from "./device-oauth";
import type { Env, OAuthProps } from "../../types";
import { AGENT_SCOPES, normalizeScopes } from "../../access-control/domain/scopes";
import { databaseFor } from "../../postgres/database";
import { IdentityRepository } from "../storage/identity-repository";

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
      if (request.method === "POST" && (request.headers.get("Origin") !== appConfig(env).origin || request.headers.get("Sec-Fetch-Site") === "cross-site")) return new Response("Invalid request origin", { status: 403 });
      const session = await currentOwner(request, env);
      if (request.method === "GET" || request.method === "HEAD") {
        let connection = url.searchParams.get("connection");
        if (!connection && (!session || url.pathname === "/authorize")) {
          const started = await startConnection(request, env, url.pathname + url.search);
          if (!started) return new Response("Invalid or expired MCP request. Start a new connection from your client.", { status: 400 });
          connection = started.connection;
          url.searchParams.set("connection", connection);
          return new Response(null, { status: 302, headers: { Location: session ? url.toString() : `${appConfig(env).origin}/auth/login?connection=${connection}`, "Set-Cookie": started.cookie, "Cache-Control": "no-store" } });
        }
        if (connection && !await connectionFor(env, connection)) return new Response("This MCP connection expired or already completed. Start a new connection from your client.", { status: 400 });
        if (!session) return Response.redirect(`${appConfig(env).origin}/auth/login${connection ? `?connection=${connection}` : ""}`, 302);
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
  resourceMetadata: { resource: `${appConfig(env).origin}/mcp`, authorization_servers: [appConfig(env).origin], scopes_supported: [...AGENT_SCOPES], bearer_methods_supported: ["header"], resource_name: "Factorize triggers" },
}; }
export function provider(env: Env) { return new OAuthProvider<Env>(providerOptions(env)); }

export function withOAuthProvider(env: Env) {
  return { ...env, OAUTH_PROVIDER: env.OAUTH_PROVIDER ?? getOAuthApi(providerOptions(env), env) };
}

export async function proxyOAuthResponse(request: Request, env: Env, apiEnv: ReturnType<typeof withOAuthProvider>, ctx: ExecutionContext) {
  const url = new URL(request.url);
  const proxyEndpoint = request.method === "POST" && ["/api/v1/agent/requests","/api/v1/agent/responses/read"].includes(url.pathname);
  const reflectionEndpoint = request.method === "GET" && url.pathname === "/api/v1/agent/reflection";
  if ((proxyEndpoint || reflectionEndpoint) && request.headers.get("Authorization")?.startsWith("Bearer ")) {
    // These HTTP operations are part of the agent resource only with explicit
    // proxy consent. Other REST operations retain their normal audience check.
    const token = await apiEnv.OAUTH_PROVIDER.unwrapToken<OAuthProps>(request.headers.get("Authorization")!.slice(7));
    const props = token?.grant.props;
    if (!token || token.audience !== appConfig(env).origin+"/mcp" || !props || props.userId !== token.userId || token.expiresAt <= Date.now()/1000)
      return Response.json({error:{code:"invalid_token"}},{status:401});
    const tokenScopes = normalizeScopes(token.scope).filter(scope => normalizeScopes(props.scopes).includes(scope));
    if (!props.oauthInstallationId) await adoptLegacyCredential(apiEnv, props, token.grantId, token.grant.clientId);
    return protectedApiFetch(request,apiEnv,{...props,authMethod:"oauth",scopes:tokenScopes,oauthGrantId:token.grantId,oauthClientId:token.grant.clientId,oauthExpiresAt:token.expiresAt},ctx);
  }
  return null;
}

export async function dispatchOAuth(request: Request, env: Env, ctx: ExecutionContext, oauth: ReturnType<typeof provider>) {
  const url = new URL(request.url);
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
  if (url.pathname === "/.well-known/oauth-authorization-server") return addDeviceMetadata(response, appConfig(env).origin);
  return response;
}
