import { Hono } from "hono";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createMcpHonoApp } from "@modelcontextprotocol/hono";
import { ApiService } from "../../api-service";
import { ServiceError } from "../../service-contract";
import { appConfig } from "../../config/runtime";
import type { Env, OAuthProps } from "../../types";
import { normalizeScopes } from "../../access-control/domain/scopes";
import { initialIntegrationOverrides } from "../../access-control/application/oauth-reconnect";
import { listenForEvents } from "../../subscriptions/api/event-subscription";
import { activeVmAuthorization } from "../../vm-grants/application/vm-auth";
import { errorResponse } from "../rest/error-response";
import { createMcpServer } from "./registry";
import { mcpOAuthChallenge, oauthResourceAuthorization, scopesForOAuthCredential } from "./mcp-oauth-auth";
import { mcpMissingScopes } from "./mcp-oauth-scopes";

export async function dispatchMcp(request: Request, env: Env, auth: OAuthProps | null, ctx: ExecutionContext, oauthPolicy: Awaited<ReturnType<typeof oauthResourceAuthorization>>["policy"]): Promise<Response> {
  if (!auth) return mcpOAuthChallenge(env);
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
      }, !!auth.oauthInstallationId && !!auth.oauthIssuanceId);
      if (missing) return mcpOAuthChallenge(env, undefined, missing);
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
