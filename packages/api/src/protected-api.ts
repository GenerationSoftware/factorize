import { WorkerEntrypoint } from "cloudflare:workers";
import { appConfig } from "./config/runtime";
import { ApiService } from "./api-service";
import type { Env, OAuthProps } from "./types";
import { normalizeScopes } from "./access-control/domain/scopes";
import { adoptLegacyCredential } from "./access-control/application/oauth-installations";
import { mcpOAuthChallenge, oauthResourceAuthorization, scopesForOAuthCredential } from "./transport/mcp/mcp-oauth-auth";
import { dispatchMcp } from "./transport/mcp/dispatch";
import { dispatchRest } from "./transport/rest/dispatch";
import { errorResponse } from "./transport/rest/error-response";

export async function protectedApiFetch(request: Request, env: Env, auth: OAuthProps | null, ctx: ExecutionContext): Promise<Response> {
    auth = auth ? { ...auth, scopes: normalizeScopes(auth.scopes) } : null;
    const started = performance.now();
    let service: ApiService | undefined;
    const timed = (response: Response) => {
      response.headers.set("Cache-Control", "no-store");
      response.headers.set("X-Content-Type-Options", "nosniff");
      response.headers.set("Server-Timing", `auth;dur=${(service?.authorizationDuration ?? 0).toFixed(1)}, application;dur=${Math.max(0, performance.now() - started - (service?.authorizationDuration ?? 0)).toFixed(1)}`);
      return response;
    };
    try {
      const url = new URL(request.url), path = url.pathname;
      let oauthPolicy: Awaited<ReturnType<typeof oauthResourceAuthorization>>["policy"];
      if (auth?.authMethod === "oauth" && auth.oauthGrantId) {
        const status = await oauthResourceAuthorization(env, auth, auth.oauthGrantId);
        if (status.reason) return timed(mcpOAuthChallenge(env, status.reason));
        oauthPolicy = status.policy;
        auth = { ...auth, scopes: scopesForOAuthCredential(auth.scopes, status), ...(status.installation ? {
          oauthInstallationId: status.installation.id, explicitIntegrationScopes: true,
        } : {}) };
        if (path.startsWith("/api/v1/agent/") && !auth.scopes.includes("proxy:use")) return timed(mcpOAuthChallenge(env, undefined, ["proxy:use"]));
      }
      if (path === "/mcp") return timed(await dispatchMcp(request, env, auth, ctx, oauthPolicy));
      return timed(await dispatchRest(request, url, env, auth, (principal) => service = new ApiService(env, principal, ctx)));
    } catch (error) { return timed(errorResponse(error, appConfig(env).origin)); }
}

export class ProtectedApiHandler extends WorkerEntrypoint<Env, OAuthProps> {
  async fetch(request: Request): Promise<Response> {
    let auth = this.ctx.props;
    if (auth.authMethod === "oauth" || auth.authMethod === undefined) {
      const authorization = request.headers.get("Authorization"), credential = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
      const token = credential && this.env.OAUTH_PROVIDER ? await this.env.OAUTH_PROVIDER.unwrapToken<OAuthProps>(credential) : null;
      if (!token || token.userId !== auth.userId || !token.grant?.clientId) {
        if (new URL(request.url).pathname === "/mcp") return mcpOAuthChallenge(this.env, "invalid_token");
        return Response.json({error:{code:"invalid_token",message:"Invalid OAuth authorization"}}, {status:401});
      }
      // Props describe original consent. The presented token may be narrowed.
      const tokenScopes = normalizeScopes(token.scope).filter(scope => normalizeScopes(auth.scopes).includes(scope));
      if (!auth.oauthInstallationId) await adoptLegacyCredential(this.env, auth, token.grantId, token.grant.clientId);
      auth = {...auth, authMethod: "oauth", scopes: tokenScopes, oauthGrantId: token.grantId, oauthClientId: token.grant.clientId, oauthExpiresAt: token.expiresAt};
    }
    return protectedApiFetch(request, this.env, auth, this.ctx);
  }
}
