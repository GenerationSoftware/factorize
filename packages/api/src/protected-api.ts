import { presetInput } from "./presets";
import { skillTriggerInput } from "./skill-trigger";
import { skillInput,skillUpdateInput } from "./skills";
import { PresetError } from "./postgres/preset-repository";
import {createPayloadInput,appendPayloadInput,finalizePayloadInput,attachmentInput} from "./proxy-payloads";
import {operationRef,operationRead} from "./proxy-operations";
import {proxyToolResult} from "./proxy-result";
import {mediaRef,fetchMediaInput} from "./media-contracts";
import {authenticateHostedRunRequest} from "./hosted-run-auth";
import {SKILLS_EXTENSION} from "./mcp-skills";
import { previewSkillInput } from "./skills";
import { disabledConnectionScopes } from "./oauth-connection-settings";
import { clientNameInput } from "./settings-contracts";
import { SkillContentError } from "./skill-files";
import { listenForOutcomes, outcomeRunId } from "./run-outcome-subscription";
import { authenticateVendorRunRequest } from "./vendor-run-auth";
import { Hono } from "hono";
import { AgentApiError } from "./agent-api";
import {queryApiResponseInput} from "./agent-api-contracts";
import { vmExecInput, grantVmInput, revokeVmInput, requestApiInput, readApiResponseInput } from "./agent-api-contracts";
import { ExeIntegrationError } from "./exe-vm-backend";
import { queryOf } from "./query-params";
import { triggerUpdateInput } from "./job-contracts";
import { InvocationError } from "./job-domain";
import { WorkerEntrypoint } from "cloudflare:workers";
import { createMcpHandler, McpServer, ResourceTemplate, ProtocolError, ProtocolErrorCode } from "@modelcontextprotocol/server";
import { createMcpHonoApp } from "@modelcontextprotocol/hono";
import { z } from "zod";
import { ApiService, ServiceError } from "./flow-service";
import { startRunInput,triggerConditionsTestSchema, triggerIdSchema, triggerInputSchema, listRunsSchema, manualInvocationSchema, renameRunSchema, reportRunErrorSchema, runIdSchema } from "./flow-schemas";
import type { Env, OAuthProps } from "./types";
import { executeAuth, validBrowserOrigin } from "./auth-api";
import { matchApiOperation } from "./api-contract";
import { normalizeScopes } from "./access-tokens";

function errorResponse(error: unknown, origin?: string): Response {
  if (error instanceof PresetError) return Response.json({error:{code:error.code,message:error.message}},{status:error.status});
  if (error instanceof SkillContentError) return Response.json({ error: { code: "invalid_skill_directory", message: error.message } }, {status:409});
  if (error instanceof AgentApiError) return Response.json({error: {code: error.code, message: error.message}}, {status: error.status, headers: error.code === "insufficient_scope" ? {"WWW-Authenticate": `Bearer error="insufficient_scope", scope="${error.scope}", resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`} : undefined});
  if (error instanceof ExeIntegrationError) return Response.json({ error: { code: "invalid_request", message: error.message } }, { status: 400 });
  if (error instanceof URIError) return Response.json({ error: { code: "invalid_request", message: "Invalid path encoding" } }, { status: 400 });
  if (error instanceof InvocationError) return Response.json({error:{code:error.code,message:error.message}},{status:error.code==="trigger_not_found"?404:error.code==="queue_full"||error.code==="trigger_disabled"?409:400});
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
        const disabled = await disabledConnectionScopes(env, auth);
        auth = { ...auth, scopes: auth.scopes.filter(scope => !disabled.includes(scope)) };
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
            const credentialActive = async () => {
              if(listenerAuth.authMethod==="hosted_pi")return !!await authenticateHostedRunRequest(request,env);
              if (listenerAuth.authMethod === "vendor_identity") return !!await authenticateVendorRunRequest(request,env);
              if (listenerAuth.oauthGrantId) {
                const token = await env.OAUTH_PROVIDER?.unwrapToken<OAuthProps>(request.headers.get("Authorization")?.slice(7) ?? "");
                return token?.grantId === listenerAuth.oauthGrantId && token.expiresAt > Date.now()/1000 && normalizeScopes(token.scope).includes("runs:read") && !(await disabledConnectionScopes(env, listenerAuth)).includes("runs:read");
              }
              return true; // outcomeStates rechecks API key and owner membership.
            };
            listeners.set(request,() => listenForOutcomes(request,body,mcpService,()=>createMcpServer(mcpService),credentialActive,ctx).catch(error => errorResponse(error,env.APP_ORIGIN)));
          }
        }
        return await mcp(request, mcpService, env, ctx);
      }
      const matched = matchApiOperation(request.method, path);
      if (!matched) return Response.json({ error: { code: "not_found", message: "Not found" } }, { status: 404 });
      const { route, params } = matched;
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && (route.authOperation || auth?.authMethod === "session") && !validBrowserOrigin(request, env)) throw new ServiceError(403, "invalid_origin", "Invalid request origin.");
      if (!route.authOperation && !auth) throw new ServiceError(401, "invalid_token", "Unauthorized");
      if (route.vendorIdentityOnly && (auth?.authMethod !== "vendor_identity" || !auth.runId)) throw new ServiceError(403, "forbidden", "A vendor-verified run identity is required.");
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
    const skillAction=async<T>(action:()=>Promise<T>):Promise<T>=> {
      try{return await action();}catch(error){
        if(error instanceof SkillContentError)throw new ProtocolError(ProtocolErrorCode.InvalidParams,error.message);
        if(error instanceof ServiceError)throw new ProtocolError(ProtocolErrorCode.InvalidParams,`${error.code}: ${error.message}`);
        throw error;
      }
    };
    server.server.setRequestHandler("skills/list",{params:z.object({cursor:z.guid().optional(),_meta:z.record(z.string(),z.unknown()).optional()})},params=>skillAction(()=>service.mcpListSkills(params.cursor)));
    server.server.setRequestHandler("skills/get",{params:z.object({uri:z.string(),_meta:z.record(z.string(),z.unknown()).optional()})},params=>skillAction(()=>service.mcpGetSkill(params.uri)));
    server.registerResource("team-skill",new ResourceTemplate("skill://teams/{teamId}/{+path}",{list:undefined}),{description:"Authorized team skill package files"},uri=>skillAction(()=>service.mcpReadSkill(uri.href)));
    server.registerResource("run-input-skill",new ResourceTemplate("skill://runs/{teamId}/{runId}/{+path}",{list:undefined}),{description:"Pinned skill input files belonging to the active run"},uri=>skillAction(()=>service.mcpReadSkill(uri.href)));
    server.registerResource("proxy-response",new ResourceTemplate("proxy://responses/{handle}",{list:undefined}),{mimeType:"application/json",description:"Bounded authorized retained response byte range; use query_api_response for filtering."},async uri=>({contents:[{uri:uri.href,mimeType:"application/json",text:JSON.stringify(await service.queryApiResponse({handle:uri.pathname.slice(1),mode:"bytes",limit:256}))}]}));
    server.registerResource("run-outcome",new ResourceTemplate("factorize://runs/{runId}/outcome",{list:undefined}),
      {mimeType:"application/json",description:"Pending or terminal outcome of an authorized run"},async uri=>({
        contents:[{uri:uri.href,mimeType:"application/json",text:JSON.stringify(await service.runOutcome(outcomeRunId(uri.href)))}],
      }));
    const tool = <T>(name: string, description: string, schema: any, action: (input: T,signal?:AbortSignal) => Promise<unknown>,rawContent=false) => server.registerTool(name, { description, inputSchema: schema }, async (input: T,context:{mcpReq:{signal:AbortSignal;_meta?:{progressToken?:string|number};notify:(value:any)=>Promise<void>}}) => {
      try { const requestSignal=mcpSignals.get(service);const token=context.mcpReq._meta?.progressToken;
        if(token!==undefined)await context.mcpReq.notify({method:"notifications/progress",params:{progressToken:token,progress:0,total:1,message:"Processing request"}}).catch(()=>{});
        const result=await action(input,requestSignal?AbortSignal.any([context.mcpReq.signal,requestSignal]):context.mcpReq.signal);if(token!==undefined)await context.mcpReq.notify({method:"notifications/progress",params:{progressToken:token,progress:1,total:1,message:"Result available; poll operation handles for upstream progress"}}).catch(()=>{});return rawContent?result as any:structured(result); }
      catch (error) { const response = errorResponse(error), detail = await response.json() as any; throw new Error(`${detail.error?.code ?? "operation_failed"}: ${detail.error?.message ?? "Operation failed"}`); }
    });
    tool("rename_mcp_client", "Set the display name of this OAuth connection in Authorized clients.", clientNameInput, input => service.renameMcpClient(input));
    tool("fetch_media","Fetch unchanged image bytes from an authorized integration API into this run's scratch space. Use read_media to inspect the returned artifactId. The pinned Pi framework accepts image content.",fetchMediaInput,(input,signal)=>service.fetchMedia(input,signal));
    tool("read_media","Read an authorized input or scratch image as an MCP image content block.",mediaRef,input=>service.readMedia(mediaRef.parse(input).artifactId),true);
    tool("vm_exec","Execute a shell command in this run's server-bound workspace VM. Reflect first. Commands run in the VM; Pi itself runs in Factorize. No arbitrary VM selection.",vmExecInput,(input,signal)=>service.vmExec(vmExecInput.parse(input),signal));
    tool("get_api_reflection", "Use this first to discover authorized integration APIs and request_api examples. Call request_api with the returned integration ID; no shell or raw credential is needed. Availability is not a credential health check.", z.object({}), () => service.getApiReflection());
    tool("request_api","Call an integration discovered by get_api_reflection. Use its integration ID and relative path; no VM, shell or credential is needed. Credentials stay in Factorize. OAuth requires proxy:use. Use read_api_response for retained response handles.",requestApiInput,(input:any,signal)=>service.requestApiMcp({...input,maxResultBytes:input.maxResultBytes??4096},signal));
    tool("read_api_response","Read a retained integration response chunk with the same authorization as the original request.",readApiResponseInput,(input:any)=>service.readApiResponse({...input,limit:Math.min(input.limit??384,384)}));
    tool("create_payload","Reserve a temporary request body. Open browserUploadUrl to upload an existing file without a run, or append/finalize generated text in chunks. Pass the finalized handle to request_api bodySource.",createPayloadInput,input=>service.createProxyPayload(input));
    tool("append_payload_chunk","Append a small generated UTF8/base64 chunk at the returned payload byte size. Identical retries are safe.",appendPayloadInput,input=>service.appendProxyPayload(input));
    tool("finalize_payload","Finalize an immutable request payload; optional SHA256 verifies exact bytes.",finalizePayloadInput,input=>service.finalizeProxyPayload(input));
    server.registerTool("import_attachment",{description:"Import a user-attached ChatGPT file directly into temporary artifact storage. Returns a payload handle for request_api. Missing native download URLs require create_payload and its browserUploadUrl.",inputSchema:attachmentInput,_meta:{"openai/fileParams":["file"]}},async input=>structured(await service.importProxyAttachment(input)));
    tool("fetch_payload","Import unchanged file bytes from an authorized integration into a temporary request payload.",z.object({integration:z.uuid(),path:z.string().min(1).max(8192),name:z.string().optional(),mediaType:z.string().optional()}),(input:any)=>service.fetchProxyPayload(input));
    tool("get_api_operation","Poll a durable HTTP operation. Does not repeat the upstream request.",operationRef,input=>service.getApiOperation(input));
    tool("read_api_operation","Read bounded incremental response bytes, including partial bytes after failure. Poll get_api_operation for status.",operationRead,input=>service.readApiOperation(input));
    tool("cancel_api_operation","Cancel an HTTP operation. Upstream writes may already have taken effect.",operationRef,input=>service.cancelApiOperation(input));
    tool("query_api_response","Query a retained response without loading it into context. JSON supports bounded JMESPath fields/projections/filters, text uses line offsets, bytes uses byte offsets. Parsing is limited to 1 MiB; use byte ranges for larger bodies.",queryApiResponseInput,input=>service.queryApiResponse(input));
    tool("grant_vm", "Delegate selected proxy integrations to a VM on a supported provider connection.", grantVmInput, (input) => service.grantVm(input));
    tool("revoke_vm_grant", "Revoke proxy access for an externally managed VM.", revokeVmInput, ({grantId}: any) => service.revokeVmGrant(grantId));
    tool("list_exe_connections", "List safe metadata for saved exe.dev connections. API tokens are never returned.", z.object({}), () => service.listExeConnections());
    tool("get_runtime_context", "Inspect the verified invocation identity without exposing credentials.", z.object({}), () => service.getRuntimeContext());
    tool("list_github_installations", "List connected GitHub App installations, including the installation IDs needed by GitHub Trigger events. Credentials are never returned.", z.object({}), () => service.listGitHubInstallations());
    tool("list_runs", "List authoritative trigger runs by trigger ID, state, an optional case-insensitive literal substring of fired context, and validated sort field/direction. Sorting is applied before cursor pagination with deterministic ID tie-breaking. Automatic webhook, schedule, and lifecycle signals coalesce, so query runs and the provider API for authoritative work. Context matches include only a bounded excerpt.", listRunsSchema, (input: any) => service.listRuns(queryOf(input)));
    tool("get_run", "Get a run with its rendered prompt, full fired context, invocation metadata, execution metadata, output, and activity. For manual invocations, invocation.idempotency_key is the client-reusable value; invocation.claim_key is internal.", runIdSchema, ({ runId }: any) => service.getRun(runId));
    tool("rename_run", "Rename a run without changing its execution. Supply expectedName to reject stale edits; names are trimmed and must contain 1 to 120 characters.", runIdSchema.extend(renameRunSchema.shape), ({ runId, ...input }: any) => service.renameRun(runId, input));
    tool("get_run_diagnostics", "Get credential-safe launch, prompt delivery, output capture, claim release, cleanup, and activity diagnostics for a run.", runIdSchema, ({ runId }: any) => service.getRunDiagnostics(runId));
    tool("report_run_error", "Record an error reason for an active run and continue execution. Identical retries are idempotent; a different reason conflicts. Finish remaining work, then exit normally. Terminal runs reject reports.", runIdSchema.extend(reportRunErrorSchema.shape).strict(), ({ runId, reason }: any) => service.reportRunError(runId, { reason }));
    tool("stop_run", "Stop an active run", runIdSchema, ({ runId }: any) => service.stopRun(runId));
    tool("kill_run", "Force a run in any non-terminal state to stop immediately, release its concurrency slot, and clean up its backend asynchronously.", runIdSchema, ({ runId }: any) => service.killRun(runId));
    tool("list_triggers", "List triggers with their current run count and maximum concurrency", z.object({}), () => service.listTriggers());
    tool("list_skills", "List searchable team skill metadata. Shared edits affect every trigger using the skill; bodies are omitted.", z.object({ q: z.string().optional(), limit: z.number().int().min(1).max(100).default(30), cursor: z.string().optional() }), (input: any) => service.listSkills({ q: input.q ?? "", limit: input.limit, cursor: input.cursor }));
    tool("get_skill", "Read a team skill by stable ID or key. Shared edits affect every trigger using it.", z.object({ skillId: z.string().min(1) }), ({ skillId }: any) => service.getSkill(skillId));
    tool("create_skill", "Create a SKILL.md with literal Markdown and frontmatter configuration. Supply body or a structured definition; omitted preset slugs inherit team defaults.", skillInput, (input: any) => service.createSkill(input));
    tool("update_skill", "Update a shared team skill with optimistic concurrency; the change affects all referencing triggers.", skillUpdateInput.extend({skillId:z.string().min(1)}), ({ skillId, ...input }: any) => service.updateSkill(skillId, input));
    tool("delete_skill", "Delete an unused team skill; referenced triggers block deletion.", z.object({ skillId: z.string().min(1), expectedRevision: z.number().int().positive() }), ({ skillId, expectedRevision }: any) => service.deleteSkill(skillId, expectedRevision));
    tool("list_skill_triggers", "List enabled and disabled triggers affected by a shared skill.", z.object({ skillId: z.string().min(1) }), ({ skillId }: any) => service.listSkillTriggers(skillId));
    tool("preview_trigger_prompt", "Preview one skill, literal prompt, Event template and manual instructions without saving or executing.", previewSkillInput, (input: any) => service.previewTriggerPrompt(input));
    tool("list_presets","List team VM, permission and model presets, defaults, immutable slugs and revisions.",z.object({}),()=>service.listPresets());
    tool("create_preset","Create a team preset. Slugs are immutable and unique within preset type/team.",presetInput,(input:any)=>service.savePreset(input));
    tool("update_preset","Update a preset by creating an immutable revision; existing runs retain snapshots.",z.object({presetId:z.uuid(),preset:presetInput}),({presetId,preset}:any)=>service.savePreset(preset,presetId));
    tool("set_default_preset","Select the team default for the preset's type. Future inherited runs use it.",z.object({presetId:z.uuid()}),({presetId}:any)=>service.defaultPreset(presetId));
    tool("delete_preset","Delete an unused non-default preset; historical revisions and accepted runs remain.",z.object({presetId:z.uuid()}),({presetId}:any)=>service.deletePreset(presetId));
    tool("get_skill_trigger","Read a skill's automatic trigger configuration. Legacy manual events are hidden.",z.object({skillId:z.uuid()}),({skillId}:any)=>service.getSkillTrigger(skillId));
    tool("save_skill_trigger","Save only non-manual automation for a skill. SKILL.md owns all execution configuration.",z.object({skillId:z.uuid(),trigger:skillTriggerInput}),({skillId,trigger}:any)=>service.saveSkillTrigger(skillId,trigger));
    tool("get_team", "Inspect the current team and its run defaults", z.object({}), () => service.getTeam());
    tool("get_trigger", "Get a trigger with its current run count and maximum concurrency", triggerIdSchema, ({ triggerId }: any) => service.getTrigger(triggerId));
    tool("create_trigger", "Create a trigger using a saved execution integration ID. Credentials are never accepted or returned.", triggerInputSchema, (input: any) => service.createTrigger(input));
    tool("update_trigger", "Replace a trigger configuration. Credentials are never accepted or returned.", triggerUpdateInput.extend({ triggerId: z.string().min(1) }), ({ triggerId, ...input }: any) => service.updateTrigger(triggerId, input));
    tool("delete_trigger", "Delete a saved trigger and its events, retaining its runs", triggerIdSchema, ({ triggerId }: any) => service.deleteTrigger(triggerId));
    tool("enable_trigger", "Enable a trigger", triggerIdSchema, ({ triggerId }: any) => service.setTriggerEnabled(triggerId, true));
    tool("disable_trigger", "Disable a trigger", triggerIdSchema, ({ triggerId }: any) => service.setTriggerEnabled(triggerId, false));
    tool("start_run","Start an agent run with optional skill, prompt and images. Skill frontmatter selects VM, permission and model presets; omitted selections inherit team defaults. Freeze resolved preset revisions and skill commit before queueing. Disabled skills cannot start, concurrency 0 is unlimited, and scripts are retired. Caller permissions bound direct run access. Subscribe to the returned outcome URI.",startRunInput,(input:any)=>service.startRun(input));
    tool("invoke_trigger", "Invoke a trigger's manual event with an optional display name, prompt, and JSON data exposed beneath that event's stable slug. Manual invocations are never coalesced; a full trigger queue returns queue_full. idempotencyKey is a client value and must not include the internal manual: claim-key prefix; reuse invocation.idempotency_key from get_run.", manualInvocationSchema.extend({ triggerId: z.string().min(1) }), ({ triggerId, ...input }: any) => service.invokeTrigger(triggerId, input));
    tool("get_trigger_invocation_permissions", "List the destinations a source trigger may manually invoke.", triggerIdSchema, ({ triggerId }: any) => service.getInvocationPermissions(triggerId));
    tool("set_trigger_invocation_permissions", "Replace manual invocation destinations for a source trigger. Requires an owner session, scoped API key, or authorized OAuth client with triggers:write; destination IDs must belong to the same tenant.", z.object({ triggerId: z.string().min(1), destinationTriggerIds: z.array(z.string().uuid()).max(1000) }).strict(), ({ triggerId, destinationTriggerIds }: any) => service.setInvocationPermissions(triggerId, destinationTriggerIds));
    tool("list_trigger_webhook_activity", "List matching, rejected, duplicate, and accepted webhook activity for a trigger", z.object({ triggerId: z.string().min(1), limit: z.number().int().min(1).max(100).default(50) }), ({ triggerId, limit }: any) => service.listTriggerEvents(triggerId, limit));
    tool("list_webhook_deliveries", "Search tenant-scoped webhook deliveries by provider, delivery ID, event, outcome, trigger, time range, or safe diagnostic text. Results are newest first and cursor paginated.", z.object({ provider: z.string().optional(), deliveryId: z.string().optional(), event: z.string().optional(), action: z.string().optional(), outcome: z.string().optional(), triggerId: z.string().optional(), q: z.string().optional(), from: z.string().optional(), to: z.string().optional(), limit: z.number().int().min(1).max(100).default(50), cursor: z.string().optional() }), (input: any) => service.listWebhookDeliveries(queryOf(input)));
    tool("get_webhook_delivery", "Get a webhook delivery and its safe processing timeline. Secrets and payloads are never returned.", z.object({ deliveryId: z.string().min(1) }), ({ deliveryId }: any) => service.getWebhookDelivery(deliveryId));
    tool("test_trigger_webhook_conditions", "Evaluate conditions on supplied prepared webhook context. No authentication of the example, routing, live GitHub verification, or invocation.", triggerConditionsTestSchema, (input: any) => service.testTriggerConditions(input));
    tool("diagnose_exe_integration", "Probe a saved exe.dev connection's permissions and a disposable tagged VM's agent/model integration. The disposable VM is deleted before the tool returns.", z.object({ connectionId: z.string().min(1) }), ({ connectionId }: any) => service.diagnoseExeIntegration(connectionId));
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
      protocol.all("/mcp", c => listeners.get(c.req.raw)?.() ?? mcpHandler.fetch(c.req.raw, { parsedBody: (c as any).get("parsedBody") }));
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
      auth = {...auth, authMethod: "oauth", scopes: normalizeScopes(token.scope).filter(scope => normalizeScopes(auth.scopes).includes(scope)), oauthGrantId: token.grantId, oauthClientId: token.grant.clientId, oauthExpiresAt: token.expiresAt};
    }
    return protectedApiFetch(request, this.env, auth, this.ctx);
  }
}
