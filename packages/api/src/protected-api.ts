import { createMcpServer } from "./transport/mcp/registry";
import { errorResponse } from "./transport/rest/error-response";
import { appConfig } from "./config/runtime";

import { adoptLegacyCredential } from "./oauth-installations";
import { mcpOAuthChallenge, oauthResourceAuthorization, scopesForOAuthCredential } from "./mcp-oauth-auth";
import { mcpMissingScopes } from "./mcp-oauth-scopes";
import { initialIntegrationOverrides } from "./oauth-reconnect";

import { Hono } from "hono";

import { WorkerEntrypoint } from "cloudflare:workers";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createMcpHonoApp } from "@modelcontextprotocol/hono";

import { ApiService, ServiceError } from "./api-service";

import type { Env, OAuthProps } from "./types";
import { executeAuth, validBrowserOrigin } from "./auth-api";
import { matchApiOperation } from "./api-contract";
import { normalizeScopes } from "./access-tokens";

import { listenForEvents } from "./subscriptions/api/event-subscription";
import { activeVmAuthorization } from "./vm-grants/application/vm-auth";

function queryInput(url: URL): Record<string, string | string[]> {
  const value: Record<string, string | string[]> = {};
  url.searchParams.forEach((item, key) => {
    const previous = value[key];
    value[key] = previous === undefined ? item : Array.isArray(previous) ? [...previous, item] : [previous, item];
  });
  return value;
}

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
      if (path === "/mcp") {
        if (!auth) return timed(mcpOAuthChallenge(env));
        const mcpService = new ApiService(env, auth);
        mcpSignals.set(mcpService,request.signal);
        if (request.method === "POST") {
          let mcpBytes=0;
          const limited = request.body?.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({
            transform(chunk,controller) { mcpBytes+=chunk.byteLength; if(mcpBytes>45_000_000) throw new ServiceError(413,"request_too_large","MCP request exceeds the proxy limit."); controller.enqueue(chunk); }
          }));
          let body: any;
          try { body = await new Response(limited).json(); } catch(error) { if(error instanceof ServiceError) throw error; throw new ServiceError(400,"invalid_request","Request body must be valid JSON."); }
          if (auth.authMethod === "oauth" && auth.oauthGrantId) {
            const missing = await mcpMissingScopes(env, auth, body, oauthPolicy ?? {
              disabled_scopes: [], integration_overrides: initialIntegrationOverrides(auth.initialIntegrationDenials),
            });
            if (missing) return timed(mcpOAuthChallenge(env, undefined, missing));
          }
          mcpBodies.set(request,body);
          if (body?.method === "subscriptions/listen" && body.params?.notifications?.resourceSubscriptions) {
            const listenerAuth = auth;
            const subscriptions = body.params.notifications.resourceSubscriptions as string[];
            const eventListener = subscriptions.length > 0 && subscriptions.every(uri => typeof uri === "string" && uri.startsWith("factorize://events/"));
            const requiredScope = "triggers:read";
            const credentialActive = async () => {
              if (listenerAuth.authMethod === "vm") return (await activeVmAuthorization(env, listenerAuth))?.includes(requiredScope) ?? false;
              if (listenerAuth.oauthGrantId) {
                const token = await env.OAUTH_PROVIDER?.unwrapToken<OAuthProps>(request.headers.get("Authorization")?.slice(7) ?? "");
                if (token?.grantId !== listenerAuth.oauthGrantId || token.expiresAt <= Date.now()/1000) return false;
                const status = await oauthResourceAuthorization(env, { ...listenerAuth, oauthExpiresAt: token.expiresAt }, token.grantId);
                if ("reason" in status && status.reason) return false;
                const tokenScopes = normalizeScopes(token.scope).filter(scope => listenerAuth.scopes.includes(scope));
                return scopesForOAuthCredential(tokenScopes, status).includes(requiredScope);
              }
              return listenerAuth.scopes.includes(requiredScope); // The database read rechecks owner membership and key activity.
            };
            if (eventListener) listeners.set(request,() => listenForEvents(request,body,mcpService,()=>createMcpServer(mcpService,true,request.signal),credentialActive,ctx).catch(error => errorResponse(error,appConfig(env).origin)));
          }
        }
        return await mcp(request, mcpService, env, ctx);
      }
      const matched = matchApiOperation(request.method, path);
      if (!matched) return Response.json({ error: { code: "not_found", message: "Not found" } }, { status: 404 });
      const { route, params } = matched;
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && (route.authOperation || auth?.authMethod === "session") && !validBrowserOrigin(request, env)) throw new ServiceError(403, "invalid_origin", "Invalid request origin.");
      if (!route.authOperation && !auth) throw new ServiceError(401, "invalid_token", "Unauthorized");
      const requiredScopes = Array.isArray(route.scope) ? route.scope : route.scope.split("+");
      if (!route.authOperation && !requiredScopes.every(scope => auth!.scopes.includes(scope))) throw new ServiceError(403, "insufficient_scope", `The ${requiredScopes.join(" and ")} scope is required.`);
      if (!route.authOperation && route.ownerSession && auth!.authMethod !== "session") throw new ServiceError(403, "session_required", "An interactive owner session is required.");
      let body: unknown;
      if (route.body) {
        if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") throw new ServiceError(415, "unsupported_media_type", "Content-Type must be application/json.");
        try {
          if (route.maxBodyBytes) {
            const reader = request.body?.getReader();
            const chunks: Uint8Array[] = []; let size = 0;
            if (reader) for (;;) {
              const { done, value } = await reader.read(); if (done) break;
              size += value.byteLength;
              if (size > route.maxBodyBytes) { await reader.cancel(); throw new ServiceError(400, "invalid_request", "Request body exceeds the byte limit."); }
              chunks.push(value);
            }
            const data = new Uint8Array(size); let offset = 0;
            for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
            body = JSON.parse(new TextDecoder().decode(data));
          } else body = await request.json();
        }
        catch (error) { if (error instanceof ServiceError) throw error; throw new ServiceError(400, "invalid_request", "Request body must be valid JSON."); }
        body = route.body.parse(body);
      }
      if (route.authOperation) return timed(await executeAuth(route.authOperation, request, env, body as Record<string, unknown>));
      service = new ApiService(env, auth!, ctx);
      const query = route.query?.parse(queryInput(url));
      const result = await route.execute(service, { params: route.parameters.parse(params) as Record<string, string>, body, query, url, signal: request.signal,request });
      return timed(result instanceof Response ? result : Response.json(result, { status: route.status }));
    } catch (error) { return timed(errorResponse(error, appConfig(env).origin)); }
}

const listeners = new WeakMap<Request,()=>Promise<Response>>();
const mcpBodies = new WeakMap<Request, unknown>();
const mcpServices = new WeakMap<Request, ApiService>();
const mcpSignals=new WeakMap<ApiService,AbortSignal>();

// The SDK owns the request-scoped transport/server lifecycle. The factory only
// resolves the service for the request being served, so tenant context cannot
// leak between concurrent MCP calls.
const mcpHandler = createMcpHandler(({ requestInfo, era }) => {
    const service = requestInfo && mcpServices.get(requestInfo);
    if (!service) throw new Error("MCP request context is unavailable");
    return createMcpServer(service,era === "modern",mcpSignals.get(service));
});

const mcpApps = new Map<string, Hono>();
function mcpAppFor(hostname: string) {
    let app = mcpApps.get(hostname);
    if (!app) {
      const protocol = createMcpHonoApp({ host: hostname, allowedHosts: [hostname], allowedOrigins: [hostname] });
      protocol.all("/mcp", async c => {
        const listener = listeners.get(c.req.raw);
        if (listener) return listener();
        const parsedBody = (c as any).get("parsedBody");
        const response = await mcpHandler.fetch(c.req.raw, { parsedBody });
        // The SDK's core discovery codec strips draft capabilities. Add the
        // Events capability after the SDK validates and encodes discovery.
        if (parsedBody?.method !== "server/discover" || !response.ok ||
            !response.headers.get("Content-Type")?.startsWith("application/json")) return response;
        const message = await response.json<{ result?: { capabilities?: Record<string, unknown> } }>();
        if (message.result?.capabilities) message.result.capabilities.events = {};
        return Response.json(message, { status: response.status, headers: response.headers });
      });
      app = new Hono();
      app.use("*",async(c,next)=> { if(mcpBodies.has(c.req.raw)) (c as any).set("parsedBody",mcpBodies.get(c.req.raw)); await next(); });
      app.route("/",protocol);
      mcpApps.set(hostname, app);
    }
    return app;
}

async function mcp(request: Request, service: ApiService, env: Env, ctx: ExecutionContext): Promise<Response> {
    mcpServices.set(request, service);
    return mcpAppFor(new URL(appConfig(env).origin).hostname).fetch(request, env, ctx);
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
