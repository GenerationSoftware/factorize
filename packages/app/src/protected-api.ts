import { WorkerEntrypoint } from "cloudflare:workers";
import { McpServer, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { createMcpHonoApp } from "@modelcontextprotocol/hono";
import { z } from "zod";
import { ApiService, ServiceError } from "./flow-service";
import { jobHandlerTestSchema, jobIdSchema, jobInputSchema, listRunsSchema, manualInvocationSchema, runIdSchema } from "./flow-schemas";
import type { Env, OAuthProps } from "./types";

function errorResponse(error: unknown): Response {
  if (error instanceof z.ZodError) return Response.json({ error: { code: "invalid_request", message: "Request validation failed", details: error.issues } }, { status: 400 });
  if (error instanceof ServiceError) {
    const headers = error.code === "insufficient_scope" ? { "WWW-Authenticate": `Bearer error="insufficient_scope"` } : undefined;
    return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status, headers });
  }
  console.error("Protected API request failed", error);
  return Response.json({ error: { code: "internal_error", message: "Factorize could not complete this request." } }, { status: 500 });
}

function queryOf(value: Record<string, unknown>): URLSearchParams {
  const query = new URLSearchParams();
  for (const [key, item] of Object.entries(value)) if (item !== undefined) query.set(key, String(item));
  return query;
}

function queryInput(url: URL): Record<string, string> {
  const value: Record<string, string> = {};
  url.searchParams.forEach((item, key) => { value[key] = item; });
  return value;
}

function structured(value: unknown) {
  const output = Array.isArray(value) ? { items: value } : value && typeof value === "object" ? value as Record<string, unknown> : { value };
  return { content: [{ type: "text" as const, text: JSON.stringify(output) }], structuredContent: output };
}

export async function protectedApiFetch(request: Request, env: Env, auth: OAuthProps, ctx: ExecutionContext): Promise<Response> {
    try {
      const url = new URL(request.url), path = url.pathname, service = new ApiService(env, auth);
      if (path === "/mcp") return mcp(request, service, env, ctx);
      if (!path.startsWith("/api/v1")) return Response.json({ error: { code: "not_found", message: "Not found" } }, { status: 404 });
      if (request.method === "GET" && path === "/api/v1/exe-connections") return Response.json(await service.listExeConnections());
      if (request.method === "GET" && path === "/api/v1/execution-targets") return Response.json(await service.listExecutionTargets());
      if (request.method === "GET" && path === "/api/v1/jobs") return Response.json(await service.listJobs());
      if (request.method === "POST" && path === "/api/v1/jobs") return Response.json(await service.createJob(jobInputSchema.parse(await request.json())), { status: 201 });
      if (request.method === "POST" && path === "/api/v1/job-handlers/test") return Response.json(await service.testJobHandler(jobHandlerTestSchema.parse(await request.json())));
      const invocationMatch = path.match(/^\/api\/v1\/jobs\/([^/]+)\/invocations$/);
      if (invocationMatch && request.method === "POST") return Response.json(await service.invokeJob(decodeURIComponent(invocationMatch[1]), manualInvocationSchema.parse(await request.json())), { status: 202 });
      const jobEventsMatch = path.match(/^\/api\/v1\/jobs\/([^/]+)\/events$/);
      if (jobEventsMatch && request.method === "GET") return Response.json(await service.listJobEvents(decodeURIComponent(jobEventsMatch[1]), z.coerce.number().int().min(1).max(100).default(50).parse(url.searchParams.get("limit") ?? 50)));
      const enabledMatch = path.match(/^\/api\/v1\/jobs\/([^/]+)\/(enable|disable)$/);
      if (enabledMatch && request.method === "POST") return Response.json(await service.setJobEnabled(decodeURIComponent(enabledMatch[1]), enabledMatch[2] === "enable"));
      const jobMatch = path.match(/^\/api\/v1\/jobs\/([^/]+)$/);
      if (jobMatch && request.method === "GET") return Response.json(await service.getJob(decodeURIComponent(jobMatch[1])));
      if (jobMatch && request.method === "PUT") return Response.json(await service.updateJob(decodeURIComponent(jobMatch[1]), jobInputSchema.parse(await request.json())));
      if (jobMatch && request.method === "DELETE") return Response.json(await service.deleteJob(decodeURIComponent(jobMatch[1])));
      if (request.method === "GET" && path === "/api/v1/runs") { const q = listRunsSchema.parse(queryInput(url)); return Response.json(await service.listRuns(queryOf(q))); }
      const runMatch = path.match(/^\/api\/v1\/runs\/([^/]+)$/);
      if (runMatch && request.method === "GET") return Response.json(await service.getRun(decodeURIComponent(runMatch[1])));
      const stopMatch = path.match(/^\/api\/v1\/runs\/([^/]+)\/stop$/);
      if (stopMatch && request.method === "POST") return Response.json(await service.stopRun(decodeURIComponent(stopMatch[1])));
      return Response.json({ error: { code: "not_found", message: "Not found" } }, { status: 404 });
    } catch (error) { return errorResponse(error); }
}

async function mcp(request: Request, service: ApiService, env: Env, ctx: ExecutionContext): Promise<Response> {
    const server = new McpServer({ name: "factorize", version: "1.0.0" });
    const tool = <T>(name: string, description: string, schema: any, action: (input: T) => Promise<unknown>) => server.registerTool(name, { description, inputSchema: schema }, async (input: T) => {
      try { return structured(await action(input)); }
      catch (error) { const response = errorResponse(error), detail = await response.json() as any; throw new Error(`${detail.error?.code ?? "operation_failed"}: ${detail.error?.message ?? "Operation failed"}`); }
    });
    tool("list_exe_connections", "List safe metadata for saved exe.dev connections. API tokens are never returned.", z.object({}), () => service.listExeConnections());
    tool("list_runs", "List authoritative job runs by job ID, state, and an optional case-insensitive literal substring of triggered context. Automatic webhook, schedule, and lifecycle signals coalesce, so query runs and the provider API for authoritative work. Context matches include only a bounded excerpt.", listRunsSchema, (input: any) => service.listRuns(queryOf(input)));
    tool("get_run", "Get a run with its full triggered context, invocation metadata, execution metadata, output, and activity", runIdSchema, ({ runId }: any) => service.getRun(runId));
    tool("stop_run", "Stop an active run", runIdSchema, ({ runId }: any) => service.stopRun(runId));
    tool("list_jobs", "List jobs", z.object({}), () => service.listJobs());
    tool("get_job", "Get a job", jobIdSchema, ({ jobId }: any) => service.getJob(jobId));
    tool("create_job", "Create a job using an executionTargetId returned by list_execution_targets. Credentials are never accepted or returned.", jobInputSchema, (input: any) => service.createJob(input));
    tool("update_job", "Replace a job configuration. Credentials are never accepted or returned.", jobInputSchema.extend({ jobId: z.string().min(1) }), ({ jobId, ...input }: any) => service.updateJob(jobId, input));
    tool("delete_job", "Delete a job and its queued invocation history", jobIdSchema, ({ jobId }: any) => service.deleteJob(jobId));
    tool("enable_job", "Enable a job", jobIdSchema, ({ jobId }: any) => service.setJobEnabled(jobId, true));
    tool("disable_job", "Disable a job", jobIdSchema, ({ jobId }: any) => service.setJobEnabled(jobId, false));
    tool("invoke_job", "Invoke a job's manual trigger with a prompt exposed beneath that trigger's stable slug. Manual invocations are never coalesced.", manualInvocationSchema.extend({ jobId: z.string().min(1) }), ({ jobId, ...input }: any) => service.invokeJob(jobId, input));
    tool("list_job_webhook_activity", "List matching, rejected, duplicate, and accepted webhook activity for a job", z.object({ jobId: z.string().min(1), limit: z.number().int().min(1).max(100).default(50) }), ({ jobId, limit }: any) => service.listJobEvents(jobId, limit));
    tool("test_job_webhook_handler", "Test an isolated synchronous Job webhook handler without creating a run. Returns the decision and never accepts credentials.", jobHandlerTestSchema, (input: any) => service.testJobHandler(input));
    tool("list_execution_targets", "List non-secret execution target metadata and capabilities", z.object({}), () => service.listExecutionTargets());
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    const appHostname = new URL(env.APP_ORIGIN).hostname;
    const mcpApp = createMcpHonoApp({ host: appHostname, allowedHosts: [appHostname], allowedOrigins: [appHostname] });
    mcpApp.all("/mcp", c => transport.handleRequest(c.req.raw, { parsedBody: (c as any).get("parsedBody") }));
    return mcpApp.fetch(request, env, ctx);
  }

export class ProtectedApiHandler extends WorkerEntrypoint<Env, OAuthProps> {
  fetch(request: Request): Promise<Response> { return protectedApiFetch(request, this.env, this.ctx.props, this.ctx); }
}
