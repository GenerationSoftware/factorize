import { listEventsInput, readEventOccurrencesInput, subscribeEventInput, unsubscribeEventInput } from "./mcp-event-contracts";
import { appRegistrationInput, appRegistrationUpdate } from "./apps-contracts";
import {createPayloadInput,appendPayloadInput,finalizePayloadInput,attachmentInput} from "./proxy-payloads";
import {operationRef,operationRead} from "./proxy-operations";
import {proxyToolResult} from "./proxy-result";
import {SKILLS_EXTENSION} from "./mcp-skills";
import { effectiveConnectionScopes } from "./oauth-connection-settings";
import { clientNameInput } from "./settings-contracts";
import { BuiltinSkillError } from "./builtin-skills";
import { Hono } from "hono";
import { AgentApiError } from "./agent-api";
import {queryApiResponseInput} from "./agent-api-contracts";
import { requestApiInput, readApiResponseInput } from "./agent-api-contracts";
import { queryOf } from "./query-params";
import { WorkerEntrypoint } from "cloudflare:workers";
import { createMcpHandler, McpServer, ResourceTemplate, ProtocolError, ProtocolErrorCode } from "@modelcontextprotocol/server";
import { createMcpHonoApp } from "@modelcontextprotocol/hono";
import { z } from "zod";
import { ApiService, ServiceError } from "./api-service";
import { triggerConditionsTestSchema, triggerIdSchema, triggerInputSchema, fireTriggerInputSchema } from "./trigger-schemas";
import type { Env, OAuthProps } from "./types";
import { executeAuth, validBrowserOrigin } from "./auth-api";
import { matchApiOperation } from "./api-contract";
import { normalizeScopes } from "./access-tokens";
import { eventDefinitionInput, eventDefinitionUpdate, eventOccurrenceQuery } from "./event-contracts";
import { listenForEvents } from "./event-subscription";
import { activeVmAuthorization } from "./vm-auth";
import { vmGrantInput, vmGrantRef } from "./vm-grant-contracts";

function errorResponse(error: unknown, origin?: string): Response {
  if (error instanceof AgentApiError) return Response.json({error: {code: error.code, message: error.message}}, {status: error.status, headers: error.code === "insufficient_scope" ? {"WWW-Authenticate": `Bearer error="insufficient_scope", scope="${error.scope}", resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`} : undefined});
  if (error instanceof URIError) return Response.json({ error: { code: "invalid_request", message: "Invalid path encoding" } }, { status: 400 });
  if (error instanceof z.ZodError) {
    const imageIssue = error.issues.find(issue => issue.path.at(-1) === "vmImage" || issue.path.at(-1) === "image");
    const field = imageIssue?.path.join(".");
    const message = imageIssue && field ? `Invalid ${field}: ${imageIssue.message}` : "Request validation failed";
    return Response.json({ error: { code: "invalid_request", message, details: error.issues } }, { status: 400 });
  }
  if (error instanceof ServiceError) {
    const headers = error.code === "insufficient_scope" ? { "WWW-Authenticate": `Bearer error="insufficient_scope"` } : undefined;
    return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status, headers });
  }
  console.error("Protected API request failed", error);
  return Response.json({ error: { code: "internal_error", message: "Factorize could not complete this request." } }, { status: 500 });
}

function queryInput(url: URL): Record<string, string | string[]> {
  const value: Record<string, string | string[]> = {};
  url.searchParams.forEach((item, key) => {
    const previous = value[key];
    value[key] = previous === undefined ? item : Array.isArray(previous) ? [...previous, item] : [previous, item];
  });
  return value;
}

function structured(value: unknown) {
  const output = Array.isArray(value) ? { items: value } : value && typeof value === "object" ? value as Record<string, unknown> : { value };
  return proxyToolResult(output);
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
      if (auth?.oauthGrantId) {
        auth = { ...auth, scopes: await effectiveConnectionScopes(env, auth, auth.scopes) };
        if (path.startsWith("/api/v1/agent/") && !auth.scopes.includes("proxy:use")) throw new ServiceError(403, "insufficient_scope", "The proxy:use scope is required.");
      }
      if (path === "/mcp") {
        if (!auth) throw new ServiceError(401, "invalid_token", "Unauthorized");
        const mcpService = new ApiService(env, auth);
        mcpSignals.set(mcpService,request.signal);
        if (request.method === "POST") {
          let mcpBytes=0;
          const limited = request.body?.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({
            transform(chunk,controller) { mcpBytes+=chunk.byteLength; if(mcpBytes>45_000_000) throw new ServiceError(413,"request_too_large","MCP request exceeds the proxy limit."); controller.enqueue(chunk); }
          }));
          let body: any;
          try { body = await new Response(limited).json(); } catch(error) { if(error instanceof ServiceError) throw error; throw new ServiceError(400,"invalid_request","Request body must be valid JSON."); }
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
                const tokenScopes = normalizeScopes(token.scope).filter(scope => normalizeScopes(listenerAuth.scopes).includes(scope));
                return (await effectiveConnectionScopes(env, listenerAuth, tokenScopes)).includes(requiredScope);
              }
              return listenerAuth.scopes.includes(requiredScope); // The database read rechecks owner membership and key activity.
            };
            if (eventListener) listeners.set(request,() => listenForEvents(request,body,mcpService,()=>createMcpServer(mcpService),credentialActive,ctx).catch(error => errorResponse(error,env.APP_ORIGIN)));
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
    } catch (error) { return timed(errorResponse(error, env.APP_ORIGIN)); }
}

const listeners = new WeakMap<Request,()=>Promise<Response>>();
const mcpBodies = new WeakMap<Request, unknown>();
const mcpServices = new WeakMap<Request, ApiService>();
const mcpSignals=new WeakMap<ApiService,AbortSignal>();


function createMcpServer(service: ApiService, subscriptions = true): McpServer {
    const server = new McpServer({ name: "factorize", version: "1.0.0" }, {capabilities:{resources:{subscribe:subscriptions},extensions:{[SKILLS_EXTENSION]:{}}}});
    const resourceAction=async<T>(action:()=>Promise<T>):Promise<T>=> {
      try{return await action();}catch(error){
        if(error instanceof BuiltinSkillError)throw new ProtocolError(ProtocolErrorCode.InvalidParams,error.message);
        if(error instanceof ServiceError)throw new ProtocolError(ProtocolErrorCode.InvalidParams,`${error.code}: ${error.message}`);
        throw error;
      }
    };
    const eventAction = async <T>(action: () => Promise<T>): Promise<T> => {
      try { return await action(); }
      catch (error) {
        if (error instanceof ServiceError && (error.status === 401 || error.status === 403)) {
          throw new ProtocolError(-32024, error.message);
        }
        if (error instanceof ProtocolError) throw error;
        throw new ProtocolError(ProtocolErrorCode.InternalError, "Factorize could not complete this Events request.");
      }
    };
    server.server.setRequestHandler("events/list", { params: listEventsInput }, params => eventAction(() => service.mcpEventCatalog(params.cursor)));
    server.server.setRequestHandler("events/subscribe", { params: subscribeEventInput }, params => eventAction(() => service.mcpSubscribeEvent(params)));
    server.server.setRequestHandler("events/unsubscribe", { params: unsubscribeEventInput }, params => eventAction(() => service.mcpUnsubscribeEvent(params)));
    server.server.setRequestHandler("skills/list",{params:z.object({cursor:z.guid().optional(),_meta:z.record(z.string(),z.unknown()).optional()})},params=>resourceAction(()=>service.mcpListSkills(params.cursor)));
    server.server.setRequestHandler("skills/get",{params:z.object({uri:z.string(),_meta:z.record(z.string(),z.unknown()).optional()})},params=>resourceAction(()=>service.mcpGetSkill(params.uri)));
    server.registerResource("factorize-workflow",new ResourceTemplate("skill://factorize/{version}/{name}/SKILL.md",{list:undefined}),{description:"Build-shipped Factorize workflow instructions"},uri=>resourceAction(()=>service.mcpReadSkill(uri.href)));
    server.registerResource("event-occurrences",new ResourceTemplate("factorize://events/{eventId}/occurrences",{list:undefined}),{mimeType:"application/json",description:"Durable occurrences of an authorized Factorize Event"},uri=>resourceAction(()=>service.mcpReadEvent(uri.href)));
        server.registerResource("proxy-response",new ResourceTemplate("proxy://responses/{handle}",{list:undefined}),{mimeType:"application/json",description:"Bounded authorized retained response byte range; use query_api_response for filtering."},async uri=>({contents:[{uri:uri.href,mimeType:"application/json",text:JSON.stringify(await service.queryApiResponse({handle:uri.pathname.slice(1),mode:"bytes",limit:256}))}]}));
        const tool = <T>(name: string, description: string, schema: any, action: (input: T,signal?:AbortSignal) => Promise<unknown>,rawContent=false,readOnly=false) => server.registerTool(name, { description, inputSchema: schema, ...(readOnly ? { annotations: { readOnlyHint: true, openWorldHint: false } } : {}) }, async (input: T,context:{mcpReq:{signal:AbortSignal;_meta?:{progressToken?:string|number};notify:(value:any)=>Promise<void>}}) => {
      try { const requestSignal=mcpSignals.get(service);const token=context.mcpReq._meta?.progressToken;
        if(token!==undefined)await context.mcpReq.notify({method:"notifications/progress",params:{progressToken:token,progress:0,total:1,message:"Processing request"}}).catch(()=>{});
        const result=await action(input,requestSignal?AbortSignal.any([context.mcpReq.signal,requestSignal]):context.mcpReq.signal);if(token!==undefined)await context.mcpReq.notify({method:"notifications/progress",params:{progressToken:token,progress:1,total:1,message:"Result available; poll operation handles for upstream progress"}}).catch(()=>{});return rawContent?result as any:structured(result); }
      catch (error) { const response = errorResponse(error), detail = await response.json() as any; throw new Error(`${detail.error?.code ?? "operation_failed"}: ${detail.error?.message ?? "Operation failed"}`); }
    });
    tool("rename_mcp_client", "Set the display name of this OAuth connection in Authorized clients.", clientNameInput, input => service.renameMcpClient(input));
                tool("get_api_reflection", "Use this first to discover authorized integration APIs and request_api examples. Call request_api with the returned integration ID; no shell or raw credential is needed. Availability is not a credential health check.", z.object({}), () => service.getApiReflection());
    tool("request_api","Call an integration discovered by get_api_reflection. Use its integration ID and relative path; no VM, shell or credential is needed. Credentials stay in Factorize. OAuth requires proxy:use. Use read_api_response for retained response handles.",requestApiInput,(input:any,signal)=>service.requestApiMcp({...input,maxResultBytes:input.maxResultBytes??4096},signal));
    tool("read_api_response","Read a retained integration response chunk with the same authorization as the original request.",readApiResponseInput,(input:any)=>service.readApiResponse({...input,limit:Math.min(input.limit??384,384)}));
    tool("create_payload","Reserve a temporary request body. Open browserUploadUrl to upload an existing file for that connection, or append/finalize generated text in chunks. Pass the finalized handle to request_api bodySource.",createPayloadInput,input=>service.createProxyPayload(input));
    tool("append_payload_chunk","Append a small generated UTF8/base64 chunk at the returned payload byte size. Identical retries are safe.",appendPayloadInput,input=>service.appendProxyPayload(input));
    tool("finalize_payload","Finalize an immutable request payload; optional SHA256 verifies exact bytes.",finalizePayloadInput,input=>service.finalizeProxyPayload(input));
    server.registerTool("import_attachment",{description:"Import a user-attached ChatGPT file directly into temporary artifact storage. Returns a payload handle for request_api. Missing native download URLs require create_payload and its browserUploadUrl.",inputSchema:attachmentInput,_meta:{"openai/fileParams":["file"]}},async input=>structured(await service.importProxyAttachment(input)));
    tool("fetch_payload","Import unchanged file bytes from an authorized integration into a temporary request payload.",z.object({integration:z.uuid(),path:z.string().min(1).max(8192),name:z.string().optional(),mediaType:z.string().optional()}),(input:any)=>service.fetchProxyPayload(input));
    tool("get_api_operation","Poll a durable HTTP operation. Does not repeat the upstream request.",operationRef,input=>service.getApiOperation(input));
    tool("read_api_operation","Read bounded incremental response bytes, including partial bytes after failure. Poll get_api_operation for status.",operationRead,input=>service.readApiOperation(input));
    tool("cancel_api_operation","Cancel an HTTP operation. Upstream writes may already have taken effect.",operationRef,input=>service.cancelApiOperation(input));
    tool("query_api_response","Query a retained response without loading it into context. JSON supports bounded JMESPath fields/projections/filters, text uses line offsets, bytes uses byte offsets. Parsing is limited to 1 MiB; use byte ranges for larger bodies.",queryApiResponseInput,input=>service.queryApiResponse(input));
    tool("list_exe_connections", "List safe metadata for saved exe.dev connections. API tokens are never returned.", z.object({}), () => service.listExeConnections());
    tool("list_vms", "List active Factorize permission grants for team VMs. Requires vms:read.", z.object({}), () => service.listVmGrants());
    tool("grant_vm_permissions", "Grant or replace Factorize permissions for an existing VM. Use a preset or explicit scope list within your effective access. Requires vms:edit.", vmGrantInput, input => service.grantVmPermissions(input));
    tool("revoke_vm_permissions", "Revoke a VM's Factorize permissions. The VM keeps running. Requires vms:edit.", vmGrantRef, (input: z.infer<typeof vmGrantRef>) => service.revokeVmPermissions(input.grantId));
    tool("list_apps", "List the team's registered server-side apps. Requires apps:manage.", z.object({}), () => service.listApps());
    tool("get_app", "Read a registered app's non-secret metadata.", z.object({appId:z.uuid()}), ({appId}: any) => service.getApp(appId));
    tool("create_app", "Register a server-side app. Create client secrets separately in the browser.", appRegistrationInput, input => service.createApp(input));
    tool("update_app", "Update redirect URLs, visibility, or enabled state for a registered app.", appRegistrationUpdate.extend({appId:z.uuid()}), ({appId,...input}: any) => service.updateApp(appId,input));
        tool("list_github_installations", "List connected GitHub App installations, including the installation IDs needed by GitHub Trigger events. Credentials are never returned.", z.object({}), () => service.listGitHubInstallations());
    tool("list_events", "List Events, their current payload schema revisions, and Trigger and occurrence counts.", z.object({}), () => service.listEvents());
    tool("get_event", "Read an Event and its current payload schema revision.", z.object({eventId:z.uuid()}), ({eventId}:any) => service.getEvent(eventId));
    tool("create_event", "Create a durable Event that one or more Triggers can publish.", eventDefinitionInput, (input:any) => service.createEvent(input));
    tool("update_event", "Create a new Event payload schema revision; existing occurrences retain their original revision.", eventDefinitionUpdate.extend({eventId:z.uuid()}), ({eventId,...input}:any) => service.updateEvent(eventId,input));
    tool("delete_event", "Permanently delete an Event, all its Triggers and input configurations, and its occurrence history.", z.object({eventId:z.uuid()}), ({eventId}:any) => service.deleteEvent(eventId));
    tool("read_event_occurrences", "Read committed Event payloads by occurrenceId or by definitionId and an inclusive recorded-time since value. Follow nextCursor with the same definitionId and since. Reads do not consume history.", readEventOccurrencesInput, (input: z.infer<typeof readEventOccurrencesInput>) => service.readEventOccurrences(input), false, true);
    tool("list_event_occurrences", "Read durable Event occurrences in reverse order.", z.object({eventId:z.uuid(),...eventOccurrenceQuery.shape}), ({eventId,limit,cursor}:any) => service.listEventOccurrences(eventId,limit,cursor));
                                tool("list_triggers", "List triggers and their parent Events", z.object({}), () => service.listTriggers());
                                            tool("get_trigger", "Get a Trigger, its parent Event, and input configuration", triggerIdSchema, ({ triggerId }: any) => service.getTrigger(triggerId));
    tool("create_trigger", "Create an input Trigger attached to an Event. Credentials are never accepted or returned.", triggerInputSchema, (input: any) => service.createTrigger(input));
    tool("update_trigger", "Replace a Trigger's input configuration and Event parent.", triggerInputSchema.extend({ triggerId: z.string().min(1) }), ({ triggerId, ...input }: any) => service.updateTrigger(triggerId, input));
    tool("delete_trigger", "Delete an input Trigger", triggerIdSchema, ({ triggerId }: any) => service.deleteTrigger(triggerId));
    tool("enable_trigger", "Enable a trigger", triggerIdSchema, ({ triggerId }: any) => service.setTriggerEnabled(triggerId, true));
    tool("disable_trigger", "Disable a trigger", triggerIdSchema, ({ triggerId }: any) => service.setTriggerEnabled(triggerId, false));
        tool("fire_trigger", "Fire an enabled Trigger and persist an Event occurrence. Reuse idempotencyKey to make retries safe.", fireTriggerInputSchema.extend({ triggerId: z.uuid() }), ({ triggerId, ...input }: any) => service.fireTrigger(triggerId, input));
            tool("list_trigger_webhook_activity", "List matching, rejected, duplicate, and accepted webhook activity for a trigger", z.object({ triggerId: z.string().min(1), limit: z.number().int().min(1).max(100).default(50) }), ({ triggerId, limit }: any) => service.listTriggerEvents(triggerId, limit));
    tool("list_webhook_deliveries", "Search tenant-scoped webhook deliveries by provider, delivery ID, event, outcome, trigger, time range, or safe diagnostic text. Results are newest first and cursor paginated.", z.object({ provider: z.string().optional(), deliveryId: z.string().optional(), event: z.string().optional(), action: z.string().optional(), outcome: z.string().optional(), triggerId: z.string().optional(), q: z.string().optional(), from: z.string().optional(), to: z.string().optional(), limit: z.number().int().min(1).max(100).default(50), cursor: z.string().optional() }), (input: any) => service.listWebhookDeliveries(queryOf(input)));
    tool("get_webhook_delivery", "Get a webhook delivery and its safe processing timeline. Secrets and payloads are never returned.", z.object({ deliveryId: z.string().min(1) }), ({ deliveryId }: any) => service.getWebhookDelivery(deliveryId));
    tool("test_trigger_webhook_conditions", "Evaluate conditions on supplied prepared webhook context. No authentication of the example, routing, live GitHub verification, or Trigger firing.", triggerConditionsTestSchema, (input: any) => service.testTriggerConditions(input));
    tool("list_cloudflare_tail_integrations", "List installed Cloudflare Tail integrations and reference counts. Signing secrets are never returned.", z.object({}), () => service.listTailIntegrations());
    return server;
}

// The SDK owns the request-scoped transport/server lifecycle. The factory only
// resolves the service for the request being served, so tenant context cannot
// leak between concurrent MCP calls.
const mcpHandler = createMcpHandler(({ requestInfo, era }) => {
    const service = requestInfo && mcpServices.get(requestInfo);
    if (!service) throw new Error("MCP request context is unavailable");
    return createMcpServer(service,era === "modern");
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
    return mcpAppFor(new URL(env.APP_ORIGIN).hostname).fetch(request, env, ctx);
  }

export class ProtectedApiHandler extends WorkerEntrypoint<Env, OAuthProps> {
  async fetch(request: Request): Promise<Response> {
    let auth = this.ctx.props;
    if (auth.authMethod === "oauth" || auth.authMethod === undefined) {
      const authorization = request.headers.get("Authorization"), credential = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
      const token = credential && this.env.OAUTH_PROVIDER ? await this.env.OAUTH_PROVIDER.unwrapToken<OAuthProps>(credential) : null;
      if (!token || token.userId !== auth.userId || !token.grant?.clientId) return Response.json({error:{code:"invalid_token",message:"Invalid OAuth authorization"}}, {status:401});
      // Props describe original consent. The presented token may be narrowed.
      const tokenScopes = normalizeScopes(token.scope).filter(scope => normalizeScopes(auth.scopes).includes(scope));
      auth = {...auth, authMethod: "oauth", scopes: tokenScopes, oauthGrantId: token.grantId, oauthClientId: token.grant.clientId, oauthExpiresAt: token.expiresAt};
    }
    return protectedApiFetch(request, this.env, auth, this.ctx);
  }
}
