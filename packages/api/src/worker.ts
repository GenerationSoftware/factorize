import { ghcrRegistryHost } from "./integrations/application/ghcr-workload";
import { ghcrRegistryHttp } from "./integrations/api/ghcr-registry-http";
import { awsIssuerResponse } from "./integrations/providers/aws/issuer";
import { dispatchOAuth, provider, proxyOAuthResponse, withOAuthProvider } from "./auth/transport/worker-oauth";
import { runScheduledMaintenance } from "./runtime/scheduled-maintenance";

import { cloudflareCallback, cloudflareOAuthCallback } from "./integrations/providers/cloudflare-oauth";

import { googleSignInCallback } from "./auth/api/auth-api";
import { googleCallbackPath } from "./auth/application/google-sign-in";
import { AlarmCoordinator as BaseAlarmCoordinator } from "./runtime/alarm-coordinator";

import { staticApp, securityHeaders } from "./runtime/static-app";

import { readBrowserSession } from "./auth/application/browser-session";
import { isBrowserAuthOperation } from "./api-contract";
import { protectedApiFetch } from "./protected-api";

import type { Env } from "./types";
import { authenticateAccessToken } from "./access-control/application/access-tokens";
import { ACCESS_SCOPES } from "./access-control/domain/scopes";

import { oidcApiAuth, oidcRequest } from "./auth/transport/oidc-provider";
import { xOAuthCallback } from "./integrations/providers/x-oauth-callback";
import { authenticateVmRequest, VM_GRANT_HEADER, VM_PROOF_HEADER } from "./vm-grants/application/vm-auth";

const scopes = [...ACCESS_SCOPES, "apps:manage"];
// Keep accepting grants issued by the pre-resource-scope protocol. New
// consent screens and metadata advertise only the canonical scopes above.
export class AlarmCoordinator extends BaseAlarmCoordinator {
  protected override eventEnv(): Env {
    return withOAuthProvider(this.env);
  }
}
const backend = { async fetch(request: Request, env: Env, ctx: ExecutionContext) {
  if (new URL(request.url).hostname === ghcrRegistryHost) return ghcrRegistryHttp(request, env);
  if (new URL(request.url).hostname === "git.factorize.sh") return new Response("Not found", { status: 404 });
  if (new URL(request.url).pathname === cloudflareCallback) return cloudflareOAuthCallback(request, env);
  if (new URL(request.url).pathname === googleCallbackPath) return googleSignInCallback(request, env);
  if (new URL(request.url).pathname === "/oauth/x/callback") return request.method === "GET" ? xOAuthCallback(request, env) : new Response("Method not allowed", { status: 405, headers: { Allow: "GET" } });
  const awsIssuer = awsIssuerResponse(request, env);
  if (awsIssuer) return awsIssuer;
  const oidc = await oidcRequest(request, env);
  if (oidc) return oidc;
  const staticResponse = !["/authorize", "/device"].includes(new URL(request.url).pathname) ? await staticApp(request, env) : null;
  if (staticResponse) return staticResponse;
  const oauth = provider(env);
  const url = new URL(request.url);
  const apiEnv = withOAuthProvider(env);
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
  const proxyOAuth = await proxyOAuthResponse(request, env, apiEnv, ctx);
  if (proxyOAuth) return proxyOAuth;
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
  return dispatchOAuth(request, env, ctx, oauth);
} } satisfies ExportedHandler<Env>;

export default {
  async scheduled(_event: ScheduledController, env: Env) {
    await runScheduledMaintenance(env);
  },
  async fetch(request: Request, env: Env, ctx: ExecutionContext) { return securityHeaders(request, await backend.fetch(request, env, ctx)); } } satisfies ExportedHandler<Env>;
