import { z } from "zod";
import type { ApiService } from "./flow-service";
import {
  jobInputSchema,
  manualInvocationSchema,
  jobHandlerTestSchema,
  listRunsSchema,
  scopeSchema,
} from "./flow-schemas";
import { traceReplaySchema } from "./trace-replay-schemas";
import document from "./api-document.json";

type JsonSchema = Record<string, any>;
export interface RouteContract {
  method: string;
  path: string;
  scope: z.infer<typeof scopeSchema>;
  ownerSession: boolean;
  body?: z.ZodType;
  query?: z.ZodObject;
  parameters: z.ZodObject;
  status: number;
  documentation: Record<string, any>;
  execute: (
    service: ApiService,
    input: { params: Record<string, string>; body: any; query: any; url: URL },
  ) => Promise<unknown>;
}

function queryOf(value: Record<string, unknown>): URLSearchParams {
  const query = new URLSearchParams();
  for (const [key, item] of Object.entries(value))
    if (item !== undefined) query.set(key, String(item));
  return query;
}

const exeBody = z.object({
  connectionId: z.string().min(1).optional(),
  apiToken: z.string().min(1).meta({ writeOnly: true }),
  agentKind: z.enum(["codex", "claude", "pi"]),
  tags: z
    .array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/))
    .max(20)
    .optional(),
});
const exeTestBody = exeBody
  .partial()
  .refine((value) => Boolean(value.connectionId || value.apiToken), {
    message: "Supply a saved connectionId or apiToken",
  });
const ampBody = z.object({
  connectionId: z.string().min(1).optional(),
  accessToken: z.string().min(1).meta({ writeOnly: true }),
  project: z.string().min(1),
  apiBaseUrl: z.url().optional(),
});
const ampTestBody = ampBody
  .partial()
  .refine(
    (value) =>
      Boolean(value.connectionId || (value.accessToken && value.project)),
    { message: "Supply a saved connectionId or accessToken and project" },
  );
const tailBody = z.object({
  integrationId: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(120),
  signingSecret: z
    .union([z.literal(""), z.string().min(16)])
    .optional()
    .meta({ writeOnly: true }),
  generateSecret: z.boolean().optional(),
});
const deliveryQuery = z.object({
  provider: z.string().optional(),
  deliveryId: z.string().optional(),
  event: z.string().optional(),
  action: z.string().optional(),
  outcome: z.string().optional(),
  jobId: z.string().optional(),
  q: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const eventQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const traceQuery = z.object({
  after: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
const searchQuery = z.object({ q: z.string().default("") });
const clickUpQuery = z.object({ listId: z.string().default("") });
const scheduleBody = z
  .object({
    cron: z.string().trim().min(1),
    timezone: z.string().trim().min(1),
  })
  .strict();
const accessTokenBody = z.object({
  name: z.string().trim().min(1).max(100),
  scopes: z.array(scopeSchema).min(1),
  expiryDays: z.union([z.literal(7), z.literal(30), z.literal(90)]),
});

function route(
  method: string,
  path: string,
  scope: RouteContract["scope"],
  documentation: RouteContract["documentation"],
  execute: RouteContract["execute"],
  options: Partial<
    Pick<RouteContract, "body" | "query" | "ownerSession" | "parameters">
  > = {},
): RouteContract {
  const keys = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
  const parameters = z.object(
    Object.fromEntries(
      keys.map((key) => [
        key,
        key === "installationId" || key === "repositoryId"
          ? z.string().regex(/^[0-9]+$/)
          : z.string().min(1),
      ]),
    ),
  );
  const status = Number(
    Object.keys(documentation.responses).find((code) => code.startsWith("2")),
  );
  return {
    method,
    path,
    scope,
    parameters,
    status,
    ownerSession: false,
    documentation,
    execute,
    ...options,
  };
}

/** The executable API catalog: change an operation here, then run generate:openapi.
 * Service methods retain tenant/identity authorization for both REST and MCP.
 */
export const API_ROUTES: RouteContract[] = [
  route(
    "GET",
    "/api/v1/exe-connections",
    "flows:read",
    {
      summary: "List exe connections",
      responses: {
        "200": {
          description: "Safe metadata",
          content: {
            "application/json": {
              schema: { type: "array", items: { type: "object" } },
            },
          },
        },
      },
    },
    (service) => service.listExeConnections(),
  ),
  route(
    "GET",
    "/api/v1/github-installations",
    "flows:read",
    {
      summary: "List GitHub installations",
      responses: {
        "200": {
          description: "Installations",
          content: {
            "application/json": {
              schema: { type: "array", items: { type: "object" } },
            },
          },
        },
      },
    },
    (service) => service.listGitHubInstallations(),
  ),
  route(
    "GET",
    "/api/v1/execution-targets",
    "flows:read",
    {
      summary: "List execution targets",
      responses: {
        "200": {
          description: "Targets",
          content: {
            "application/json": {
              schema: { type: "array", items: { type: "object" } },
            },
          },
        },
      },
    },
    (service) => service.listExecutionTargets(),
  ),
  route(
    "GET",
    "/api/v1/job-trigger-availability",
    "flows:read",
    {
      summary: "List available trigger kinds",
      responses: { "200": { description: "Availability" } },
    },
    (service) => service.listJobTriggerAvailability(),
  ),
  route(
    "POST",
    "/api/v1/schedules/preview",
    "flows:read",
    {
      summary: "Preview schedule",
      responses: {
        "200": {
          description: "Next occurrence",
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["nextRunAt"],
                properties: {
                  nextRunAt: { type: "string", format: "date-time" },
                },
              },
            },
          },
        },
      },
    },
    (service, { body }) => service.previewSchedule(body),
    { body: scheduleBody },
  ),
  route(
    "GET",
    "/api/v1/integrations/cloudflare-tail",
    "flows:read",
    {
      summary: "List Tail integrations",
      responses: {
        "200": {
          description: "Integrations",
          content: {
            "application/json": {
              schema: { type: "array", items: { type: "object" } },
            },
          },
        },
      },
    },
    (service) => service.listTailIntegrations(),
  ),
  route(
    "GET",
    "/api/v1/integrations",
    "flows:read",
    {
      summary: "List installed integrations",
      responses: {
        "200": { description: "Credential-safe integration status" },
      },
    },
    (service) => service.integrationStatus(),
  ),
  route(
    "PUT",
    "/api/v1/integrations/exe",
    "flows:write",
    {
      summary: "Create an exe.dev integration",
      responses: { "200": { description: "Saved" } },
    },
    (service, { body }) => service.saveExeIntegration(body),
    { body: exeBody },
  ),
  route(
    "POST",
    "/api/v1/integrations/exe/test",
    "flows:write",
    {
      summary: "Test exe.dev credentials",
      responses: { "200": { description: "Test result" } },
    },
    (service, { body }) => service.testExeIntegration(body),
    { body: exeTestBody },
  ),
  route(
    "PUT",
    "/api/v1/integrations/amp",
    "flows:write",
    {
      summary: "Create an Amp integration",
      responses: { "200": { description: "Saved" } },
    },
    (service, { body }) => service.saveAmpIntegration(body),
    { body: ampBody },
  ),
  route(
    "POST",
    "/api/v1/integrations/amp/test",
    "flows:write",
    {
      summary: "Test Amp credentials",
      responses: { "200": { description: "Test result" } },
    },
    (service, { body }) => service.testAmpIntegration(body),
    { body: ampTestBody },
  ),
  route(
    "POST",
    "/api/v1/integrations/cloudflare-tail",
    "flows:write",
    {
      summary: "Create a Tail integration",
      responses: { "201": { description: "Created" } },
    },
    (service, { body }) => service.saveTailIntegration(body),
    { body: tailBody },
  ),
  route(
    "GET",
    "/api/v1/providers/linear/projects",
    "flows:read",
    {
      summary: "List Linear projects",
      responses: {
        "200": {
          description: "Projects",
          content: {
            "application/json": {
              schema: { type: "array", items: { type: "object" } },
            },
          },
        },
      },
    },
    (service) => service.linearProjects(),
  ),
  route(
    "GET",
    "/api/v1/providers/linear/options",
    "flows:read",
    {
      summary: "List Linear trigger options",
      responses: { "200": { description: "Options" } },
    },
    (service) => service.linearOptions(),
  ),
  route(
    "GET",
    "/api/v1/providers/clickup/lists",
    "flows:read",
    {
      summary: "List ClickUp lists",
      responses: {
        "200": {
          description: "Lists",
          content: {
            "application/json": {
              schema: { type: "array", items: { type: "object" } },
            },
          },
        },
      },
    },
    (service) => service.clickUpLists(),
  ),
  route(
    "GET",
    "/api/v1/providers/clickup/options",
    "flows:read",
    {
      summary: "List ClickUp trigger options",
      responses: { "200": { description: "Options" } },
    },
    (service, { query }) => service.clickUpOptions(query.listId),
    { query: clickUpQuery },
  ),
  route(
    "GET",
    "/api/v1/providers/github/installations",
    "flows:read",
    {
      summary: "List GitHub installations for provider setup",
      responses: {
        "200": {
          description: "Installations",
          content: {
            "application/json": {
              schema: { type: "array", items: { type: "object" } },
            },
          },
        },
      },
    },
    (service) => service.listGitHubInstallations(),
  ),
  route(
    "GET",
    "/api/v1/access/authorized-clients",
    "flows:read",
    {
      summary: "List authorized OAuth clients",
      responses: {
        "200": {
          description: "Clients",
          content: {
            "application/json": {
              schema: { type: "array", items: { type: "object" } },
            },
          },
        },
      },
    },
    (service) => service.listAuthorizedClients(),
    { ownerSession: true },
  ),
  route(
    "GET",
    "/api/v1/access-tokens",
    "flows:read",
    {
      summary: "List access tokens",
      responses: {
        "200": {
          description: "Token metadata",
          content: {
            "application/json": {
              schema: { type: "array", items: { type: "object" } },
            },
          },
        },
      },
    },
    (service) => service.listAccessTokens(),
    { ownerSession: true },
  ),
  route(
    "POST",
    "/api/v1/access-tokens",
    "flows:write",
    {
      summary: "Create an access token",
      responses: { "201": { description: "Created token" } },
    },
    (service, { body }) => service.createAccessToken(body),
    { body: accessTokenBody, ownerSession: true },
  ),
  route(
    "DELETE",
    "/api/v1/access-tokens/{tokenId}",
    "flows:write",
    {
      summary: "Revoke an access token",
      responses: { "200": { description: "Revoked" } },
    },
    (service, { params }) => service.revokeAccessToken(params.tokenId),
    { ownerSession: true },
  ),
  route(
    "DELETE",
    "/api/v1/access/authorized-clients/{clientId}",
    "flows:write",
    {
      summary: "Revoke an authorized OAuth client",
      responses: { "200": { description: "Revoked grants" } },
    },
    (service, { params }) => service.revokeAuthorizedClient(params.clientId),
    { ownerSession: true },
  ),
  route(
    "DELETE",
    "/api/v1/integrations/exe/{connectionId}",
    "flows:write",
    {
      summary: "Remove an exe.dev integration",
      responses: { "200": { description: "Removed" } },
    },
    (service, { params }) =>
      service.removeIntegration("exe", params.connectionId),
  ),
  route(
    "DELETE",
    "/api/v1/integrations/amp/{connectionId}",
    "flows:write",
    {
      summary: "Remove an Amp integration",
      responses: { "200": { description: "Removed" } },
    },
    (service, { params }) =>
      service.removeIntegration("amp", params.connectionId),
  ),
  route(
    "PUT",
    "/api/v1/integrations/cloudflare-tail/{integrationId}",
    "flows:write",
    {
      summary: "Update a Tail integration",
      responses: { "200": { description: "Updated" } },
    },
    (service, { params, body }) =>
      service.saveTailIntegration({
        ...body,
        integrationId: params.integrationId,
      }),
    { body: tailBody },
  ),
  route(
    "DELETE",
    "/api/v1/integrations/cloudflare-tail/{integrationId}",
    "flows:write",
    {
      summary: "Remove a Tail integration",
      responses: { "200": { description: "Removed" } },
    },
    (service, { params }) =>
      service.removeTailIntegration(params.integrationId),
  ),
  route(
    "POST",
    "/api/v1/integrations/cloudflare-tail/{integrationId}/test",
    "flows:write",
    {
      summary: "Test a Tail integration",
      responses: { "200": { description: "Test result" } },
    },
    (service, { params }) => service.testTailIntegration(params.integrationId),
  ),
  route(
    "GET",
    "/api/v1/providers/github/installations/{installationId}/repositories",
    "flows:read",
    {
      summary: "List installation repositories",
      responses: {
        "200": {
          description: "Repositories",
          content: {
            "application/json": {
              schema: { type: "array", items: { type: "object" } },
            },
          },
        },
      },
    },
    (service, { params }) =>
      service.githubRepositories(Number(params.installationId)),
  ),
  route(
    "GET",
    "/api/v1/providers/github/installations/{installationId}/repositories/{repositoryId}/issue-options",
    "flows:read",
    {
      summary: "List GitHub issue trigger options",
      responses: { "200": { description: "Options" } },
    },
    (service, { params }) =>
      service.githubIssueOptions(
        Number(params.installationId),
        Number(params.repositoryId),
      ),
  ),
  route(
    "DELETE",
    "/api/v1/providers/github/installations/{installationId}",
    "flows:write",
    {
      summary: "Disconnect a GitHub installation",
      responses: { "200": { description: "Disconnected" } },
    },
    (service, { params }) =>
      service.removeGitHubInstallation(Number(params.installationId)),
  ),
  route(
    "POST",
    "/api/v1/integrations/exe/{connectionId}/diagnostics",
    "flows:write",
    {
      summary:
        "Probe exe.dev permissions and a disposable VM's agent/model integration",
      responses: {
        "200": { description: "Credential-safe diagnostic result" },
      },
    },
    (service, { params }) =>
      service.diagnoseExeIntegration(params.connectionId),
  ),
  route(
    "GET",
    "/api/v1/jobs",
    "flows:read",
    {
      summary: "List jobs",
      responses: {
        "200": {
          description: "Jobs",
          content: {
            "application/json": {
              schema: { type: "array", items: { type: "object" } },
            },
          },
        },
      },
    },
    (service) => service.listJobs(),
  ),
  route(
    "POST",
    "/api/v1/jobs",
    "flows:write",
    { summary: "Create job", responses: { "201": { description: "Created" } } },
    (service, { body }) => service.createJob(body),
    { body: jobInputSchema },
  ),
  route(
    "POST",
    "/api/v1/job-handlers/test",
    "flows:write",
    {
      summary: "Test webhook handler",
      responses: { "200": { description: "Decision" } },
    },
    (service, { body }) => service.testJobHandler(body),
    { body: jobHandlerTestSchema },
  ),
  route(
    "POST",
    "/api/v1/jobs/{jobId}/invocations",
    "runs:write",
    {
      summary: "Invoke job",
      responses: {
        "202": {
          description: "Accepted",
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["invocationId", "runId", "state", "duplicate"],
                properties: {
                  invocationId: { type: "string" },
                  runId: { type: "string" },
                  state: { type: "string" },
                  duplicate: { type: "boolean" },
                },
              },
            },
          },
        },
        "409": {
          description:
            "queue_full \u2014 this job already has one queued run. Retry after it starts. Duplicate idempotency keys return the original run.",
        },
      },
    },
    (service, { params, body }) => service.invokeJob(params.jobId, body),
    { body: manualInvocationSchema },
  ),
  route(
    "GET",
    "/api/v1/jobs/{jobId}/events",
    "runs:read",
    {
      summary: "List webhook activity",
      responses: {
        "200": {
          description: "Activity",
          content: {
            "application/json": {
              schema: { type: "array", items: { type: "object" } },
            },
          },
        },
      },
    },
    (service, { params, query }) =>
      service.listJobEvents(params.jobId, query.limit),
    { query: eventQuery },
  ),
  route(
    "POST",
    "/api/v1/jobs/{jobId}/enable",
    "flows:write",
    { summary: "Enable job", responses: { "200": { description: "Enabled" } } },
    (service, { params }) => service.setJobEnabled(params.jobId, true),
  ),
  route(
    "POST",
    "/api/v1/jobs/{jobId}/disable",
    "flows:write",
    {
      summary: "Disable job",
      responses: { "200": { description: "Disabled" } },
    },
    (service, { params }) => service.setJobEnabled(params.jobId, false),
  ),
  route(
    "GET",
    "/api/v1/jobs/{jobId}",
    "flows:read",
    { summary: "Get job", responses: { "200": { description: "Job" } } },
    (service, { params }) => service.getJob(params.jobId),
  ),
  route(
    "PUT",
    "/api/v1/jobs/{jobId}",
    "flows:write",
    {
      summary: "Replace job",
      responses: { "200": { description: "Updated" } },
    },
    (service, { params, body }) => service.updateJob(params.jobId, body),
    { body: jobInputSchema },
  ),
  route(
    "DELETE",
    "/api/v1/jobs/{jobId}",
    "flows:write",
    { summary: "Delete job", responses: { "200": { description: "Deleted" } } },
    (service, { params }) => service.deleteJob(params.jobId),
  ),
  route(
    "GET",
    "/api/v1/runs",
    "runs:read",
    {
      summary: "List runs",
      responses: {
        "200": {
          description: "Paginated runs",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/RunPage" },
            },
          },
        },
      },
    },
    (service, { query }) => service.listRuns(queryOf(query)),
    { query: listRunsSchema },
  ),
  route(
    "GET",
    "/api/v1/search",
    "runs:read",
    {
      summary: "Search jobs and runs",
      responses: { "200": { description: "Search results" } },
    },
    (service, { query }) => service.search(query.q),
    { query: searchQuery },
  ),
  route(
    "GET",
    "/api/v1/webhooks/deliveries",
    "runs:read",
    {
      summary: "Search webhook deliveries",
      responses: {
        "200": { description: "Cursor-paginated safe delivery records" },
      },
    },
    (service, { query }) => service.listWebhookDeliveries(queryOf(query)),
    { query: deliveryQuery },
  ),
  route(
    "GET",
    "/api/v1/webhooks/deliveries/{deliveryId}",
    "runs:read",
    {
      summary: "Get webhook delivery detail and processing timeline",
      responses: { "200": { description: "Safe delivery detail" } },
    },
    (service, { params }) => service.getWebhookDelivery(params.deliveryId),
  ),
  route(
    "GET",
    "/api/v1/runs/{runId}",
    "runs:read",
    {
      summary: "Get run",
      responses: {
        "200": {
          description:
            "Run including durable execution diagnostics and harness artifact location",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/RunDetail" },
            },
          },
        },
      },
    },
    (service, { params }) => service.getRun(params.runId),
  ),
  route(
    "GET",
    "/api/v1/runs/{runId}/trace",
    "runs:read",
    {
      summary: "Get paginated run trace events",
      responses: {
        "200": {
          description: "Trace page",
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["items", "nextCursor"],
                properties: {
                  items: { type: "array", items: { type: "object" } },
                  nextCursor: { type: ["integer", "null"] },
                },
              },
            },
          },
        },
      },
    },
    (service, { params, query }) =>
      service.getRunTrace(params.runId, query.after, query.limit),
    { query: traceQuery },
  ),
  route(
    "POST",
    "/api/v1/runs/{runId}/trace/replay",
    "runs:write",
    {
      summary:
        "Replay a retained trace artifact or restore a native-session projection",
      description:
        "Requires runs:write and an interactive tenant owner session. One terminal run per request, limited to 10 attempts per tenant per minute including retries and failures. Projection and result commit atomically; no artifacts are deleted. Retry failed requests with the same requestId. Conflicting reuse is rejected. Missing bytes cannot be recovered. Does not change the source declaration of an active or future run.",
      responses: {
        "200": {
          description: "Durable replay result",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/TraceReplayResult" },
            },
          },
        },
        "400": { description: "Invalid request" },
        "401": { description: "Invalid owner session" },
        "403": {
          description: "Missing runs:write scope or interactive owner session",
        },
        "404": { description: "Run not found within the tenant" },
        "409": {
          description:
            "Request ID conflict or artifact ownership/checksum mismatch",
        },
        "429": {
          description:
            "Tenant rate limit reached; wait one minute before retrying",
        },
        "503": { description: "Artifact storage unavailable" },
      },
    },
    (service, { params, body }) => service.replayRunTrace(params.runId, body),
    {
      body: traceReplaySchema,
      ownerSession: true,
      parameters: z.object({ runId: z.uuid() }),
    },
  ),
  route(
    "GET",
    "/api/v1/runs/{runId}/diagnostics",
    "runs:read",
    {
      summary: "Get credential-safe run lifecycle diagnostics",
      responses: {
        "200": {
          description:
            "Credential-safe execution metadata and durable harness artifact location",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/RunDiagnostics" },
            },
          },
        },
      },
    },
    (service, { params }) => service.getRunDiagnostics(params.runId),
  ),
  route(
    "POST",
    "/api/v1/runs/{runId}/stop",
    "runs:write",
    { summary: "Stop run", responses: { "200": { description: "Stopped" } } },
    (service, { params }) => service.stopRun(params.runId),
  ),
  route(
    "POST",
    "/api/v1/runs/{runId}/kill",
    "runs:write",
    {
      summary: "Kill run and immediately release its concurrency slot",
      responses: { "200": { description: "Killed" } },
    },
    (service, { params }) => service.killRun(params.runId),
  ),
];

export const API_OPERATIONS = API_ROUTES.map(
  (route) => [route.method, route.path] as const,
);

const matchers = API_ROUTES.map((route) => ({
  route,
  keys: [...route.path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]),
  pattern: new RegExp(
    `^${route.path
      .split(/(\{[^}]+\})/)
      .map((part) =>
        part.startsWith("{")
          ? "([^/]+)"
          : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      )
      .join("")}$`,
  ),
}));

export function matchApiOperation(method: string, path: string) {
  for (const { route, keys, pattern } of matchers) {
    if (route.method !== method) continue;
    const match = pattern.exec(path);
    if (match)
      return {
        route,
        params: Object.fromEntries(
          keys.map((key, index) => [key, decodeURIComponent(match[index + 1])]),
        ),
      };
  }
  return undefined;
}
export function isDeclaredApiOperation(method: string, path: string): boolean {
  return matchApiOperation(method, path) !== undefined;
}

function jsonSchema(
  schema: z.ZodType,
  io: "input" | "output" = "input",
): JsonSchema {
  const { $schema, ...result } = z.toJSONSchema(schema, {
    io,
    unrepresentable: "any",
  });
  return result;
}
const errorContent = {
  "application/json": { schema: { $ref: "#/components/schemas/Error" } },
};

export function generateOpenApi() {
  const errors: Record<string, string> = {
    "400": "Invalid request",
    "401": "Invalid or revoked credentials",
    "403": "Missing scope or required owner session",
    "404": "Resource not found",
    "409": "Operation conflict",
    "415": "Unsupported media type; use application/json",
    "429": "Rate limit exceeded",
    "500": "Internal error",
    "503": "Service unavailable",
  };
  const errorResponses = Object.fromEntries(
    Object.entries(errors).map(([status, description]) => [
      `Error${status}`,
      { description, content: errorContent },
    ]),
  );
  const namedBodies: Record<string, z.ZodType> = {
    JobInput: jobInputSchema,
    ManualInvocation: manualInvocationSchema,
    JobHandlerTest: jobHandlerTestSchema,
    TraceReplayRequest: traceReplaySchema,
  };
  const schemas = {
    ...document.components.schemas,
    ...Object.fromEntries(
      Object.entries(namedBodies).map(([name, schema]) => [
        name,
        jsonSchema(schema),
      ]),
    ),
  };
  const bodySchema = (schema: z.ZodType) => {
    const name = Object.keys(namedBodies).find(
      (name) => namedBodies[name] === schema,
    );
    return name ? { $ref: `#/components/schemas/${name}` } : jsonSchema(schema);
  };
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of API_ROUTES) {
    const parameters = [
      ...Object.entries(route.parameters.shape).map(([name, schema]) => ({
        name,
        in: "path",
        required: true,
        schema: jsonSchema(schema),
      })),
      ...Object.entries(route.query?.shape ?? {}).map(([name, schema]) => ({
        name,
        in: "query",
        required: !schema.isOptional(),
        schema: jsonSchema(schema, "output"),
      })),
    ];
    const responses: Record<string, any> = {};
    for (const status of Object.keys(errors)) {
      if (status === "415" && !route.body) continue;
      responses[status] = { $ref: `#/components/responses/Error${status}` };
    }
    for (const [status, response] of Object.entries(
      route.documentation.responses,
    ) as [string, any][]) {
      responses[status] = status.startsWith("2")
        ? {
            ...response,
            content: response.content ?? {
              "application/json": { schema: { type: "object" } },
            },
          }
        : {
            $ref: `#/components/responses/Error${status}`,
            description: response.description,
          };
    }
    (paths[route.path] ??= {})[route.method.toLowerCase()] = {
      ...route.documentation,
      description: [
        route.documentation.description,
        `Requires the ${route.scope} scope.`,
        route.ownerSession
          ? "An interactive owner session is required; bearer tokens cannot call this operation."
          : "Accepts a scoped bearer token or interactive owner session.",
      ]
        .filter(Boolean)
        .join("\n\n"),
      operationId: `${route.method.toLowerCase()}_${route.path.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "")}`,
      tags: [route.path.split("/")[3]],
      security: [{ bearerAuth: [] }],
      "x-required-scope": route.scope,
      "x-owner-session-required": route.ownerSession,
      ...(parameters.length ? { parameters } : {}),
      ...(route.body
        ? {
            requestBody: {
              required: true,
              content: {
                "application/json": { schema: bodySchema(route.body) },
              },
            },
          }
        : {}),
      responses,
    };
  }
  return {
    ...document,
    components: { ...document.components, schemas, responses: errorResponses },
    paths,
  };
}
