import { searchResponse } from "./search-contracts";
import { consentPreviewInput, consentPreviewResponse, consentDecisionInput, consentDecisionResponse } from "./consent-api";
import { exeConnection, integrationStatus, authorizedClient, accessToken, createdAccessToken, savedExe, testedExe, savedAmp, savedTail, okResult } from "./settings-contracts";
import { executionTargetResponse, triggerAvailabilityResponse, namedOption, providerOptions, githubInstallation, githubRepository, tailIntegration } from "./editor-contracts";
import { runSummaryResponse, runPageResponse, runStatusResponse, revisionTracePage, revisionTraceQuery } from "./run-read-contracts";
import { jobPageQuery, jobSummaryPage, jobSelectorPage, jobResponse, jobUpdateInput } from "./job-contracts";
import { z } from "zod";
import type { ApiService } from "./flow-service";
import {
  jobInputSchema,
  manualInvocationSchema,
  jobConditionsTestSchema,
  listRunsSchema,
  scopeSchema,
} from "./flow-schemas";
import { traceReplaySchema } from "./trace-replay-schemas";
import document from "./api-document.json";
import { authInputs, authSuccess, continuationSuccess, connectionStartInput, connectionStartSuccess, connectionResumeInput, loginSuccess, sessionResponse, type AuthAction } from "./auth-api";

type JsonSchema = Record<string, any>;
export interface RouteContract {
  method: string;
  path: string;
  scope: z.infer<typeof scopeSchema>;
  ownerSession: boolean;
  authOperation?: AuthAction;
  body?: z.ZodType;
  maxBodyBytes?: number;
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
    Pick<RouteContract, "body" | "maxBodyBytes" | "query" | "ownerSession" | "parameters" | "authOperation">
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
function authRoute(method: string, path: string, action: AuthAction, summary: string, response: z.ZodType, body?: z.ZodType, status = 200): RouteContract {
  return {
    method, path, authOperation: action, scope: "flows:read", ownerSession: action === "password",
    parameters: z.object({}), body, status,
    documentation: {
      summary,
      description: "Cookie-only browser operation. Mutations require an exact app Origin and reject cross-site requests. Authorization headers are rejected. Responses are never cached.",
      responses: { [status]: { description: "session" === action ? "Unauthenticated sessions return authenticated:false; expired, unverified, removed or revoked owners are unauthenticated." : "Success", headers: { "X-Factorize-Webhook-Conditions": { description: "Conditions-only webhook runtime deployment marker.", schema: { type: "string", const: "v1" } }, "X-Factorize-Contract": { description: "Deployment compatibility marker for the complete GEN-2157 static-client API contract. Deploy this API stage before static frontend cutover.", schema: { type: "string", const: "gen-2157-static-v1" } } }, content: { "application/json": { schema: jsonSchema(response, "output") } } } },
    },
    execute: async () => { throw new Error("Auth operations must use the protected API dispatcher"); },
  };
}

export const API_ROUTES: RouteContract[] = [
  authRoute("POST", "/api/v1/auth/connections", "connection-start", "Persist an individual validated MCP connection; sets a per-attempt browser cookie", connectionStartSuccess, connectionStartInput),
  authRoute("POST", "/api/v1/auth/connections/resume", "connection-resume", "Resume verified onboarding in the initiating browser; never grants OAuth access", continuationSuccess, connectionResumeInput),
  authRoute("GET", "/api/v1/session", "session", "Get current browser session", sessionResponse),
  authRoute("POST", "/api/v1/auth/login", "login", "Sign in", loginSuccess, authInputs.login),
  authRoute("POST", "/api/v1/auth/signup", "signup", "Request signup; existing accounts return the same accepted response", authSuccess, authInputs.signup, 202),
  authRoute("POST", "/api/v1/auth/email-verification/request", "verification-request", "Request email verification", authSuccess, authInputs.request),
  authRoute("POST", "/api/v1/auth/email-verification/complete", "verification", "Verify email, establish an owner session, and resume explicit consent; callbacks stay in the initiating browser", continuationSuccess, authInputs.verify),
  authRoute("POST", "/api/v1/auth/password-reset/request", "reset-request", "Request password reset", authSuccess, authInputs.request),
  authRoute("POST", "/api/v1/auth/password-reset/complete", "reset", "Complete password reset and resume onboarding", continuationSuccess, authInputs.reset),
  authRoute("POST", "/api/v1/auth/password", "password", "Change password and invalidate sessions", authSuccess, authInputs.change),
  authRoute("POST", "/api/v1/auth/logout", "logout", "Revoke current session and clear browser cookie", authSuccess),

  route("POST", "/api/v1/oauth/device/preview", "flows:read", { summary: "Inspect a device authorization code", responses: { "200": { description: "Pending device request", content: { "application/json": { schema: jsonSchema(z.object({ userCode: z.string(), clientName: z.string(), scopes: z.array(z.string()), expiresAt: z.string(), signature: z.string() }), "output") } } } } }, async () => undefined, { body: z.object({ userCode: z.string().min(1).max(32) }).strict(), authOperation: "device-preview", ownerSession: true }),
  route("POST", "/api/v1/oauth/device/decision", "flows:write", { summary: "Approve or deny a device authorization code", responses: { "200": { description: "Device decision", content: { "application/json": { schema: jsonSchema(z.object({ status: z.enum(["approved", "denied"]) }), "output") } } } } }, async () => undefined, { body: z.object({ userCode: z.string().min(1).max(32), signature: z.string().min(1).max(256), decision: z.enum(["allow", "deny"]) }).strict(), authOperation: "device-decision", ownerSession: true }),
  route("POST", "/api/v1/oauth/consent/preview", "flows:read", { summary: "Inspect an OAuth consent request", responses: { "200": { description: "Owner-bound expiring consent", content: { "application/json": { schema: jsonSchema(consentPreviewResponse, "output") } } } } }, async () => undefined, { body: consentPreviewInput, authOperation: "consent-preview", ownerSession: true }),
  route("POST", "/api/v1/oauth/consent/decision", "flows:write", { summary: "Decide an OAuth consent request", responses: { "200": { description: "Validated protocol destination", content: { "application/json": { schema: jsonSchema(consentDecisionResponse, "output") } } } } }, async () => undefined, { body: consentDecisionInput, authOperation: "consent-decision", ownerSession: true }),
  route("GET", "/api/v1/trigger-contexts", "flows:read", {
    summary: "Get template autocomplete metadata",
    responses: { "200": { description: "Paths by trigger kind/provider", content: { "application/json": { schema: jsonSchema(z.record(z.string(), z.array(z.object({ path: z.string(), type: z.enum(["string", "number", "boolean", "object", "array", "unknown"]), description: z.string(), example: z.unknown().optional() }))), "output") } } } },
  }, service => service.triggerContextMetadata()),
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
              schema: jsonSchema(z.array(exeConnection), "output"),
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
              schema: jsonSchema(z.array(githubInstallation), "output"),
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
              schema: jsonSchema(z.array(executionTargetResponse), "output"),
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
      responses: { "200": { description: "Availability", content: { "application/json": { schema: jsonSchema(triggerAvailabilityResponse, "output") } } } },
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
              schema: jsonSchema(z.array(tailIntegration), "output"),
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
        "200": { description: "Credential-safe integration status", content: { "application/json": { schema: jsonSchema(integrationStatus, "output") } } },
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
      responses: { "200": { description: "Saved", content: { "application/json": { schema: jsonSchema(savedExe, "output") } } } },
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
      responses: { "200": { description: "Test result", content: { "application/json": { schema: jsonSchema(testedExe, "output") } } } },
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
      responses: { "200": { description: "Saved", content: { "application/json": { schema: jsonSchema(savedAmp, "output") } } } },
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
      responses: { "200": { description: "Test result", content: { "application/json": { schema: jsonSchema(okResult, "output") } } } },
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
      responses: { "201": { description: "Created", content: { "application/json": { schema: jsonSchema(savedTail, "output") } } } },
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
              schema: jsonSchema(z.array(namedOption), "output"),
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
      responses: { "200": { description: "Options", content: { "application/json": { schema: jsonSchema(providerOptions, "output") } } } },
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
              schema: jsonSchema(z.array(namedOption), "output"),
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
      responses: { "200": { description: "Options", content: { "application/json": { schema: jsonSchema(providerOptions, "output") } } } },
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
              schema: jsonSchema(z.array(githubInstallation), "output"),
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
              schema: jsonSchema(z.array(authorizedClient), "output"),
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
              schema: jsonSchema(z.array(accessToken), "output"),
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
      responses: { "201": { description: "Created token", content: { "application/json": { schema: jsonSchema(createdAccessToken, "output") } } } },
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
      responses: { "200": { description: "Updated", content: { "application/json": { schema: jsonSchema(savedTail, "output") } } } },
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
      responses: { "200": { description: "Test result", content: { "application/json": { schema: jsonSchema(okResult, "output") } } } },
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
              schema: jsonSchema(z.array(githubRepository), "output"),
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
      responses: { "200": { description: "Options", content: { "application/json": { schema: jsonSchema(providerOptions, "output") } } } },
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
  route("GET", "/api/v1/job-summaries", "flows:read", {
    summary: "List bounded job summaries",
    description: "Additive list representation, ordered by immutable UUID descending. Cursor is the last ID; filters must remain the same between pages. Literal case-insensitive name/slug search. No prompts or trigger configuration; statistics are batched. Existing GET /jobs remains an array.",
    responses: { "200": { description: "Summary page", content: { "application/json": { schema: jsonSchema(jobSummaryPage, "output") } } } },
  }, (service, { query }) => service.listJobSummaries(query), { query: jobPageQuery }),
  route("GET", "/api/v1/job-selector", "flows:read", {
    summary: "Search bounded lifecycle job options",
    responses: { "200": { description: "Selector page; same ordering/filter semantics as job-summaries", content: { "application/json": { schema: jsonSchema(jobSelectorPage, "output") } } } },
  }, (service, { query }) => service.listJobSummaries(query, true), { query: jobPageQuery }),
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
              schema: jsonSchema(z.array(jobResponse), "output"),
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
    { summary: "Create job", responses: { "201": { description: "Created", content: { "application/json": { schema: jsonSchema(jobResponse, "output") } } } } },
    (service, { body }) => service.createJob(body),
    { body: jobInputSchema },
  ),
  route(
    "POST",
    "/api/v1/job-conditions/test",
    "flows:write",
    {
      summary: "Test webhook conditions",
      description: "Evaluates supplied prepared webhook context only; does not authenticate the example, route events, verify GitHub state, or invoke jobs.",
      responses: { "200": { description: "Decision", content: { "application/json": { schema: jsonSchema(z.object({ decision: z.enum(["match", "no-match", "error"]), error: z.string().optional(), details: z.array(z.record(z.string(), z.unknown())) }), "output") } } } },
    },
    (service, { body }) => service.testJobConditions(body),
    { body: jobConditionsTestSchema, maxBodyBytes: 300_000 },
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
    { summary: "Get job", responses: { "200": { description: "Job", content: { "application/json": { schema: jsonSchema(jobResponse, "output") } } } } },
    (service, { params }) => service.getJob(params.jobId),
  ),
  route(
    "PUT",
    "/api/v1/jobs/{jobId}",
    "flows:write",
    {
      summary: "Replace job",
      description: "Supply expectedUpdatedAt from GET for atomic optimistic concurrency. Stale edits return 409 stale_job. Omission preserves legacy REST/MCP last-writer-wins updates. Trigger identity is preserved.",
      responses: { "200": { description: "Updated", content: { "application/json": { schema: jsonSchema(jobResponse, "output") } } }, "409": { description: "stale_job: reload and reconcile before retrying" } },
    },
    (service, { params, body }) => service.updateJob(params.jobId, body),
    { body: jobUpdateInput },
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
      description: "Returns tenant-authorized runs. When sort is supplied, ordering is applied before cursor pagination; statuses sort lexically by their persisted state, missing values sort last, and ties use run ID. Without sort, runs remain newest-created first.",
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
      summary: "Search jobs and runs by approximate metadata matches",
      description: "Search uses PostgreSQL pg_trgm approximate matching over job names/slugs and run names, issue titles, and issue identifiers. Identifier matching is whole-field trigram matching; names and titles use word-level trigram matching. Exact identifiers and metadata names rank first, followed by the strongest individual field score. Results are unique, tenant-scoped, deterministically ordered, and limited to 100. Blank or punctuation-only queries return no results. One- and two-character queries may return no results because trigram matching is approximate; this is not ordered-character or substring matching.\n\nRequires the runs:read scope.\n\nAccepts a scoped bearer token or interactive owner session.",
      responses: { "200": { description: "Search results", content: { "application/json": { schema: jsonSchema(searchResponse, "output") } } } },
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
  route("GET", "/api/v1/runs/{runId}/status", "runs:read", {
    summary: "Get lightweight run status",
    description: "No prompt decryption, invocation context, artifacts, activity or diagnostics assembly. Continue polling terminal runs while finalizing is true. trace_revision changes on generation transition or canonical projection/replay; live appends retain the revision. Full detail remains available at GET /runs/{runId}.",
    responses: { "200": { description: "Status", content: { "application/json": { schema: jsonSchema(runStatusResponse, "output") } } } },
  }, (service, { params }) => service.getRunStatus(params.runId), { parameters: z.object({ runId: z.guid() }) }),
  route("GET", "/api/v1/runs/{runId}/trace-pages", "runs:read", {
    summary: "Get revision-bound trace page",
    description: "First request omits revision and uses after=0. Subsequent requests supply the returned revision. A changed generation or canonical projection returns reset=true and events from zero in the new revision, from one database snapshot. Discard all cached old pages before merging the response. nextCursor=null means caught up, not finalized; poll after the last sequence while active/finalizing. Legacy GET /trace remains unchanged.",
    responses: { "200": { description: "Revision-bound page", content: { "application/json": { schema: jsonSchema(revisionTracePage, "output") } } } },
  }, (service, { params, query }) => service.getRevisionTrace(params.runId, query.after, query.limit, query.revision), { query: revisionTraceQuery, parameters: z.object({ runId: z.guid() }) }),
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
export function isBrowserAuthOperation(method: string, path: string): boolean {
  return API_ROUTES.some(route => route.authOperation && route.method === method && route.path === path);
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
    JobConditionsTest: jobConditionsTestSchema,
    TraceReplayRequest: traceReplaySchema,
  };
  const schemas = {
    ...document.components.schemas,
    Run: { ...jsonSchema(runSummaryResponse, "output"), additionalProperties: true },
    RunPage: jsonSchema(runPageResponse, "output"),
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
        route.authOperation ? undefined : `Requires the ${route.scope} scope.`,
        route.authOperation ? undefined : route.ownerSession
          ? "An interactive owner session is required; bearer tokens cannot call this operation."
          : "Accepts a scoped bearer token or interactive owner session.",
      ]
        .filter(Boolean)
        .join("\n\n"),
      operationId: `${route.method.toLowerCase()}_${route.path.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "")}`,
      tags: [route.path.split("/")[3]],
      security: route.authOperation ? (route.ownerSession ? [{ cookieAuth: [] }] : []) : [{ bearerAuth: [] }, { cookieAuth: [] }],
      ...(route.authOperation ? { "x-browser-auth-operation": route.authOperation } : { "x-required-scope": route.scope }),
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
    components: { ...document.components, securitySchemes: { ...document.components.securitySchemes, cookieAuth: { type: "apiKey", in: "cookie", name: "factorize_session" } }, schemas, responses: errorResponses },
    paths,
  };
}
