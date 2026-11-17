import { Hono } from "hono";
import { AgentApiError } from "./agent-api";
import { requestApiInput, readApiResponseInput } from "./agent-api-contracts";
import { ExeIntegrationError } from "./exe-vm-backend";
import { queryOf } from "./query-params";
import { jobUpdateInput } from "./job-contracts";
import { InvocationError } from "./job-domain";
import { WorkerEntrypoint } from "cloudflare:workers";
import { createMcpHandler, McpServer, type ServerContext } from "@modelcontextprotocol/server";
import { createMcpHonoApp } from "@modelcontextprotocol/hono";
import { z } from "zod";
import { ApiService, ServiceError } from "./flow-service";
import { jobConditionsTestSchema, jobIdSchema, jobInputSchema, listRunsSchema, manualInvocationSchema, renameRunSchema, reportRunErrorSchema, runIdSchema } from "./flow-schemas";
import type { Env, OAuthProps } from "./types";
import { executeAuth, validBrowserOrigin } from "./auth-api";
import { matchApiOperation } from "./api-contract";
import { normalizeScopes } from "./access-tokens";

function errorResponse(error: unknown, origin?: string): Response {
  if (error instanceof AgentApiError) return Response.json({error: {code: error.code, message: error.message}}, {status: error.status, headers: error.code === "insufficient_scope" ? {"WWW-Authenticate": `Bearer error="insufficient_scope", scope="${error.scope}", resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`} : undefined});
  if (error instanceof ExeIntegrationError) return Response.json({ error: { code: "invalid_request", message: error.message } }, { status: 400 });
  if (error instanceof URIError) return Response.json({ error: { code: "invalid_request", message: "Invalid path encoding" } }, { status: 400 });
  if (error instanceof InvocationError && error.code === "queue_full") return Response.json({ error: { code: error.code, message: error.message } }, { status: 409 });
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
  return { content: [{ type: "text" as const, text: JSON.stringify(output) }], structuredContent: output };
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
      if (path === "/mcp") {
        if (!auth) throw new ServiceError(401, "invalid_token", "Unauthorized");
        const mcpService = new ApiService(env, auth);
        // Authorization challenges must leave the HTTP boundary before the MCP
        // SDK translates tool exceptions to JSON-RPC tool errors.
        if (request.method === "POST") {
          let mcpBytes=0;
          const limited = request.body?.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({
            transform(chunk,controller) { mcpBytes+=chunk.byteLength; if(mcpBytes>45_000_000) throw new ServiceError(413,"request_too_large","MCP request exceeds the proxy limit."); controller.enqueue(chunk); }
          }));
          let body: any;
          try { body = await new Response(limited).json(); } catch(error) { if(error instanceof ServiceError) throw error; throw new ServiceError(400,"invalid_request","Request body must be valid JSON."); }
          mcpBodies.set(request,body);
          if (body?.method === "tools/call" && body.params?.name === "request_api") {
            const input = requestApiInput.parse(body.params.arguments);
            await mcpService.agentApi().authorize(input.integration);
          }
          if (body?.method === "tools/call" && body.params?.name === "read_api_response") await mcpService.agentApi().authorizeRead(readApiResponseInput.parse(body.params.arguments));
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
      const result = await route.execute(service, { params: route.parameters.parse(params) as Record<string, string>, body, query, url, signal: request.signal });
      return timed(result instanceof Response ? result : Response.json(result, { status: route.status }));
    } catch (error) { return timed(errorResponse(error, env.APP_ORIGIN)); }
}

const mcpServices = new WeakMap<Request, ApiService>();
const mcpBodies = new WeakMap<Request, unknown>();

function createMcpServer(service: ApiService): McpServer {
    const server = new McpServer({ name: "factorize", version: "1.0.0" });
    const tool = <T>(name: string, description: string, schema: any, action: (input: T, context: ServerContext) => Promise<unknown>) => server.registerTool(name, { description, inputSchema: schema }, async (input: T, context: ServerContext) => {
      try {
        const progressToken = context.mcpReq._meta?.progressToken;
        const notify = async (progress: number) => {
          if ((typeof progressToken === "string" || typeof progressToken === "number") && name === "request_api") await context.mcpReq.notify({method:"notifications/progress",params:{progressToken,progress,total:1}});
        };
        await notify(0);
        const result = await action(input, context);
        await notify(1);
        return structured(result);
      }
      catch (error) { const response = errorResponse(error), detail = await response.json() as any; throw new Error(`${detail.error?.code ?? "operation_failed"}: ${detail.error?.message ?? "Operation failed"}`); }
    });
    tool("get_api_reflection", "Discover this agent identity, effective Factorize scopes, and granted/requestable integration APIs. Availability describes connection state, not verified credential health.", z.object({}), () => service.getApiReflection());
    tool("request_api", "Make an HTTP request to a selected integration. Supply a relative path/query, never an origin or upstream credential. Small bodies return inline; larger bodies return a handle retained for 24 hours. Upstream non-2xx status is preserved.", requestApiInput, (input: any, context) => service.requestApi(input, context.mcpReq.signal));
    tool("read_api_response", "Read up to 64 KiB of a retained API response, base64 encoded. Reads recheck identity and integration authorization.", readApiResponseInput, (input: any) => service.readApiResponse(input));
    tool("list_exe_connections", "List safe metadata for saved exe.dev connections. API tokens are never returned.", z.object({}), () => service.listExeConnections());
    tool("get_runtime_context", "Inspect the verified invocation identity without exposing credentials.", z.object({}), () => service.getRuntimeContext());
    tool("list_github_installations", "List connected GitHub App installations, including the installation IDs needed by GitHub Job triggers. Credentials are never returned.", z.object({}), () => service.listGitHubInstallations());
    tool("list_runs", "List authoritative job runs by job ID, state, an optional case-insensitive literal substring of triggered context, and validated sort field/direction. Sorting is applied before cursor pagination with deterministic ID tie-breaking. Automatic webhook, schedule, and lifecycle signals coalesce, so query runs and the provider API for authoritative work. Context matches include only a bounded excerpt.", listRunsSchema, (input: any) => service.listRuns(queryOf(input)));
    tool("get_run", "Get a run with its rendered prompt, full triggered context, invocation metadata, execution metadata, output, and activity. For manual invocations, invocation.idempotency_key is the client-reusable value; invocation.claim_key is internal.", runIdSchema, ({ runId }: any) => service.getRun(runId));
    tool("rename_run", "Rename a run without changing its execution. Supply expectedName to reject stale edits; names are trimmed and must contain 1 to 120 characters.", runIdSchema.extend(renameRunSchema.shape), ({ runId, ...input }: any) => service.renameRun(runId, input));
    tool("get_run_diagnostics", "Get credential-safe launch, prompt delivery, output capture, claim release, cleanup, and activity diagnostics for a run.", runIdSchema, ({ runId }: any) => service.getRunDiagnostics(runId));
    tool("report_run_error", "Record an error reason for an active run and continue execution. Identical retries are idempotent; a different reason conflicts. Finish remaining work, then exit normally. Terminal runs reject reports.", runIdSchema.extend(reportRunErrorSchema.shape).strict(), ({ runId, reason }: any) => service.reportRunError(runId, { reason }));
    tool("stop_run", "Stop an active run", runIdSchema, ({ runId }: any) => service.stopRun(runId));
    tool("kill_run", "Force a run in any non-terminal state to stop immediately, release its concurrency slot, and clean up its backend asynchronously.", runIdSchema, ({ runId }: any) => service.killRun(runId));
    tool("list_jobs", "List jobs with their current run count and maximum concurrency", z.object({}), () => service.listJobs());
    tool("list_skills", "List searchable global skill metadata. Shared edits affect every job using the skill; bodies are omitted.", z.object({ q: z.string().optional(), limit: z.number().int().min(1).max(100).default(30), cursor: z.string().optional() }), (input: any) => service.listSkills({ q: input.q ?? "", limit: input.limit, cursor: input.cursor }));
    tool("get_skill", "Read a global skill by stable ID or key. Shared edits affect every job using it.", z.object({ skillId: z.string().min(1) }), ({ skillId }: any) => service.getSkill(skillId));
    tool("create_skill", "Create a reusable literal global skill body.", z.object({ key: z.string().min(1), body: z.string() }), (input: any) => service.createSkill(input));
    tool("update_skill", "Update a shared global skill with optimistic concurrency; the change affects all referencing jobs.", z.object({ skillId: z.string().min(1), key: z.string().optional(), body: z.string().optional(), expectedRevision: z.number().int().positive() }), ({ skillId, ...input }: any) => service.updateSkill(skillId, input));
    tool("delete_skill", "Delete an unused global skill; referenced jobs block deletion.", z.object({ skillId: z.string().min(1), expectedRevision: z.number().int().positive() }), ({ skillId, expectedRevision }: any) => service.deleteSkill(skillId, expectedRevision));
    tool("list_skill_jobs", "List enabled and disabled jobs affected by a shared skill.", z.object({ skillId: z.string().min(1) }), ({ skillId }: any) => service.listSkillJobs(skillId));
    tool("preview_job_prompt", "Preview exact ordered literal skill composition plus rendered job context; does not save or execute.", z.object({ skillIds: z.array(z.string()).max(50), jobContext: z.string(), sampleTriggerData: z.record(z.string(), z.unknown()).optional() }), (input: any) => service.previewJobPrompt(input));
    tool("list_projects", "List tenant projects with job counts", z.object({}), () => service.listProjects());
    tool("get_project", "Get a tenant project", z.object({ projectId: z.string().min(1) }), ({ projectId }: any) => service.getProject(projectId));
    tool("create_project", "Create a tenant project", z.object({ name: z.string().trim().min(1).max(120), description: z.string().max(2000).optional() }), (input: any) => service.createProject(input));
    tool("update_project", "Rename or describe a tenant project", z.object({ projectId: z.string().min(1), name: z.string().trim().min(1).max(120), description: z.string().max(2000).optional() }), ({ projectId, ...input }: any) => service.updateProject(projectId, input));
    tool("delete_project", "Delete an empty tenant project", z.object({ projectId: z.string().min(1) }), ({ projectId }: any) => service.deleteProject(projectId));
    tool("get_job", "Get a job with its current run count and maximum concurrency", jobIdSchema, ({ jobId }: any) => service.getJob(jobId));
    tool("create_job", "Create a job using a saved execution integration ID. Credentials are never accepted or returned.", jobInputSchema, (input: any) => service.createJob(input));
    tool("update_job", "Replace a job configuration. Credentials are never accepted or returned.", jobUpdateInput.extend({ jobId: z.string().min(1) }), ({ jobId, ...input }: any) => service.updateJob(jobId, input));
    tool("move_job", "Move a job between tenant projects without changing its execution configuration", z.object({ jobId: z.string().min(1), projectId: z.string().min(1), expectedUpdatedAt: z.string().optional() }), ({ jobId, projectId, expectedUpdatedAt }: any) => service.moveJob(jobId, projectId, expectedUpdatedAt));
    tool("delete_job", "Delete a job and its queued invocation history", jobIdSchema, ({ jobId }: any) => service.deleteJob(jobId));
    tool("enable_job", "Enable a job", jobIdSchema, ({ jobId }: any) => service.setJobEnabled(jobId, true));
    tool("disable_job", "Disable a job", jobIdSchema, ({ jobId }: any) => service.setJobEnabled(jobId, false));
    tool("invoke_job", "Invoke a job's manual trigger with an optional display name, prompt, and JSON data exposed beneath that trigger's stable slug. Manual invocations are never coalesced; a full job queue returns queue_full. idempotencyKey is a client value and must not include the internal manual: claim-key prefix; reuse invocation.idempotency_key from get_run.", manualInvocationSchema.extend({ jobId: z.string().min(1) }), ({ jobId, ...input }: any) => service.invokeJob(jobId, input));
    tool("get_job_invocation_permissions", "List the destinations a source job may manually invoke.", jobIdSchema, ({ jobId }: any) => service.getInvocationPermissions(jobId));
    tool("set_job_invocation_permissions", "Replace manual invocation destinations for a source job. Requires an owner session, scoped API key, or authorized OAuth client with jobs:write; destination IDs must belong to the same tenant.", z.object({ jobId: z.string().min(1), destinationJobIds: z.array(z.string().uuid()).max(1000) }).strict(), ({ jobId, destinationJobIds }: any) => service.setInvocationPermissions(jobId, destinationJobIds));
    tool("list_job_webhook_activity", "List matching, rejected, duplicate, and accepted webhook activity for a job", z.object({ jobId: z.string().min(1), limit: z.number().int().min(1).max(100).default(50) }), ({ jobId, limit }: any) => service.listJobEvents(jobId, limit));
    tool("list_webhook_deliveries", "Search tenant-scoped webhook deliveries by provider, delivery ID, event, outcome, job, time range, or safe diagnostic text. Results are newest first and cursor paginated.", z.object({ provider: z.string().optional(), deliveryId: z.string().optional(), event: z.string().optional(), action: z.string().optional(), outcome: z.string().optional(), jobId: z.string().optional(), q: z.string().optional(), from: z.string().optional(), to: z.string().optional(), limit: z.number().int().min(1).max(100).default(50), cursor: z.string().optional() }), (input: any) => service.listWebhookDeliveries(queryOf(input)));
    tool("get_webhook_delivery", "Get a webhook delivery and its safe processing timeline. Secrets and payloads are never returned.", z.object({ deliveryId: z.string().min(1) }), ({ deliveryId }: any) => service.getWebhookDelivery(deliveryId));
    tool("test_job_webhook_conditions", "Evaluate conditions on supplied prepared webhook context. No authentication of the example, routing, live GitHub verification, or invocation.", jobConditionsTestSchema, (input: any) => service.testJobConditions(input));
    tool("diagnose_exe_integration", "Probe a saved exe.dev connection's permissions and a disposable tagged VM's agent/model integration. The disposable VM is deleted before the tool returns.", z.object({ connectionId: z.string().min(1) }), ({ connectionId }: any) => service.diagnoseExeIntegration(connectionId));
    tool("list_cloudflare_tail_integrations", "List installed Cloudflare Tail integrations and reference counts. Signing secrets are never returned.", z.object({}), () => service.listTailIntegrations());
    return server;
}

// The SDK owns the request-scoped transport/server lifecycle. The factory only
// resolves the service for the request being served, so tenant context cannot
// leak between concurrent MCP calls.
const mcpHandler = createMcpHandler(({ requestInfo }) => {
    const service = requestInfo && mcpServices.get(requestInfo);
    if (!service) throw new Error("MCP request context is unavailable");
    return createMcpServer(service);
});

const mcpApps = new Map<string, Hono>();
function mcpAppFor(hostname: string) {
    let app = mcpApps.get(hostname);
    if (!app) {
      const protocol = createMcpHonoApp({ host: hostname, allowedHosts: [hostname], allowedOrigins: [hostname] });
      protocol.all("/mcp", c => mcpHandler.fetch(c.req.raw, { parsedBody: (c as any).get("parsedBody") }));
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
