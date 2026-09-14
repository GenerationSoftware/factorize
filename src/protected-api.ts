import { WorkerEntrypoint } from "cloudflare:workers";
import { McpServer, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { createMcpHonoApp } from "@modelcontextprotocol/hono";
import { z } from "zod";
import { FlowService, ServiceError } from "./flow-service";
import { flowIdSchema, flowInputSchema, listEventsSchema, listRunsSchema, runIdSchema } from "./flow-schemas";
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

export class ProtectedApiHandler extends WorkerEntrypoint<Env, OAuthProps> {
  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url), path = url.pathname, service = new FlowService(this.env, this.ctx.props);
      if (path === "/mcp") return this.mcp(request, service);
      if (!path.startsWith("/api/v1")) return Response.json({ error: { code: "not_found", message: "Not found" } }, { status: 404 });
      if (request.method === "GET" && path === "/api/v1/flows") return Response.json(await service.listFlows());
      if (request.method === "POST" && path === "/api/v1/flows") return Response.json(await service.createFlow(flowInputSchema.parse(await request.json())), { status: 201 });
      const flowMatch = path.match(/^\/api\/v1\/flows\/([^/]+)$/);
      if (flowMatch && request.method === "GET") return Response.json(await service.getFlow(decodeURIComponent(flowMatch[1])));
      if (flowMatch && request.method === "PUT") return Response.json(await service.updateFlow(decodeURIComponent(flowMatch[1]), flowInputSchema.parse(await request.json())));
      if (flowMatch && request.method === "DELETE") return Response.json(await service.deleteFlow(decodeURIComponent(flowMatch[1])));
      if (request.method === "GET" && path === "/api/v1/projects") return Response.json(await service.listProjects());
      if (request.method === "GET" && path === "/api/v1/flow-options") return Response.json(await service.listFlowOptions());
      if (request.method === "GET" && path === "/api/v1/runs") { const q = listRunsSchema.parse(queryInput(url)); return Response.json(await service.listRuns(queryOf(q))); }
      const runMatch = path.match(/^\/api\/v1\/runs\/([^/]+)$/);
      if (runMatch && request.method === "GET") return Response.json(await service.getRun(decodeURIComponent(runMatch[1])));
      const stopMatch = path.match(/^\/api\/v1\/runs\/([^/]+)\/stop$/);
      if (stopMatch && request.method === "POST") return Response.json(await service.stopRun(decodeURIComponent(stopMatch[1])));
      if (request.method === "GET" && path === "/api/v1/flow-events") { const q = listEventsSchema.parse(queryInput(url)); return Response.json(await service.listFlowEvents(queryOf(q))); }
      return Response.json({ error: { code: "not_found", message: "Not found" } }, { status: 404 });
    } catch (error) { return errorResponse(error); }
  }

  private async mcp(request: Request, service: FlowService): Promise<Response> {
    const server = new McpServer({ name: "factorize", version: "1.0.0" });
    const tool = <T>(name: string, description: string, schema: any, action: (input: T) => Promise<unknown>) => server.registerTool(name, { description, inputSchema: schema }, async (input: T) => {
      try { return structured(await action(input)); }
      catch (error) { const response = errorResponse(error), detail = await response.json() as any; throw new Error(`${detail.error?.code ?? "operation_failed"}: ${detail.error?.message ?? "Operation failed"}`); }
    });
    tool("list_flows", "List Factorize flows", z.object({}), () => service.listFlows());
    tool("get_flow", "Get a flow", flowIdSchema, ({ flowId }: any) => service.getFlow(flowId));
    tool("create_flow", "Create a flow", flowInputSchema, (input: any) => service.createFlow(input));
    tool("update_flow", "Update a flow", flowInputSchema.extend({ flowId: z.string().min(1) }), ({ flowId, ...input }: any) => service.updateFlow(flowId, input));
    tool("delete_flow", "Delete a flow", flowIdSchema, ({ flowId }: any) => service.deleteFlow(flowId));
    tool("list_projects", "List Linear projects", z.object({}), () => service.listProjects());
    tool("list_flow_options", "List match-rule options", z.object({}), () => service.listFlowOptions());
    tool("list_runs", "List and filter flow runs", listRunsSchema, (input: any) => service.listRuns(queryOf(input)));
    tool("get_run", "Get a run and its current output", runIdSchema, ({ runId }: any) => service.getRun(runId));
    tool("list_flow_events", "List webhook activity for a flow", listEventsSchema, (input: any) => service.listFlowEvents(queryOf(input)));
    tool("stop_run", "Stop an active run", runIdSchema, ({ runId }: any) => service.stopRun(runId));
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    const appHostname = new URL(this.env.APP_ORIGIN).hostname;
    const mcpApp = createMcpHonoApp({ host: appHostname, allowedHosts: [appHostname], allowedOrigins: [appHostname] });
    mcpApp.all("/mcp", c => transport.handleRequest(c.req.raw, { parsedBody: (c as any).get("parsedBody") }));
    return mcpApp.fetch(request, this.env, this.ctx);
  }
}
