import { cloneInfo, gitCredential } from "./git-https-contracts";
import { presetInput, presetResponse, presetList } from "./presets";
import { skillTriggerInput, skillTriggerResponse } from "./skill-trigger";
import { skillSettings, skillSettingsInput } from "./skill-settings";
import { profileInput, profileResponse } from "./usernames";
import {mediaUploadInput,mediaReceipt,fetchMediaInput} from "./media-contracts";
import {modelProviderConfiguration} from "./pi-provider";
import { teamRunDefaults, teamResponse } from "./flow-schemas";
import { vmPreset, vmPresetInput } from "./vm-presets";
import { configureLibrary,libraryStatus,libraryToken } from "./skill-library-contract";
import {phoenixInput,phoenixRevision,phoenixConfig,phoenixTest} from "./phoenix-contracts";
import {telemetryPageQuery,telemetryPage,telemetryContentQuery,telemetryContent} from "./run-telemetry";
import {pricingList,pricingOverrideInput,pricingOverrideReceipt} from "./model-pricing";
import {createPayloadInput,payloadReceipt,appendPayloadInput,finalizePayloadInput,attachmentInput} from "./proxy-payloads";
import {operationRef,operationRead,operationReceipt} from "./proxy-operations";
import {queryApiResponseInput,queryApiResponseResult} from "./agent-api-contracts";
import { vmExecInput,vmExecResult, grantVmInput, vmGrantReceipt, vmGrantRenewal, apiReflection, apiPolicyList, apiPolicyInput, requestApiInput, requestApiResponse, readApiResponseInput, apiResponseChunk } from "./agent-api-contracts";
import { queryOf } from "./query-params";
import { launchPayloadResponse } from "./launch-payload";
import { searchResponse } from "./search-contracts";
import { consentPreviewInput, consentPreviewResponse, consentDecisionInput, consentDecisionResponse } from "./consent-api";
import { exeConnection, integrationStatus, clientPermissionsUpdate, authorizedClient, accessToken, createdAccessToken, savedExe, testedExe, savedAmp, savedTail, okResult } from "./settings-contracts";
import { eventAvailabilityResponse, namedOption, providerOptions, githubInstallation, githubRepository, tailIntegration } from "./editor-contracts";
import { runSummaryResponse, runPageResponse, runStatusResponse, fullRunResponse, revisionTracePage, revisionTraceQuery, runtimeContextResponse, runtimeIntegrationsResponse } from "./run-read-contracts";
import { triggerPageQuery, triggerSummaryPage, triggerSelectorPage, triggerResponse, triggerUpdateInput } from "./job-contracts";
import { projectGraphResponse } from "./project-graph-contracts";
import { z } from "zod";
import { vmAttachments } from "./vm-attachment-contracts";
import type { ApiService } from "./flow-service";
import {
  triggerInputSchema,
  startRunInput, startRunReceipt, manualInvocationSchema,
  renameRunSchema,
  reportRunErrorSchema,
  invocationPermissionsInput,
  invocationPermissionsResponse,
  reportRunErrorResponse,
  triggerConditionsTestSchema,
  listRunsSchema,
  scopeSchema,
  vmImageVerificationInput,
  vmImageVerificationResponse,
} from "./flow-schemas";
import { traceReplaySchema } from "./trace-replay-schemas";

import { X_OAUTH_SCOPES } from "./x-oauth";
import document from "./api-document.json";
import { authInputs, authSuccess, continuationSuccess, connectionStartInput, connectionStartSuccess, connectionResumeInput, loginSuccess, sessionResponse, type AuthAction } from "./auth-api";
import { skillDirectoryResponse, skillInput, skillUpdateInput, skillPage, skillResponse, skillTriggersResponse, previewSkillInput, previewPromptResponse } from "./skills";
import { flyConnectionInput, flyConnectionMetadata } from "./fly-account-client";
import { flyExecutionConfiguration, flyExecutionConfigurationInput } from "./fly-execution-configurations";

type JsonSchema = Record<string, any>;
export interface RouteContract {
  method: string;
  path: string;
  scope: string | string[];
  ownerSession: boolean;
  vendorIdentityOnly?: boolean;
  authOperation?: AuthAction;
  body?: z.ZodType;
  rawBody?:boolean;
  maxBodyBytes?: number;
  query?: z.ZodObject;
  parameters: z.ZodObject;
  status: number;
  documentation: Record<string, any>;
  execute: (
    service: ApiService,
    input: { params: Record<string, string>; body: any; query: any; url: URL; signal?: AbortSignal; request?:Request },
  ) => Promise<unknown>;
}

const exeBody = z.object({
  connectionId: z.string().min(1).optional(),
  apiToken: z.string().min(1).meta({ writeOnly: true }).optional(),
  tags: z
    .array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/))
    .max(20)
    .optional(),
}).strict();
const exeTestBody = exeBody
  .partial()
  .refine((value) => Boolean(value.connectionId || value.apiToken), {
    message: "Supply a saved connectionId or apiToken",
  });
const ampBody = z.object({
  connectionId: z.string().min(1).optional(),
  accessToken: z.string().min(1).meta({ writeOnly: true }).optional(),
  project: z.string().min(1).optional(),
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
  triggerId: z.string().optional(),
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
const skillQuery = z.object({ q: z.string().default(""), limit: z.coerce.number().int().min(1).max(100).default(30), cursor: z.guid().optional() });
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
const bearerIntegrationMetadata = z.object({
  kind: z.literal("bearer").optional(), id: z.uuid(), name: z.string(), origin: z.string(), description: z.string().nullable(),
  revision: z.number().int().nonnegative(),
});
const bearerIntegrationCreate = z.object({
  id: z.uuid(), expectedRevision: z.number().int().nonnegative(), idempotencyKey: z.uuid(),
  name: z.string().trim().min(1).max(120), origin: z.string().url().max(2048),
  description: z.string().max(500).nullable(), token: z.string().min(1).max(32_768).regex(/^[^\r\n]+$/).meta({writeOnly:true}),
}).strict();
const bearerIntegrationUpdate = bearerIntegrationCreate.omit({ id: true });
const bearerIntegrationDelete = z.object({ expectedRevision: z.number().int().nonnegative(), idempotencyKey: z.uuid() }).strict();
const bearerIntegrationList = z.object({ revision: z.number().int().nonnegative(), integrations: z.array(bearerIntegrationMetadata) });
const modelAccountMetadata = z.object({ id: z.uuid(), name: z.string(), description: z.string().nullable(), revision: z.number().int().nonnegative(), credentialConfigured: z.boolean(),providerUrl:z.string().nullable(),contextWindow:z.number().int().nullable(),maxTokens:z.number().int().nullable() });
const modelAccountCreate = z.object({
  id: z.uuid(), expectedRevision: z.number().int().nonnegative(), idempotencyKey: z.uuid(),
  name: z.string().trim().min(1).max(120), description: z.string().max(500).nullable(),
  ...modelProviderConfiguration.shape,

}).strict();
const modelAccountDelete = z.object({ expectedRevision: z.number().int().nonnegative(), idempotencyKey: z.uuid() }).strict();
const modelAccountList = z.object({ revision: z.number().int().nonnegative(), accounts: z.array(modelAccountMetadata) });
const xConnectionMetadata = z.object({ id: z.uuid(), name: z.string(), clientId: z.string(), scopes: z.array(z.string()), accountId: z.string().nullable(), accountHandle: z.string().nullable(), grantedScopes: z.array(z.string()), status: z.enum(["pending", "connected", "reconnect_required", "revoked"]), createdAt: z.string(), updatedAt: z.string() });
const xConnectionCreate = z.object({
  id: z.uuid(), name: z.string().trim().min(1).max(120), clientId: z.string().trim().min(1).max(256),
  clientSecret: z.string().min(1).max(4096).regex(/^[^\r\n]+$/).meta({ writeOnly: true }),
  scopes: z.array(z.enum(Object.keys(X_OAUTH_SCOPES) as [keyof typeof X_OAUTH_SCOPES, ...(keyof typeof X_OAUTH_SCOPES)[]])).min(1).max(Object.keys(X_OAUTH_SCOPES).length),
}).strict();
const xConnectionList = z.object({ connections: z.array(xConnectionMetadata) });
const xAuthorizationStart = z.object({ authorizationUrl: z.url() });
const xConnectionTest = z.object({ status: z.enum(["connected", "failed", "reconnect_required"]), accountHandle: z.string().nullable(), message: z.string() });
const xConnectionCredentialReplacement = z.object({ clientId: z.string().trim().min(1).max(256), clientSecret: z.string().min(1).max(4096).regex(/^[^\r\n]+$/).meta({ writeOnly: true }) }).strict();
const bearerIntegrationWriteResult = z.object({ revision: z.number().int().nonnegative(), duplicate: z.boolean() });
const bearerIntegrationDeleteResult = z.object({ id: z.uuid(), deleted: z.literal(true), revision: z.number().int().nonnegative(), duplicate: z.boolean() });

function route(
  method: string,
  path: string,
  scope: string | string[],
  documentation: RouteContract["documentation"],
  execute: RouteContract["execute"],
  options: Partial<
    Pick<RouteContract, "body" | "rawBody" | "maxBodyBytes" | "query" | "ownerSession" | "vendorIdentityOnly" | "parameters" | "authOperation" | "scope">
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
  const requiredScope = scope;
  return {
    method,
    path,
    scope: requiredScope,
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
    method, path, authOperation: action, scope: [], ownerSession: action === "password",
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
  route("GET", "/api/v1/x/connections", "integrations:read", {
    summary: "List X connections",
    description: "Requires an interactive owner session. Returns named connection metadata, account identity, selected/granted scopes, and status. Client secrets and OAuth tokens are never returned.",
    responses: { "200": { description: "X connection metadata", content: { "application/json": { schema: jsonSchema(xConnectionList, "output") } } } },
  }, service => service.listXConnections(), { ownerSession: true }),
  route("POST", "/api/v1/x/connections", "integrations:write", {
    summary: "Add a user-owned X app connection",
    description: "Requires an interactive owner session. Stores the X OAuth client secret in Factorize-managed encrypted storage and never returns it. Selected scopes are validated before saving.",
    responses: { "201": { description: "X connection created", content: { "application/json": { schema: jsonSchema(xConnectionMetadata, "output") } } } },
  }, (service, { body }) => service.createXConnection(body), { body: xConnectionCreate, maxBodyBytes: 8192, ownerSession: true }),
  route("DELETE", "/api/v1/x/connections/{connectionId}", "integrations:write", {
    summary: "Delete an X connection",
    description: "Requires an interactive owner session. Immediately clears the encrypted credential and revokes the connection. A secret-free tombstone prevents old run snapshots from being revived if an identifier is reused.",
    responses: { "200": { description: "X connection deleted", content: { "application/json": { schema: jsonSchema(z.object({ id: z.uuid(), deleted: z.literal(true) }), "output") } } } },
  }, (service, { params }) => service.deleteXConnection(params.connectionId), { ownerSession: true, parameters: z.object({ connectionId: z.uuid() }) }),
  route("POST", "/api/v1/x/connections/{connectionId}/authorize", "integrations:write", {
    summary: "Start X OAuth authorization",
    description: "Requires an interactive owner session. Starts a short-lived PKCE authorization bound to this owner, tenant, session, connection, and selected scopes. The one-time state is set in an HttpOnly cookie.",
    responses: { "200": { description: "X authorization URL", content: { "application/json": { schema: jsonSchema(xAuthorizationStart, "output") } } } },
  }, async (service, { params }) => {
    const started = await service.authorizeXConnection(params.connectionId);
    return Response.json({ authorizationUrl: started.authorizationUrl }, { headers: { "Set-Cookie": `factorize_x_oauth_state=${started.stateCookie}; HttpOnly; Secure; SameSite=Lax; Path=/oauth/x/callback; Max-Age=600` } });
  }, { body: z.object({}).strict(), maxBodyBytes: 1024, ownerSession: true, parameters: z.object({ connectionId: z.uuid() }) }),
  route("POST", "/api/v1/x/connections/{connectionId}/test", "integrations:read", {
    summary: "Test an X connection",
    description: "Requires an interactive owner session. Performs a non-mutating GET to X /2/users/me using the saved access token. Returns only a safe status and the already stored account handle; it never returns tokens, credentials, or upstream error bodies. The verification read may incur X API usage charges.",
    responses: { "200": { description: "Safe connection test result", content: { "application/json": { schema: jsonSchema(xConnectionTest, "output") } } } },
  }, (service, { params }) => service.testXConnection(params.connectionId), { body: z.object({}).strict(), maxBodyBytes: 1024, ownerSession: true, parameters: z.object({ connectionId: z.uuid() }) }),
  route("PUT", "/api/v1/x/connections/{connectionId}/credentials", "integrations:write", {
    summary: "Replace X app credentials",
    description: "Requires an interactive owner session. Replaces the encrypted client credentials, invalidates saved access and refresh tokens and pending OAuth attempts, preserves the existing account identity binding, and requires reauthorization. Reauthorization cannot switch the connection to a different X account; create a new connection for another account. Existing run selections remain unavailable until authorization succeeds.",
    responses: { "200": { description: "Updated safe connection metadata", content: { "application/json": { schema: jsonSchema(xConnectionMetadata, "output") } } } },
  }, (service, { params, body }) => service.replaceXConnectionCredentials(params.connectionId, body), { body: xConnectionCredentialReplacement, maxBodyBytes: 8192, ownerSession: true, parameters: z.object({ connectionId: z.uuid() }) }),
  route("GET", "/api/v1/model-accounts", "integrations:read", {
    summary: "List model accounts available to the owner",
    description: "Requires an interactive owner browser session. Returns account metadata and the collection revision only; encrypted account caches and credentials are never returned.",
    responses: { "200": { description: "Model account metadata and collection revision", content: { "application/json": { schema: jsonSchema(modelAccountList, "output") } } } },
  }, service => service.listModelAccounts(), { ownerSession: true }),
  route("POST", "/api/v1/model-accounts", "integrations:write", {
    summary: "Create a model account",
    description: "Requires an interactive owner browser session and the current collection revision. Saves an OpenAI-compatible provider URL, optional API key, and model limits in encrypted storage. Credentials are never returned.",
    responses: { "201": { description: "Created model account", content: { "application/json": { schema: jsonSchema(bearerIntegrationWriteResult, "output") } } } },
  }, (service, { body }) => service.createModelAccount(body), { body: modelAccountCreate, maxBodyBytes: 70_000, ownerSession: true }),
  route("PUT", "/api/v1/model-accounts/{accountId}", "integrations:write", {summary:"Update a model account credential",description:"Owner session required. An omitted API key preserves the saved key when the provider URL is unchanged. Supply a replacement key or explicit null for keyless access when changing the provider URL. Active runs use the updated credential on their next request.",responses:{"200":{description:"Model account updated",content:{"application/json":{schema:jsonSchema(bearerIntegrationWriteResult,"output")}}}}},(service,{params,body})=>service.updateModelAccount(params.accountId,body),{body:modelAccountCreate.omit({id:true}).extend({apiKey:modelProviderConfiguration.shape.apiKey.unwrap().nullable().optional().meta({writeOnly:true})}),maxBodyBytes:70_000,ownerSession:true,parameters:z.object({accountId:z.uuid()})}),

  route("DELETE", "/api/v1/model-accounts/{accountId}", "integrations:write", {
    summary: "Delete a model account",
    description: "Requires an interactive owner browser session and the current collection revision. Deletion is recorded as a tombstone so future run snapshots reject the disconnected account.",
    responses: { "200": { description: "Deleted model account", content: { "application/json": { schema: jsonSchema(bearerIntegrationDeleteResult, "output") } } } },
  }, (service, { params, body }) => service.deleteModelAccount(params.accountId, body), { body: modelAccountDelete, maxBodyBytes: 4096, ownerSession: true, parameters: z.object({ accountId: z.uuid() }) }),
  route("GET", "/api/v1/integrations/bearer", "integrations:read", {
    summary: "List bearer integration metadata",
    description: "Requires an interactive owner browser session. Returns secret-safe metadata only; stored bearer credentials are never returned.",
    responses: { "200": { description: "Bearer integration metadata", content: { "application/json": { schema: jsonSchema(bearerIntegrationList, "output") } } } },
  }, service => service.listBearerIntegrations(), { ownerSession: true }),
  route("POST", "/api/v1/integrations/bearer", "integrations:write", {
    summary: "Create a bearer integration",
    description: "Requires an interactive owner browser session. Accepts the secret over the authenticated connection and encrypts it with Factorize-managed storage before persistence. The secret is never returned.",
    responses: { "201": { description: "Created integration", content: { "application/json": { schema: jsonSchema(bearerIntegrationWriteResult, "output") } } } },
  }, (service, { body }) => service.createBearerIntegration(body), { body: bearerIntegrationCreate, maxBodyBytes: 70_000, ownerSession: true }),
  route("PUT", "/api/v1/integrations/bearer/{integrationId}", "integrations:write", {
    summary: "Update a bearer integration",
    description: "Requires an interactive owner browser session and the current collection revision. Accepts a replacement secret and encrypts it with Factorize-managed storage before persistence. The secret is never returned.",
    responses: { "200": { description: "Updated integration", content: { "application/json": { schema: jsonSchema(bearerIntegrationWriteResult, "output") } } } },
  }, (service, { params, body }) => service.updateBearerIntegration(params.integrationId, body), { body: bearerIntegrationUpdate, maxBodyBytes: 70_000, ownerSession: true }),
  route("DELETE", "/api/v1/integrations/bearer/{integrationId}", "integrations:write", {
    summary: "Delete an encrypted bearer integration",
    description: "Requires an interactive owner browser session and the current collection revision.",
    responses: { "200": { description: "Deleted integration", content: { "application/json": { schema: jsonSchema(bearerIntegrationDeleteResult, "output") } } } },
  }, (service, { params, body }) => service.deleteBearerIntegration(params.integrationId, body), { body: bearerIntegrationDelete, maxBodyBytes: 4096, ownerSession: true }),
  authRoute("POST", "/api/v1/auth/connections", "connection-start", "Persist an individual validated MCP connection; sets a per-attempt browser cookie", connectionStartSuccess, connectionStartInput),
  authRoute("POST", "/api/v1/auth/connections/resume", "connection-resume", "Resume verified onboarding in the initiating browser; never grants OAuth access", continuationSuccess, connectionResumeInput),
  {...authRoute("GET", "/api/v1/profile", "profile", "Read your profile; interactive owner browser session required", profileResponse),ownerSession:true},
  {...authRoute("PUT", "/api/v1/profile", "profile-update", "Change your globally unique username; interactive owner browser session required", profileResponse, profileInput),ownerSession:true},
  authRoute("GET", "/api/v1/session", "session", "Get current browser session", sessionResponse),
  authRoute("POST", "/api/v1/auth/login", "login", "Sign in", loginSuccess, authInputs.login),
  authRoute("POST", "/api/v1/auth/signup", "signup", "Request signup; existing accounts return the same accepted response", authSuccess, authInputs.signup, 202),
  authRoute("POST", "/api/v1/auth/email-verification/request", "verification-request", "Request email verification", authSuccess, authInputs.request),
  authRoute("POST", "/api/v1/auth/email-verification/complete", "verification", "Verify email, establish an owner session, and resume explicit consent; callbacks stay in the initiating browser", continuationSuccess, authInputs.verify),
  authRoute("POST", "/api/v1/auth/password-reset/request", "reset-request", "Request password reset", authSuccess, authInputs.request),
  authRoute("POST", "/api/v1/auth/password-reset/complete", "reset", "Complete password reset and resume onboarding", continuationSuccess, authInputs.reset),
  authRoute("POST", "/api/v1/auth/password", "password", "Change password and invalidate sessions", authSuccess, authInputs.change),
  authRoute("POST", "/api/v1/auth/logout", "logout", "Revoke current session and clear browser cookie", authSuccess),

  route("POST", "/api/v1/oauth/device/preview", "triggers:read", { summary: "Inspect a device authorization code", responses: { "200": { description: "Pending device request", content: { "application/json": { schema: jsonSchema(z.object({ userCode: z.string(), clientName: z.string(), scopes: z.array(z.string()), expiresAt: z.string(), signature: z.string(), integrationLabels: z.array(z.object({scope:z.string(),name:z.string(),description:z.string().nullable()})).optional() }), "output") } } } } }, async () => undefined, { body: z.object({ userCode: z.string().min(1).max(32) }).strict(), authOperation: "device-preview", ownerSession: true }),
  route("POST", "/api/v1/oauth/device/decision", "triggers:write", { summary: "Approve or deny a device authorization code", responses: { "200": { description: "Device decision", content: { "application/json": { schema: jsonSchema(z.object({ status: z.enum(["approved", "denied"]) }), "output") } } } } }, async () => undefined, { body: z.object({ userCode: z.string().min(1).max(32), signature: z.string().min(1).max(256), decision: z.enum(["allow", "deny"]) }).strict(), authOperation: "device-decision", ownerSession: true }),
  route("POST", "/api/v1/oauth/consent/preview", "triggers:read", { summary: "Inspect an OAuth consent request", responses: { "200": { description: "Owner-bound expiring consent", content: { "application/json": { schema: jsonSchema(consentPreviewResponse, "output") } } } } }, async () => undefined, { body: consentPreviewInput, authOperation: "consent-preview", ownerSession: true }),
  route("POST", "/api/v1/oauth/consent/decision", "triggers:write", { summary: "Decide an OAuth consent request", responses: { "200": { description: "Validated protocol destination", content: { "application/json": { schema: jsonSchema(consentDecisionResponse, "output") } } } } }, async () => undefined, { body: consentDecisionInput, authOperation: "consent-decision", ownerSession: true }),
  route("GET", "/api/v1/event-contexts", "triggers:read", {
    summary: "Get template autocomplete metadata",
    responses: { "200": { description: "Paths by event kind/provider", content: { "application/json": { schema: jsonSchema(z.record(z.string(), z.array(z.object({ path: z.string(), type: z.enum(["string", "number", "boolean", "object", "array", "unknown"]), description: z.string(), example: z.unknown().optional() }))), "output") } } } },
  }, service => service.eventContextMetadata()),
  route(
    "GET",
    "/api/v1/exe-connections",
    "integrations:read",
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
    "integrations:read",
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
    "/api/v1/trigger-event-availability",
    "triggers:read",
    {
      summary: "List available event kinds",
      responses: { "200": { description: "Availability", content: { "application/json": { schema: jsonSchema(eventAvailabilityResponse, "output") } } } },
    },
    (service) => service.listTriggerEventAvailability(),
  ),
  route(
    "POST",
    "/api/v1/schedules/preview",
    "triggers:read",
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
    "integrations:read",
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
    "integrations:read",
    {
      summary: "List installed integrations",
      responses: {
        "200": { description: "Credential-safe integration status", content: { "application/json": { schema: jsonSchema(integrationStatus, "output") } } },
      },
    },
    (service) => service.integrationStatus(),
  ),
  route("GET", "/api/v1/fly/connection", "integrations:read", {
    summary: "Read Fly account connection status",
    description: "Owner browser session only. Returns organization metadata and never returns the provisioning token.",
    responses: { "200": { description: "Connection status", content: { "application/json": { schema: jsonSchema(z.object({ connection: flyConnectionMetadata.nullable() }), "output") } } } },
  }, service => service.getFlyConnection(), { ownerSession: true }),
  route("POST", "/api/v1/fly/connection/test", "integrations:write", {
    summary: "Validate a Fly organization token",
    description: "Owner browser session only. Supply an org-scoped Fly deploy token with permission to manage Machines in the selected organization, created with `fly tokens create org --org <slug>`. A read-only org token is insufficient for later provisioning. Validation calls Fly's documented read-only current-token endpoint and launches no resources.",
    responses: { "200": { description: "Validated organization", content: { "application/json": { schema: jsonSchema(z.object({ valid: z.literal(true), connection: flyConnectionMetadata }), "output") } } } },
  }, (service, { body }) => service.validateFlyConnection(body), { body: flyConnectionInput, ownerSession: true }),
  route("PUT", "/api/v1/fly/connection", "integrations:write", {
    summary: "Save a Fly account connection",
    description: "Owner browser session only. Supply an org-scoped Fly deploy token with permission to manage Machines in the selected organization, created with `fly tokens create org --org <slug>`. A read-only org token is insufficient for provisioning. The server validates the connection and encrypts the token with its credential key; the token is never returned.",
    responses: { "200": { description: "Saved connection metadata", content: { "application/json": { schema: jsonSchema(z.object({ connection: flyConnectionMetadata }), "output") } } } },
  }, (service, { body }) => service.saveFlyConnection(body), { body: flyConnectionInput, ownerSession: true }),
  route("DELETE", "/api/v1/fly/connection", "integrations:write", {
    summary: "Remove the Fly account connection",
    description: "Owner browser session only. Deletes the tenant's encrypted provisioning token.",
    responses: { "200": { description: "Deletion result", content: { "application/json": { schema: jsonSchema(z.object({ deleted: z.boolean() }), "output") } } } },
  }, service => service.removeFlyConnection(), { ownerSession: true }),
  route("GET", "/api/v1/presets", "integrations:read", {summary:"List team VM, permission and model presets with defaults and immutable revisions",responses:{"200":{description:"Presets",content:{"application/json":{schema:jsonSchema(presetList,"output")}}}}},service=>service.listPresets()),
  route("POST", "/api/v1/presets", "integrations:write", {summary:"Create a preset with a team-unique immutable slug",responses:{"200":{description:"Preset",content:{"application/json":{schema:jsonSchema(z.object({preset:presetResponse}),"output")}}}}},(service,{body})=>service.savePreset(body),{body:presetInput}),
  route("PUT", "/api/v1/presets/{id}", "integrations:write", {summary:"Create a new revision of a preset",responses:{"200":{description:"Preset",content:{"application/json":{schema:jsonSchema(z.object({preset:presetResponse}),"output")}}}}},(service,{body,params})=>service.savePreset(body,params.id),{body:presetInput,parameters:z.object({id:z.uuid()})}),
  route("POST", "/api/v1/presets/{id}/default", "team:write", {summary:"Select the team default for this preset type",responses:{"200":{description:"Default preset",content:{"application/json":{schema:jsonSchema(z.object({preset:presetResponse}),"output")}}}}},(service,{params})=>service.defaultPreset(params.id),{parameters:z.object({id:z.uuid()})}),
  route("DELETE", "/api/v1/presets/{id}", "integrations:write", {summary:"Delete an unused, non-default preset while retaining historical revisions",responses:{"200":{description:"Deleted",content:{"application/json":{schema:jsonSchema(z.object({deleted:z.boolean()}),"output")}}}}},(service,{params})=>service.deletePreset(params.id),{parameters:z.object({id:z.uuid()})}),
  route("GET", "/api/v1/vm-presets", "integrations:read", {
    summary: "List VM presets", responses: { "200": { description: "List VM presets", content: { "application/json": { schema: jsonSchema(z.object({ presets: z.array(vmPreset) }), "output") } } } },
  }, service => service.listVmPresets(), { ownerSession: true }),
  route("POST", "/api/v1/vm-presets", "integrations:write", {
    summary: "Create a VM preset", responses: { "200": { description: "Create a VM preset", content: { "application/json": { schema: jsonSchema(z.object({ preset: vmPreset }), "output") } } } },
  }, (service, { body }) => service.saveVmPreset(body), { ownerSession: true, body: vmPresetInput }),
  route("PUT", "/api/v1/vm-presets/{id}", "integrations:write", {
    summary: "Update a VM preset", responses: { "200": { description: "Update a VM preset", content: { "application/json": { schema: jsonSchema(z.object({ preset: vmPreset }), "output") } } } },
  }, (service, { body, params }) => service.saveVmPreset(body, params.id), { ownerSession: true, body: vmPresetInput, parameters: z.object({ id: z.uuid() }) }),
  route("DELETE", "/api/v1/vm-presets/{id}", "integrations:write", {
    summary: "Delete a VM preset", responses: { "200": { description: "Delete a VM preset", content: { "application/json": { schema: jsonSchema(z.object({ deleted: z.boolean() }), "output") } } } },
  }, (service, { params }) => service.removeVmPreset(params.id!), { ownerSession: true, parameters: z.object({ id: z.uuid() }) }),
  route("GET", "/api/v1/fly/execution-configurations", "integrations:read", {
    summary: "List Fly execution configurations", description: "Returns tenant-owned image, region, and VM size selections without connection credentials.",
    responses: { "200": { description: "Configurations", content: { "application/json": { schema: jsonSchema(z.object({ configurations: z.array(flyExecutionConfiguration) }), "output") } } } },
  }, service => service.listFlyExecutionConfigurations(), { ownerSession: true }),
  route("POST", "/api/v1/fly/execution-configurations", "integrations:write", {
    summary: "Create a Fly execution configuration", description: "Requires a saved Fly connection and validates region and VM size against bounded provider metadata.",
    responses: { "200": { description: "Created configuration", content: { "application/json": { schema: jsonSchema(z.object({ configuration: flyExecutionConfiguration }), "output") } } } },
  }, (service, { body }) => service.saveFlyExecutionConfiguration(body), { body: flyExecutionConfigurationInput, ownerSession: true }),
  route("GET", "/api/v1/fly/execution-configurations/{id}", "integrations:read", {
    summary: "Read a Fly execution configuration", responses: { "200": { description: "Configuration", content: { "application/json": { schema: jsonSchema(z.object({ configuration: flyExecutionConfiguration }), "output") } } } },
  }, (service, { params }) => service.getFlyExecutionConfiguration(params.id!), { ownerSession: true, parameters: z.object({ id: z.uuid() }) }),
  route("PUT", "/api/v1/fly/execution-configurations/{id}", "integrations:write", {
    summary: "Update a Fly execution configuration", responses: { "200": { description: "Updated configuration", content: { "application/json": { schema: jsonSchema(z.object({ configuration: flyExecutionConfiguration }), "output") } } } },
  }, (service, { params, body }) => service.saveFlyExecutionConfiguration(body, params.id), { body: flyExecutionConfigurationInput, ownerSession: true, parameters: z.object({ id: z.uuid() }) }),
  route("DELETE", "/api/v1/fly/execution-configurations/{id}", "integrations:write", {
    summary: "Delete a Fly execution configuration", responses: { "200": { description: "Deletion result", content: { "application/json": { schema: jsonSchema(z.object({ id: z.string(), deleted: z.literal(true) }), "output") } } } },
  }, (service, { params }) => service.removeFlyExecutionConfiguration(params.id!), { ownerSession: true, parameters: z.object({ id: z.uuid() }) }),
  route(
    "PUT",
    "/api/v1/integrations/exe",
    "integrations:write",
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
    "integrations:write",
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
    "integrations:write",
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
    "integrations:write",
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
    "integrations:write",
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
    "integrations:read",
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
    "integrations:read",
    {
      summary: "List Linear event options",
      responses: { "200": { description: "Options", content: { "application/json": { schema: jsonSchema(providerOptions, "output") } } } },
    },
    (service) => service.linearOptions(),
  ),
  route(
    "GET",
    "/api/v1/providers/clickup/lists",
    "integrations:read",
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
    "integrations:read",
    {
      summary: "List ClickUp event options",
      responses: { "200": { description: "Options", content: { "application/json": { schema: jsonSchema(providerOptions, "output") } } } },
    },
    (service, { query }) => service.clickUpOptions(query.listId),
    { query: clickUpQuery },
  ),
  route(
    "GET",
    "/api/v1/providers/github/installations",
    "integrations:read",
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
    "triggers:read",
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
    "triggers:read",
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
    "triggers:write",
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
    "triggers:write",
    {
      summary: "Revoke an access token",
      responses: { "200": { description: "Revoked" } },
    },
    (service, { params }) => service.revokeAccessToken(params.tokenId),
    { ownerSession: true },
  ),
  route("PUT", "/api/v1/access/authorizations/{grantId}/permissions", "triggers:write", {
    summary: "Edit an OAuth connection’s scopes and integration access",
    responses: {"200": {description: "Permissions saved", content: {"application/json": {schema: jsonSchema(okResult, "output")}}}},
  }, (service, {params, body}) => service.updateClientPermissions(params.grantId, body), {ownerSession: true, body: clientPermissionsUpdate}),
  route("DELETE", "/api/v1/access/authorizations/{grantId}", "triggers:write", {summary:"Revoke one isolated OAuth connection", description:"Other connections, including copies of the same client, retain their approvals.",responses:{"200":{description:"Authorization revoked",content:{"application/json":{schema:jsonSchema(z.object({revoked:z.number().int()}),"output")}}}}}, (service,{params})=>service.revokeOAuthAuthorization(params.grantId), {ownerSession:true}),
  route(
    "DELETE",
    "/api/v1/access/authorized-clients/{clientId}",
    "triggers:write",
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
    "integrations:write",
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
    "integrations:write",
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
    "integrations:write",
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
    "integrations:write",
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
    "integrations:write",
    {
      summary: "Test a Tail integration",
      responses: { "200": { description: "Test result", content: { "application/json": { schema: jsonSchema(okResult, "output") } } } },
    },
    (service, { params }) => service.testTailIntegration(params.integrationId),
  ),
  route(
    "GET",
    "/api/v1/providers/github/installations/{installationId}/repositories",
    "integrations:read",
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
    "integrations:read",
    {
      summary: "List GitHub issue event options",
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
    "integrations:write",
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
    "integrations:write",
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
  route("GET", "/api/v1/trigger-summaries", "triggers:read", {
    summary: "List bounded trigger summaries",
    description: "Additive bounded list representation. Omitted sort preserves immutable UUID descending; updated preserves updated time descending with UUID descending ties. active sorts triggers with live runs first, then name and UUID ascending; running sorts numeric live-run counts in direction with name and UUID ascending ties; title sorts name in direction with UUID ascending ties. Name ordering uses the PostgreSQL en-US ICU collation. Non-ID sorts return opaque cursors bound to their sort and direction; keep filters and sort unchanged between pages. Live run-count changes can move triggers between pages. Literal case-insensitive name/slug search. No prompts or event configuration; statistics are batched. Existing GET /triggers remains an array.",
    responses: { "200": { description: "Summary page", content: { "application/json": { schema: jsonSchema(triggerSummaryPage, "output") } } } },
  }, (service, { query }) => service.listTriggerSummaries(query), { query: triggerPageQuery }),
  route("GET", "/api/v1/trigger-selector", "triggers:read", {
    summary: "Search bounded lifecycle trigger options",
    responses: { "200": { description: "Selector page; same ordering/filter semantics as trigger-summaries", content: { "application/json": { schema: jsonSchema(triggerSelectorPage, "output") } } } },
  }, (service, { query }) => service.listTriggerSummaries(query, true), { query: triggerPageQuery }),
  route("GET", "/api/v1/triggers/graph", "triggers:read", { summary: "Get the team's workflow graph", responses: { "200": { description: "Team graph", content: { "application/json": { schema: jsonSchema(projectGraphResponse, "output") } } } } }, service => service.getTeamGraph()),
  route("GET", "/api/v1/team", "team:read", {
    summary: "Get the current team and its run defaults",
    responses: { "200": { description: "Team", content: { "application/json": { schema: jsonSchema(teamResponse, "output") } } } },
  }, service => service.getTeam()),
  route("PUT", "/api/v1/team/run-defaults", "team:write", {
    summary: "Replace the current team's run defaults",
    responses: { "200": { description: "Team run defaults", content: { "application/json": { schema: jsonSchema(teamRunDefaults, "output") } } } },
  }, (service, { body }) => service.setTeamRunDefaults(body), { body: teamRunDefaults, ownerSession: true }),
  route("GET", "/api/v1/skill-library/clone", "skills:read", { summary: "Read the readable HTTPS clone URL for the authoritative skills repository", responses: { "200": { description: "Clone URL and tracked folder; never credentials", content: { "application/json": { schema: jsonSchema(cloneInfo, "output") } } } } }, service => service.skillCloneInfo()),
  route("POST", "/api/v1/skill-library/git-token", "skills:write", { summary: "Issue a one-hour personal Git HTTPS password for the managed skills repository", description: "Interactive owner session required. The token is bound to this user, membership session version and repository. It cannot access GitHub mirrors or another team. Only its digest is stored. Use username git and the token as the password; never include it in the remote URL.", responses: { "200": { description: "One-hour Git credential", content: { "application/json": { schema: jsonSchema(gitCredential, "output") } } } } }, service => service.issueGitCredential(), { ownerSession: true }),
  route("GET", "/api/v1/skill-library", "skills:read", { summary: "Read skill repository settings", responses: { "200": { description: "Read skill repository settings", content: { "application/json": { schema: jsonSchema(libraryStatus, "output") } } } } }, (service) => service.skillLibraryStatus()),
  route("PUT", "/api/v1/skill-library", "skills:write", { summary: "Select the authoritative skills repository", responses: { "200": { description: "Select the authoritative skills repository", content: { "application/json": { schema: jsonSchema(libraryStatus, "output") } } } } }, (service,{body}) => service.configureSkillLibrary(body), {body:configureLibrary}),
  route("POST", "/api/v1/skill-library/token", "skills:write", { summary: "Issue a one-hour repository credential (read-only for GitHub mirrors)", responses: { "200": { description: "Issue a one-hour repository credential (read-only for GitHub mirrors)", content: { "application/json": { schema: jsonSchema(libraryToken, "output") } } } } }, (service) => service.skillLibraryToken()),
  route("POST", "/api/v1/skill-library/sync", "skills:write", { summary: "Synchronize the tracked branch", responses: { "200": { description: "Synchronize the tracked branch", content: { "application/json": { schema: jsonSchema(libraryStatus, "output") } } } } }, (service) => service.syncSkillLibrary()),
  route("GET", "/api/v1/skills/{skillId}/files", "skills:read", {summary:"Browse the published skill directory at its immutable revision",responses:{"200":{description:"Published files, with base64 encoded contents",content:{"application/json":{schema:jsonSchema(skillDirectoryResponse,"output")}}}}},(service,{params})=>service.getSkillDirectory(params.skillId),{parameters:z.object({skillId:z.uuid()})}),
  route("GET", "/api/v1/skills/{skillId}/trigger", ["skills:read","triggers:read"], {summary:"Read a skill's optional trigger",responses:{"200":{description:"Optional trigger",content:{"application/json":{schema:jsonSchema(skillTriggerResponse,"output")}}}}},(service,{params})=>service.getSkillTrigger(params.skillId),{parameters:z.object({skillId:z.uuid()})}),
  route("PUT", "/api/v1/skills/{skillId}/trigger", ["skills:write","triggers:write"], {summary:"Configure a skill's event sources and enabled state",responses:{"200":{description:"Saved trigger",content:{"application/json":{schema:jsonSchema(skillTriggerResponse,"output")}}}}},(service,{params,body})=>service.saveSkillTrigger(params.skillId,body),{parameters:z.object({skillId:z.uuid()}),body:skillTriggerInput,maxBodyBytes:1_000_000}),
  route("GET", "/api/v1/skills/{skillId}/settings", "skills:read", {summary:"Read effective defaults resolved from skill frontmatter and presets",responses:{"200":{description:"Skill settings",content:{"application/json":{schema:jsonSchema(skillSettings,"output")}}}}},(service,{params})=>service.getSkillSettings(params.skillId),{parameters:z.object({skillId:z.uuid()})}),
  route("PUT", "/api/v1/skills/{skillId}/settings", ["skills:write","triggers:write"], {summary:"Retired: update skill frontmatter and presets instead",deprecated:true,responses:{"410":{description:"Retired: edit SKILL.md frontmatter and team presets instead",content:{"application/json":{schema:{$ref:"#/components/schemas/Error"}}}},"200":{description:"Saved skill settings",content:{"application/json":{schema:jsonSchema(skillSettings,"output")}}}}},(service,{params,body})=>service.setSkillSettings(params.skillId,body),{parameters:z.object({skillId:z.uuid()}),body:skillSettingsInput,maxBodyBytes:300_000}),
  route("GET", "/api/v1/skills", "skills:read", { summary: "Search global skills", responses: { "200": { description: "Skills", content: { "application/json": { schema: jsonSchema(skillPage, "output") } } } } }, (service, { query }) => service.listSkills(query), { query: skillQuery }),
  route("POST", "/api/v1/skills", "skills:write", { summary: "Create a global skill", responses: { "201": { description: "Created", content: { "application/json": { schema: jsonSchema(skillResponse, "output") } } } } }, (service, { body }) => service.createSkill(body), { body: skillInput }),
  route("POST", "/api/v1/triggers/preview", "skills:read", { summary: "Preview one skill, a literal prompt and optional Event template", responses: { "200": { description: "Prompt preview", content: { "application/json": { schema: jsonSchema(previewPromptResponse, "output") } } } } }, (service, { body }) => service.previewTriggerPrompt(body), { body: previewSkillInput }),
  route("GET", "/api/v1/skills/{skillId}", "skills:read", { summary: "Get a global skill", responses: { "200": { description: "Skill", content: { "application/json": { schema: jsonSchema(skillResponse, "output") } } } } }, (service, { params }) => service.getSkill(params.skillId)),
  route("PUT", "/api/v1/skills/{skillId}", "skills:write", { summary: "Update a global skill", responses: { "200": { description: "Updated", content: { "application/json": { schema: jsonSchema(skillResponse, "output") } } } } }, (service, { params, body }) => service.updateSkill(params.skillId, body), { body: skillUpdateInput }),
  route("DELETE", "/api/v1/skills/{skillId}", "skills:write", { summary: "Delete an unused global skill", responses: { "200": { description: "Deleted" } } }, (service, { params, query }) => service.deleteSkill(params.skillId, query.expectedRevision), { query: z.object({ expectedRevision: z.coerce.number().int().positive() }) }),
  route("GET", "/api/v1/skills/{skillId}/triggers", "skills:read", { summary: "List triggers using a skill", responses: { "200": { description: "Triggers", content: { "application/json": { schema: jsonSchema(skillTriggersResponse, "output") } } } } }, (service, { params }) => service.listSkillTriggers(params.skillId)),
  route("POST", "/api/v1/vm-image-verifications", "triggers:write", { summary: "Verify a public VM image", description: "Starts a tenant-scoped background verification. It creates a temporary Factorize-owned VM, checks SSH and the selected harness prerequisites, then deletes the VM. It never executes a trigger prompt.", responses: { "200": { description: "Verification operation", content: { "application/json": { schema: jsonSchema(vmImageVerificationResponse, "output") } } } } }, (service, { body }) => service.startVmImageVerification(body), { body: vmImageVerificationInput }),
  route("GET", "/api/v1/vm-image-verifications/{verificationId}", "triggers:read", { summary: "Get VM image verification progress", responses: { "200": { description: "Verification operation", content: { "application/json": { schema: jsonSchema(vmImageVerificationResponse, "output") } } } } }, (service, { params }) => service.getVmImageVerification(params.verificationId)),
  route(
    "GET",
    "/api/v1/triggers",
    "triggers:read",
    {
      summary: "List triggers",
      responses: {
        "200": {
          description: "Triggers",
          content: {
            "application/json": {
              schema: jsonSchema(z.array(triggerResponse), "output"),
            },
          },
        },
      },
    },
    (service) => service.listTriggers(),
  ),
  route(
    "POST",
    "/api/v1/triggers",
    "triggers:write",
    { summary: "Create trigger", responses: { "201": { description: "Created", content: { "application/json": { schema: jsonSchema(triggerResponse, "output") } } } } },
    (service, { body }) => service.createTrigger(body),
    { body: triggerInputSchema },
  ),
  route(
    "POST",
    "/api/v1/trigger-conditions/test",
    "triggers:write",
    {
      summary: "Test webhook conditions",
      description: "Evaluates supplied prepared webhook context only; does not authenticate the example, route events, verify GitHub state, or invoke triggers.",
      responses: { "200": { description: "Decision", content: { "application/json": { schema: jsonSchema(z.object({ decision: z.enum(["match", "no-match", "error"]), error: z.string().optional(), details: z.array(z.record(z.string(), z.unknown())) }), "output") } } } },
    },
    (service, { body }) => service.testTriggerConditions(body),
    { body: triggerConditionsTestSchema, maxBodyBytes: 300_000 },
  ),
  route(
    "POST",
    "/api/v1/triggers/{triggerId}/invocations",
    "runs:invoke",
    {
      summary: "Invoke trigger",
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
            "queue_full \u2014 all execution slots are reserved or occupied and one waiting run already exists. Duplicate idempotency keys return the original run.",
        },
      },
    },
    (service, { params, body }) => service.invokeTrigger(params.triggerId, body),
    { body: manualInvocationSchema },
  ),
  route("GET", "/api/v1/runtime-launch", [], {
    summary: "Fetch this VM's immutable launch payload",
    description: "Requires the vendor-verified identity of an active run. Returns only that run's encrypted-at-rest scheduler snapshot, including the rendered prompt and harness or code context. No application scope is required. Sessions, API keys, OAuth clients, other runs and terminal runs cannot retrieve it. Responses are never cached.",
    responses: { "200": { description: "Launch payload for the calling run", content: { "application/json": { schema: jsonSchema(launchPayloadResponse, "output") } } } } },
  service => service.getRuntimeLaunchPayload(), { vendorIdentityOnly: true }),
  route("POST", "/api/v1/agent/vm-grants", "vm:grant+proxy:use", { summary: "Delegate selected proxy integrations to an exe.dev VM or Fly.io Machine", description: "Requires an OAuth agent with proxy:use, vm:grant and access to the provider and each selected integration. Fly.io requires app plus the Machine ID as vm; exe.dev uses the VM name. Lasts one hour; explicit renewal is required to extend access.", responses: { "200": { description: "Verified VM grant", content: { "application/json": { schema: jsonSchema(vmGrantReceipt, "output") } } } } }, (service,{body}) => service.grantVm(body), {body: grantVmInput}),
  route("POST", "/api/v1/agent/vm-grants/{grantId}/renew", "vm:grant+proxy:use", {summary:"Renew an active VM proxy grant for one hour",description:"Only the same active OAuth authorization may renew. Rechecks provider and all selected integration grants; expired or revoked VM grants require a new grant. OAuth token refresh alone does not renew VM access.",responses:{"200":{description:"Renewed lease",content:{"application/json":{schema:jsonSchema(vmGrantRenewal,"output")}}}}},(service,{params})=>service.renewVmGrant(params.grantId!),{parameters:z.object({grantId:z.uuid()})}),
  route("DELETE", "/api/v1/agent/vm-grants/{grantId}", "vm:grant", { summary: "Revoke an external VM grant", description: "Only the issuing OAuth grant can revoke. Access stops before provider cleanup.", responses: { "200": { description: "Revoked grant", content: { "application/json": { schema: jsonSchema(z.object({grantId:z.uuid(),revoked:z.boolean()}), "output") } } } } }, (service,{params}) => service.revokeVmGrant(params.grantId!), {parameters:z.object({grantId:z.uuid()})}),
  route("POST","/api/v1/media/uploads",[],{summary:"Reserve an immutable image upload for Pi",responses:{"201":{description:"Idempotent upload receipt",content:{"application/json":{schema:jsonSchema(mediaReceipt,"output")}}}}},(service,{body})=>service.createMediaUpload(body),{body:mediaUploadInput,maxBodyBytes:8192}),
  route("PUT","/api/v1/media/{artifactId}",[],{summary:"Stream unchanged image bytes to a reserved upload",description:"Content-Type must match the reserved mediaType. Maximum upload size is 32 MiB; Pi turns accept at most 16 MiB of decoded media. Uploads are immutable and checksum verified.",requestBody:{required:true,content:{"application/octet-stream":{schema:{type:"string",format:"binary"}}}},responses:{"200":{description:"Verified media receipt",content:{"application/json":{schema:jsonSchema(mediaReceipt,"output")}}}}},(service,{params,request})=>service.uploadMedia(params.artifactId,request!),{rawBody:true,parameters:z.object({artifactId:z.uuid()})}),
  route("GET","/api/v1/media/{artifactId}",[],{summary:"Read authorized run input or scratch media",responses:{"200":{description:"Original media bytes",content:{"application/octet-stream":{schema:{type:"string",format:"binary"}}}}}},(service,{params})=>service.downloadMedia(params.artifactId),{parameters:z.object({artifactId:z.uuid()})}),
  route("POST","/api/v1/media/fetch",[],{summary:"Capture an image from an authorized integration API",responses:{"201":{description:"Media receipt",content:{"application/json":{schema:jsonSchema(mediaReceipt,"output")}}}}},(service,{body,signal})=>service.fetchMedia(body,signal),{body:fetchMediaInput,maxBodyBytes:16384}),
  route("POST","/api/v1/runtime/vm/exec",[],{summary:"Execute a command in this active run's verified workspace VM",responses:{"200":{description:"Command output and exit status",content:{"application/json":{schema:jsonSchema(vmExecResult,"output")}}}}},(service,{body,signal})=>service.vmExec(body,signal),{body:vmExecInput,scope:[]}),
  route("GET", "/api/v1/agent/reflection", [], { summary: "Discover agent identity and granted or requestable integration APIs", description: "OAuth authorization or verified active run required. Availability reports connection state, without probing credential health. OAuth integration scopes are integration:{stable UUID}:{revocation epoch}; initial login need not request any integration scopes.", responses: { "200": { description: "Agent reflection", content: { "application/json": { schema: jsonSchema(apiReflection, "output") } } } } }, service => service.getApiReflection(), {scope: []}),
  route("POST", "/api/v1/agent/requests", [], { summary: "Make an authorized credential-injected API request", description: "OAuth requires proxy:use. An external VM sends its short-lived provider OIDC bearer token, X-Factorize-VM-Grant and X-Factorize-VM-Proof. Only server-selected origins are used. Integration-wide grants are bounded by upstream credential permissions. Missing requestable access returns HTTP 403 with WWW-Authenticate insufficient_scope, scope and resource_metadata. Upstream status is returned in the result, including non-2xx. Text is UTF-8; other bodies are base64. Responses above 32 KiB are retained for 30 minutes and read in chunks. Revocation prevents subsequent calls and reads, but cannot undo upstream side effects.", responses: { "200": { description: "Upstream response or retained response handle", content: { "application/json": { schema: jsonSchema(requestApiResponse, "output") } } } } }, (service,{body,signal}) => service.requestApi(body,signal), {body: requestApiInput, maxBodyBytes: 45_000_000, scope: []}),
  route("GET","/api/v1/runs/{runId}/telemetry","runs:read",{summary:"Read paginated run spans and live usage/cost totals",description:"Local telemetry remains available without Phoenix. Model input counts include cached tokens; reasoning is a subset of output. Unreported usage and unknown pricing remain unavailable. Wall time comes from the root span and does not sum overlapping child durations.",responses:{"200":{description:"Telemetry page",content:{"application/json":{schema:jsonSchema(telemetryPage,"output")}}}}},(service,{params,query})=>service.getRunTelemetry(params.runId,query),{parameters:z.object({runId:z.uuid()}),query:telemetryPageQuery}),
  route("GET","/api/v1/runs/{runId}/telemetry/{spanId}","runs:read",{summary:"Read a bounded chunk of span input/output and its pricing snapshot",responses:{"200":{description:"At most 2048 characters of encrypted-at-rest content",content:{"application/json":{schema:jsonSchema(telemetryContent,"output")}}}}},(service,{params,query})=>service.getRunTelemetryContent(params.runId,params.spanId,query),{parameters:z.object({runId:z.uuid(),spanId:z.string().regex(/^[a-f0-9]{16}$/)}),query:telemetryContentQuery}),
  route("GET","/api/v1/integrations/phoenix","integrations:read",{summary:"Inspect credential-safe team Phoenix settings",responses:{"200":{description:"Phoenix configuration",content:{"application/json":{schema:jsonSchema(phoenixConfig,"output")}}}}},service=>service.getPhoenix(),{ownerSession:true}),
  route("PUT","/api/v1/integrations/phoenix","integrations:write",{summary:"Configure automatic new-run telemetry export to Phoenix Cloud",description:"Requires an owner session and expectedRevision. API key is encrypted and never returned. Omit it to retain the existing key. Disabling cancels pending exports. Destination changes apply only to newly created runs; no historical backfill.",responses:{"200":{description:"Saved configuration",content:{"application/json":{schema:jsonSchema(phoenixConfig,"output")}}}}},(service,{body})=>service.putPhoenix(body),{body:phoenixInput,ownerSession:true}),
  route("DELETE","/api/v1/integrations/phoenix","integrations:write",{summary:"Disconnect Phoenix and cancel pending exports",responses:{"200":{description:"Disconnected configuration",content:{"application/json":{schema:jsonSchema(phoenixConfig,"output")}}}}},(service,{body})=>service.deletePhoenix(body),{body:phoenixRevision,ownerSession:true}),
  route("POST","/api/v1/integrations/phoenix/test","integrations:write",{summary:"Test Phoenix authentication and destination project lookup",responses:{"200":{description:"Connection result without credentials",content:{"application/json":{schema:jsonSchema(phoenixTest,"output")}}}}},service=>service.testPhoenix(),{ownerSession:true}),
  route("GET","/api/v1/model-pricing","integrations:read",{summary:"Read versioned catalog provenance and team model price overrides",responses:{"200":{description:"Pricing settings",content:{"application/json":{schema:jsonSchema(pricingList,"output")}}}}},service=>service.getModelPricing()),
  route("PUT","/api/v1/model-pricing","integrations:write",{summary:"Set per-integration/model USD prices per million tokens",description:"Requires an interactive owner session and expectedRevision. Set rates null to revert to the catalog. Historical estimates retain their original pricing snapshot.",responses:{"200":{description:"Saved override revision",content:{"application/json":{schema:jsonSchema(pricingOverrideReceipt,"output")}}}}},(service,{body})=>service.setModelPricing(body),{body:pricingOverrideInput,ownerSession:true}),
  route("POST","/api/v1/proxy-payloads",[],{summary:"Reserve a temporary connection/run-bound request body",responses:{"200":{description:"Upload/staging receipt",content:{"application/json":{schema:jsonSchema(payloadReceipt,"output")}}}}},(service,{body})=>service.createProxyPayload(body),{body:createPayloadInput}),
  route("GET","/api/v1/proxy-payloads/{handle}",[],{summary:"Inspect an authorized temporary upload",responses:{"200":{description:"Payload receipt",content:{"application/json":{schema:jsonSchema(payloadReceipt,"output")}}}}},(service,{params})=>service.getProxyPayload(params.handle),{parameters:z.object({handle:z.uuid()})}),
  route("PUT","/api/v1/proxy-payloads/{handle}/bytes",[],{summary:"Stream a generic file into an authorized payload",description:"An authenticated owner browser can upload for its originating OAuth connection. Immutable finalized bytes; fixed 32 MiB limit. No run is required.",requestBody:{required:true,content:{"application/octet-stream":{schema:{type:"string",format:"binary"}}}},responses:{"200":{description:"Finalized payload receipt",content:{"application/json":{schema:jsonSchema(payloadReceipt,"output")}}}}},(service,{params,request})=>service.uploadProxyPayload(params.handle,request!),{rawBody:true,parameters:z.object({handle:z.uuid()})}),
  route("POST","/api/v1/proxy-payloads/append",[],{summary:"Append a bounded idempotent payload chunk",responses:{"200":{description:"Payload progress",content:{"application/json":{schema:jsonSchema(payloadReceipt,"output")}}}}},(service,{body})=>service.appendProxyPayload(body),{body:appendPayloadInput,maxBodyBytes:60000}),
  route("POST","/api/v1/proxy-payloads/finalize",[],{summary:"Finalize and checksum a staged body",responses:{"200":{description:"Immutable payload receipt",content:{"application/json":{schema:jsonSchema(payloadReceipt,"output")}}}}},(service,{body})=>service.finalizeProxyPayload(body),{body:finalizePayloadInput}),
  route("POST","/api/v1/proxy-payloads/attachment",[],{summary:"Import a native ChatGPT attachment",description:"Accepts documented OpenAI file parameters. Temporary signed URLs are never returned; imports require trusted public HTTPS file origins and disallow redirects.",responses:{"200":{description:"Imported file handle",content:{"application/json":{schema:jsonSchema(payloadReceipt,"output")}}}}},(service,{body})=>service.importProxyAttachment(body),{body:attachmentInput,maxBodyBytes:16384}),
  route("POST","/api/v1/agent/operations",[],{summary:"Start an identity-bound durable HTTP operation",description:"Fixed 32 MiB request, 64 MiB response and 15 minute upstream limits. An idempotencyKey safely reuses an accepted operation; interrupted dispatch is never automatically replayed. Poll/read/cancel using the operation ID.",responses:{"200":{description:"Durable operation state",content:{"application/json":{schema:jsonSchema(operationReceipt,"output")}}}}},(service,{body})=>service.startApiOperation(body),{body:requestApiInput,maxBodyBytes:45000000,scope:[]}),
  route("POST","/api/v1/agent/operations/status",[],{summary:"Poll an authorized HTTP operation",responses:{"200":{description:"Operation state",content:{"application/json":{schema:jsonSchema(operationReceipt,"output")}}}}},(service,{body})=>service.getApiOperation(body),{body:operationRef,scope:[]}),
  route("POST","/api/v1/agent/operations/cancel",[],{summary:"Cancel an authorized HTTP operation",responses:{"200":{description:"Cancellation state",content:{"application/json":{schema:jsonSchema(operationReceipt,"output")}}}}},(service,{body})=>service.cancelApiOperation(body),{body:operationRef,scope:[]}),
  route("POST","/api/v1/agent/operations/read",[],{summary:"Read bounded incremental operation bytes",responses:{"200":{description:"Partial or completed byte range",content:{"application/json":{schema:jsonSchema(z.object({operationId:z.uuid(),offset:z.number().int(),nextOffset:z.number().int(),body:z.string(),encoding:z.literal("base64"),size:z.number().int(),state:z.string(),done:z.boolean()}),"output")}}}}},(service,{body})=>service.readApiOperation(body),{body:operationRead,scope:[]}),
  route("POST","/api/v1/agent/responses/query",[],{summary:"Query bounded retained JSON, text lines or binary byte ranges",description:"Rechecks proxy authorization and identity/tenant/integration expiry. JSON/text parsing is limited to 1 MiB; larger bodies remain available through byte ranges. JMESPath functions, root references and constructors are excluded to bound intermediate allocations.",responses:{"200":{description:"Bounded selected data",content:{"application/json":{schema:jsonSchema(queryApiResponseResult,"output")}}}}},(service,{body})=>service.queryApiResponse(body),{body:queryApiResponseInput,scope:[]}),
  route("POST", "/api/v1/agent/responses/read", [], { summary: "Read up to 64 KiB of an identity-bound retained response", description: "Accepts the same OAuth, run or external VM authentication as the request endpoint. Rechecks authorization, integration revocation epoch, tenant, identity and 30-minute expiry. Chunks are always base64 so arbitrary byte offsets are safe.", responses: { "200": { description: "Response chunk", content: { "application/json": { schema: jsonSchema(apiResponseChunk, "output") } } } } }, (service,{body}) => service.readApiResponse(body), {body: readApiResponseInput, scope: []}),
  route("GET", "/api/v1/integration-api-policies", "integrations:read", { summary: "List tenant MCP API access policies", responses: { "200": { description: "Policies", content: { "application/json": { schema: jsonSchema(apiPolicyList, "output") } } } } }, service => service.listApiPolicies(), {ownerSession: true}),
  route("PUT", "/api/v1/integration-api-policies/{integrationId}", "integrations:write", { summary: "Set baseline, requestable or disabled MCP access", description: "Baseline changes apply immediately. Disabling invalidates approvals permanently; re-enabling requires fresh consent. Run selections remain independent.", responses: { "200": { description: "Updated policies", content: { "application/json": { schema: jsonSchema(apiPolicyList, "output") } } } } }, (service,{params,body}) => service.updateApiPolicy(params.integrationId,body), {ownerSession: true, body: apiPolicyInput}),
  route("GET", "/api/v1/runtime-context", [], {
    summary: "Inspect the current runtime identity and scopes",
    description: "Returns the verified calling identity and effective scopes without credentials. Requires a verified active identity but no application-resource scope; callers with zero scopes can inspect only their own identity. Execution provisioning uses this operation to verify the dedicated run proxy. Execution VMs must not have additional shared Factorize proxy attachments.",
    responses: { "200": { description: "Verified runtime identity", content: { "application/json": { schema: jsonSchema(runtimeContextResponse, "output") } } } } },
  service => service.getRuntimeContext()),
  route("GET", "/api/v1/runtime-integrations", [], { summary: "Discover this run's selected integration endpoints", description: "Requires vendor-verified run identity. Returns only snapshotted selections, safe connection metadata, X OAuth scopes, and current availability, without origins or credentials. X connections use /x/{connectionId}/ for supported API v2 resources; each resource is checked against selected and granted OAuth scopes. Selection authorization is independent of the run's Factorize API scopes.", responses: { "200": { description: "Selected run integrations", content: { "application/json": { schema: jsonSchema(runtimeIntegrationsResponse, "output") } } } } }, service => service.getRuntimeIntegrations()),
  route("GET", "/api/v1/triggers/{triggerId}/invocation-permissions", "triggers:read", { summary: "List a source trigger's manual invocation destinations", responses: { "200": { description: "Configured destination triggers in the same project", content: { "application/json": { schema: jsonSchema(invocationPermissionsResponse, "output") } } } } }, (service, { params }) => service.getInvocationPermissions(params.triggerId)),
  route("PUT", "/api/v1/triggers/{triggerId}/invocation-permissions", "triggers:write", { summary: "Replace a source trigger's manual invocation destinations", description: "Requires an owner session, scoped API key, or authorized OAuth client with triggers:write. Destinations must belong to the source trigger's project; self-invocation is allowed. A run token may invoke a configured destination only while both triggers remain in the same project. Lifecycle subscriptions do not create permissions.", responses: { "410": {description:"Skill-backed triggers use permission presets; update that preset instead",content:{"application/json":{schema:{$ref:"#/components/schemas/Error"}}}}, "200": { description: "Saved manual invocation permissions", content: { "application/json": { schema: jsonSchema(invocationPermissionsResponse, "output") } } } } }, (service, { params, body }) => service.setInvocationPermissions(params.triggerId, body.destinationTriggerIds), { body: invocationPermissionsInput }),
  route(
    "GET",
    "/api/v1/triggers/{triggerId}/events",
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
      service.listTriggerEvents(params.triggerId, query.limit),
    { query: eventQuery },
  ),
  route(
    "POST",
    "/api/v1/triggers/{triggerId}/enable",
    "triggers:write",
    { summary: "Enable trigger", responses: { "200": { description: "Enabled" } } },
    (service, { params }) => service.setTriggerEnabled(params.triggerId, true),
  ),
  route(
    "POST",
    "/api/v1/triggers/{triggerId}/disable",
    "triggers:write",
    {
      summary: "Disable trigger",
      responses: { "200": { description: "Disabled" } },
    },
    (service, { params }) => service.setTriggerEnabled(params.triggerId, false),
  ),
  route(
    "GET",
    "/api/v1/triggers/{triggerId}",
    "triggers:read",
    { summary: "Get trigger", responses: { "200": { description: "Trigger", content: { "application/json": { schema: jsonSchema(triggerResponse, "output") } } } } },
    (service, { params }) => service.getTrigger(params.triggerId),
  ),
  route(
    "PUT",
    "/api/v1/triggers/{triggerId}",
    "triggers:write",
    {
      summary: "Replace trigger",
      description: "Supply expectedUpdatedAt from GET for atomic optimistic concurrency. Stale edits return 409 stale_trigger. Omission uses last-writer-wins updates. Event identity is preserved.",
      responses: { "200": { description: "Updated", content: { "application/json": { schema: jsonSchema(triggerResponse, "output") } } }, "409": { description: "stale_trigger: reload and reconcile before retrying" } },
    },
    (service, { params, body }) => service.updateTrigger(params.triggerId, body),
    { body: triggerUpdateInput },
  ),
  route(
    "DELETE",
    "/api/v1/triggers/{triggerId}",
    "triggers:write",
    { summary: "Delete trigger", responses: { "200": { description: "Deleted" } } },
    (service, { params }) => service.deleteTrigger(params.triggerId),
  ),
  route("POST","/api/v1/runs","runs:start",{
    summary:"Start a Team run from an optional skill and prompt, or a script",
    description:"Supply a skill, a prompt, or images for an agent run. Script-based runs are retired. Skill frontmatter selects VM, permission and model presets; omitted selections inherit team defaults. Resolved preset revisions and the skill commit are snapshotted before queueing. Default scopes, integrations and invocation destinations are bounded by the caller's effective access. Explicit unauthorized permissions fail. Explicit empty selections grant none.",
    responses:{"202":{description:"Accepted run",content:{"application/json":{schema:jsonSchema(startRunReceipt,"output")}}}},
  },(service,{body})=>service.startRun(body),{body:startRunInput,maxBodyBytes:256_000}),
  route(
    "GET",
    "/api/v1/runs",
    "runs:read",
    {
      summary: "List runs",
      description: "Returns tenant-authorized runs. Trigger and state filters accept repeated values and match any selected value within each filter; filters are applied before cursor pagination. When sort is supplied, ordering is applied before cursor pagination; statuses sort lexically by their persisted state, missing values sort last, and ties use run ID. Without sort, queued, reserved, and starting runs come first, running runs second, and all other states last; each group is ordered by creation time descending, then run ID descending. The opaque default cursor includes the priority group and creation time. Legacy two-field cursors resume at their original chronological boundary. Run states can change between requests and move rows across groups; restart pagination from the first page after observing a state transition if a gap-free live view is needed.",
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
    "skills:read+runs:read",
    {
      summary: "Search skill names and run names",
      description: "Search skill names and run names only, using case-insensitive substring and PostgreSQL pg_trgm word matching. Exact names rank first, then prefixes, then other matches by similarity with deterministic ties. Results are tenant-scoped and limited to 100. Triggers, descriptions, instruction bodies, issue fields and trace content are excluded. Blank or punctuation-only queries return no results.",
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
  route("GET", "/api/v1/vms", "runs:read", {
    summary: "List VMs with active Factorize proxy access",
    description: "Requires an interactive owner session. Reports access status from Factorize records.",
    responses: { "200": { description: "Active VM access attachments", content: { "application/json": { schema: jsonSchema(vmAttachments, "output") } } } },
  }, service => service.listProxyVms()),
  route("GET", "/api/v1/runs/{runId}/vms", "runs:read", {
    summary: "List a run's current and historical VM access",
    responses: { "200": { description: "Run VM attachments", content: { "application/json": { schema: jsonSchema(vmAttachments, "output") } } } },
  }, (service, { params }) => service.listRunVms(params.runId), { parameters: z.object({ runId: z.guid() }) }),
  route("GET", "/api/v1/access/authorizations/{grantId}/vms", "runs:read", {
    summary: "List current and historical VM access delegated by an MCP connection",
    description: "Requires an interactive owner session.",
    responses: { "200": { description: "Connection VM attachments", content: { "application/json": { schema: jsonSchema(vmAttachments, "output") } } } },
  }, (service, { params }) => service.listClientVms(params.grantId), { parameters: z.object({ grantId: z.string().min(1).max(255) }) }),
  route("GET", "/api/v1/runs/{runId}/status", "runs:read", {
    summary: "Get lightweight run status",
    description: "Only bounded encrypted prompt/script previews are decrypted; full prompt, invocation context, artifacts, activity and diagnostics stay in the detail operation. Continue polling terminal runs while finalizing is true. trace_revision changes on generation transition or canonical projection/replay; live appends retain the revision. Full detail remains available at GET /runs/{runId}.",
    responses: { "200": { description: "Status", content: { "application/json": { schema: jsonSchema(runStatusResponse, "output") } } } },
  }, (service, { params }) => service.getRunStatus(params.runId), { parameters: z.object({ runId: z.guid() }) }),
  route("GET", "/api/v1/runs/{runId}/artifacts/{artifactId}", "runs:read", {
    summary: "Download a retained run artifact",
    responses: { "200": { description: "Authorized artifact bytes", content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } } } },
  }, (service, { params }) => service.downloadRunArtifact(params.runId, params.artifactId), { parameters: z.object({ runId: z.guid(), artifactId: z.guid() }) }),
  route("GET", "/api/v1/runs/{runId}/trace-pages", "runs:read", {
    summary: "Get revision-bound trace page",
    description: "First request omits revision and uses after=0. Subsequent requests supply the returned revision. A changed generation or canonical projection returns reset=true and events from zero in the new revision, from one database snapshot. Discard all cached old pages before merging the response. nextCursor=null means caught up, not finalized; poll after the last sequence while active/finalizing. The full trace endpoint provides its complete representation.",
    responses: { "200": { description: "Revision-bound page", content: { "application/json": { schema: jsonSchema(revisionTracePage, "output") } } } },
  }, (service, { params, query }) => query.before !== undefined || query.recent ? service.getRevisionTrace(params.runId, query.after, query.limit, query.revision, query.before, query.recent) : service.getRevisionTrace(params.runId, query.after, query.limit, query.revision), { query: revisionTraceQuery, parameters: z.object({ runId: z.guid() }) }),
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
  route("PATCH", "/api/v1/runs/{runId}", "runs:write", {
    summary: "Rename run",
    description: "Changes only the run display name. Supply expectedName for optimistic concurrency; omission supports last-writer-wins clients.",
    responses: { "200": { description: "Saved run display name", content: { "application/json": { schema: { type: "object", required: ["run_name"], properties: { run_name: { type: "string" } }, additionalProperties: false } } } }, "404": { description: "Run not found within the tenant" }, "409": { description: "stale_run_name: reload before retrying" } },
  }, (service, { params, body }) => service.renameRun(params.runId, body), { body: renameRunSchema, parameters: z.object({ runId: z.uuid() }) }),
  route("POST", "/api/v1/runs/{runId}/report-error", "runs:write", {
    summary: "Report an error for an active run",
    description: "Records a sanitized reason and authenticated reporter without changing run execution or releasing its concurrency slot. The agent may continue work and should then exit normally. An identical retry succeeds; a different replacement reason returns 409. Terminal runs reject reports.",
    responses: {
      "200": { description: "Report saved or identical retry acknowledged", content: { "application/json": { schema: jsonSchema(reportRunErrorResponse, "output") } } },
      "400": { description: "Invalid reason or request body" },
      "403": { description: "Missing runs:write authorization" },
      "404": { description: "Run not found within the tenant" },
      "409": { description: "Run is terminal or a different reason was already reported" },
    },
  }, (service, { params, body }) => service.reportRunError(params.runId, body), { body: reportRunErrorSchema, maxBodyBytes: 4096, parameters: z.object({ runId: z.uuid() }) }),
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
    "runs:cancel",
    {
      summary:
        "Replay a retained trace artifact or restore a native-session projection",
      description:
        "Requires runs:cancel and an interactive tenant owner session. One terminal run per request, limited to 10 attempts per tenant per minute including retries and failures. Projection and result commit atomically; no artifacts are deleted. Retry failed requests with the same requestId. Conflicting reuse is rejected. Missing bytes cannot be recovered. Does not change the source declaration of an active or future run.",
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
          description: "Missing runs:cancel scope or interactive owner session",
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
    "runs:cancel",
    { summary: "Stop run", responses: { "200": { description: "Stopped" } } },
    (service, { params }) => service.stopRun(params.runId),
  ),
  route("POST", "/api/v1/runs/{runId}/retry-launch", "runs:cancel", {
    summary: "Manually retry a blocked launch",
    description: "Retries a blocked launch with its original immutable credential and API scope snapshot. Trigger edits affect future runs; revoked/deleted selections require trigger repair and a new run. An interactive owner must request this retry.",
    responses: {
      "200": { description: "Manual retry queued", content: { "application/json": { schema: { type: "object", required: ["runId", "retryRequested"], properties: { runId: { type: "string", format: "uuid" }, retryRequested: { type: "boolean", const: true } }, additionalProperties: false } } } },
      "403": { description: "Interactive owner session required" },
      "409": { description: "Run is not waiting for a manual launch retry" },
    },
  }, (service, { params }) => service.retryBlockedLaunch(params.runId), { ownerSession: true, parameters: z.object({ runId: z.uuid() }) }),
  route(
    "POST",
    "/api/v1/runs/{runId}/kill",
    "runs:cancel",
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
  errorResponses.Error410={description:"Operation retired; use skill frontmatter and team presets",content:errorContent};
  const namedBodies: Record<string, z.ZodType> = {
    TriggerInput: triggerInputSchema,
    ManualInvocation: manualInvocationSchema,
    TriggerConditionsTest: triggerConditionsTestSchema,
    TraceReplayRequest: traceReplaySchema,
  };
  const schemas = {
    ...document.components.schemas,
    Run: { ...jsonSchema(runSummaryResponse, "output"), additionalProperties: true },
    RunPage: jsonSchema(runPageResponse, "output"),
    RunDetail: jsonSchema(fullRunResponse, "output"),
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
        route.authOperation || (Array.isArray(route.scope) && route.scope.length === 0) ? undefined : `Requires the ${Array.isArray(route.scope) ? route.scope.join(" and ") : route.scope.replaceAll("+", " and ")} scope${Array.isArray(route.scope) || route.scope.includes("+") ? "s" : ""}.`,
        route.vendorIdentityOnly ? "Requires vendor-verified run identity; sessions and other bearer tokens cannot call this operation." : route.authOperation ? undefined : route.ownerSession
          ? "An interactive owner session is required; bearer tokens cannot call this operation."
          : "Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.",
      ]
        .filter(Boolean)
        .join("\n\n"),
      operationId: `${route.method.toLowerCase()}_${route.path.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "")}`,
      tags: [route.path.split("/")[3]],
      security: ["/api/v1/agent/requests","/api/v1/agent/responses/read"].includes(route.path) ? [{bearerAuth:[]}, {vendorRunIdentity:[],runIdentityHeader:[]}, {vmWif:[],vmGrantHeader:[],vmProofHeader:[]}] : route.vendorIdentityOnly ? [{ vendorRunIdentity: [], runIdentityHeader: [] }] : route.authOperation ? (route.ownerSession ? [{ cookieAuth: [] }] : []) : route.ownerSession ? [{ cookieAuth: [] }] : [{ bearerAuth: [] }, { vendorRunIdentity: [], runIdentityHeader: [] }, { cookieAuth: [] }],
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
    components: { ...document.components, securitySchemes: { ...document.components.securitySchemes, vmWif: {type:"http",scheme:"bearer",bearerFormat:"JWT"}, vmGrantHeader:{type:"apiKey",in:"header",name:"X-Factorize-VM-Grant"}, vmProofHeader:{type:"apiKey",in:"header",name:"X-Factorize-VM-Proof"}, cookieAuth: { type: "apiKey", in: "cookie", name: "factorize_session" }, vendorRunIdentity: { type: "http", scheme: "bearer", bearerFormat: "JWT", description: "Fresh vendor-signed exe.dev WIF or Fly Machine OIDC token matching the provisioned active run. Must be combined with X-Factorize-Run-Id; a vendor token alone grants no access." }, runIdentityHeader: { type: "apiKey", in: "header", name: "X-Factorize-Run-Id", description: "Provisioned run UUID. Used only to locate the immutable vendor/VM binding; this header is not a credential. Scopes and tenant come from the server-side run snapshot." } }, schemas, responses: errorResponses },
    paths,
  };
}
