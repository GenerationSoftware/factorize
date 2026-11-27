import { awsRoutes } from "./aws-rest";
import { hetznerSshRoutes } from "./hetzner-ssh-rest";
import { hetznerConnectionInput, hetznerConnectionMetadata, hetznerInventory } from "./hetzner-contracts";
import { integrationRemovalConfirmation, integrationRemovalPreview, integrationRemovalTarget } from "../../integrations/api/integration-removal-contracts";

import { cloudflareStartResult, cloudflareStatus } from "../../integrations/providers/cloudflare-oauth";

import { exeConnection, integrationStatus, savedExe, savedAmp } from "./connection-contracts";
import { accessToken } from "../../access-control/api/access-contracts";
import { okResult } from "../../transport/rest/result-contracts";
import { namedOption, providerOptions, githubInstallation, githubRepository, tailIntegration } from "../../integrations/api/editor-contracts";

import { z } from "zod";

import { X_OAUTH_SCOPES } from "../../integrations/providers/x-oauth";

import { flyConnectionInput, flyConnectionMetadata } from "../../integrations/providers/fly-account-client";

import { route, jsonSchema, type RouteContract } from "../../transport/rest/route-contract";

const exeBody = z.object({
  connectionId: z.string().min(1).optional(),
  apiToken: z.string().min(1).meta({ writeOnly: true }).optional(),
  tags: z
    .array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/))
    .max(20)
    .optional(),
}).strict();
const ampBody = z.object({
  connectionId: z.string().min(1).optional(),
  accessToken: z.string().min(1).meta({ writeOnly: true }).optional(),
  project: z.string().min(1).optional(),
  apiBaseUrl: z.url().optional(),
});
const clickUpQuery = z.object({ listId: z.string().default("") });
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
export const integrationRoutes = [
  ...hetznerSshRoutes,
  ...awsRoutes,
  route("POST", "/api/v1/integrations/removal/preview", "integrations:write", {
    summary: "Preview what deleting one installed integration affects",
    responses: { "200": { description: "Exact references and an impact fingerprint", content: { "application/json": { schema: jsonSchema(integrationRemovalPreview, "output") } } } },
  }, (service, {body}) => service.integrations.previewIntegrationRemoval(body), { ownerSession:true, body:integrationRemovalTarget }),
  route("POST", "/api/v1/integrations/removal/confirm", "integrations:write", {
    summary: "Delete one installed integration with verified impact",
    description: "The owner must explicitly confirm affected references. An outdated impact fingerprint returns 409 without any change.",
    responses: { "200": { description: "Deleted", content: { "application/json": { schema: jsonSchema(z.object({deleted:z.literal(true)}), "output") } } } },
  }, (service, {body}) => service.integrations.confirmIntegrationRemoval(body), { ownerSession:true, body:integrationRemovalConfirmation }),
  route("GET", "/api/v1/integrations/cloudflare", "integrations:read", {
    summary: "Read Cloudflare connections",
    responses: { "200": { description: "Cloudflare OAuth metadata", content: { "application/json": { schema: jsonSchema(cloudflareStatus, "output") } } } },
  }, service => service.integrations.cloudflareState(), { ownerSession: true }),
  route("POST", "/api/v1/integrations/cloudflare/authorize", "integrations:write", {
    summary: "Start authorization on Cloudflare",
    responses: { "200": { description: "Cloudflare authorization URL", content: { "application/json": { schema: jsonSchema(cloudflareStartResult, "output") } } } },
  }, async service => {
    const started = await service.integrations.startCloudflare();
    return Response.json({ authorizationUrl: started.authorizationUrl }, { headers: { "Set-Cookie": started.cookie } });
  }, { ownerSession: true }),
  route("DELETE", "/api/v1/integrations/cloudflare/{connectionId}", "integrations:write", {
    summary: "Delete a Cloudflare connection from this workspace",
    responses: { "200": { description: "Cloudflare connection deleted", content: { "application/json": { schema: jsonSchema(okResult, "output") } } } },
  }, (service, { params }) => service.integrations.disconnectCloudflare(params.connectionId), { ownerSession: true, parameters: z.object({ connectionId: z.uuid() }) }),
  route("GET", "/api/v1/x/connections", "integrations:read", {
    summary: "List X connections",
    description: "Requires an interactive owner session. Returns named connection metadata, account identity, selected/granted scopes, and status. Client secrets and OAuth tokens are never returned.",
    responses: { "200": { description: "X connection metadata", content: { "application/json": { schema: jsonSchema(xConnectionList, "output") } } } },
  }, service => service.integrations.listXConnections(), { ownerSession: true }),
  route("POST", "/api/v1/x/connections", "integrations:write", {
    summary: "Add a user-owned X app connection",
    description: "Requires an interactive owner session. Stores the X OAuth client secret in Factorize-managed encrypted storage and never returns it. Selected scopes are validated before saving.",
    responses: { "201": { description: "X connection created", content: { "application/json": { schema: jsonSchema(xConnectionMetadata, "output") } } } },
  }, (service, { body }) => service.integrations.createXConnection(body), { body: xConnectionCreate, maxBodyBytes: 8192, ownerSession: true }),
  route("DELETE", "/api/v1/x/connections/{connectionId}", "integrations:write", {
    summary: "Delete an X connection",
    description: "Requires an interactive owner session. Immediately clears the encrypted credential and revokes the connection. A secret-free tombstone prevents revoked access from being revived if an identifier is reused.",
    responses: { "200": { description: "X connection deleted", content: { "application/json": { schema: jsonSchema(z.object({ id: z.uuid(), deleted: z.literal(true) }), "output") } } } },
  }, (service, { params }) => service.integrations.deleteXConnection(params.connectionId), { ownerSession: true, parameters: z.object({ connectionId: z.uuid() }) }),
  route("POST", "/api/v1/x/connections/{connectionId}/authorize", "integrations:write", {
    summary: "Start X OAuth authorization",
    description: "Requires an interactive owner session. Starts a short-lived PKCE authorization bound to this owner, tenant, session, connection, and selected scopes. The one-time state is set in an HttpOnly cookie.",
    responses: { "200": { description: "X authorization URL", content: { "application/json": { schema: jsonSchema(xAuthorizationStart, "output") } } } },
  }, async (service, { params }) => {
    const started = await service.integrations.authorizeXConnection(params.connectionId);
    return Response.json({ authorizationUrl: started.authorizationUrl }, { headers: { "Set-Cookie": `factorize_x_oauth_state=${started.stateCookie}; HttpOnly; Secure; SameSite=Lax; Path=/oauth/x/callback; Max-Age=600` } });
  }, { body: z.object({}).strict(), maxBodyBytes: 1024, ownerSession: true, parameters: z.object({ connectionId: z.uuid() }) }),
  route("POST", "/api/v1/x/connections/{connectionId}/test", "integrations:read", {
    summary: "Test an X connection",
    description: "Requires an interactive owner session. Performs a non-mutating GET to X /2/users/me using the saved access token. Returns only a safe status and the already stored account handle; it never returns tokens, credentials, or upstream error bodies. The verification read may incur X API usage charges.",
    responses: { "200": { description: "Safe connection test result", content: { "application/json": { schema: jsonSchema(xConnectionTest, "output") } } } },
  }, (service, { params }) => service.integrations.testXConnection(params.connectionId), { body: z.object({}).strict(), maxBodyBytes: 1024, ownerSession: true, parameters: z.object({ connectionId: z.uuid() }) }),
  route("PUT", "/api/v1/x/connections/{connectionId}/credentials", "integrations:write", {
    summary: "Replace X app credentials",
    description: "Requires an interactive owner session. Replaces the encrypted client credentials, invalidates saved access and refresh tokens and pending OAuth attempts, preserves the existing account identity binding, and requires reauthorization. Reauthorization cannot switch the connection to a different X account; create a new connection for another account. Client access remains unavailable until authorization succeeds.",
    responses: { "200": { description: "Updated safe connection metadata", content: { "application/json": { schema: jsonSchema(xConnectionMetadata, "output") } } } },
  }, (service, { params, body }) => service.integrations.replaceXConnectionCredentials(params.connectionId, body), { body: xConnectionCredentialReplacement, maxBodyBytes: 8192, ownerSession: true, parameters: z.object({ connectionId: z.uuid() }) }),
  route("GET", "/api/v1/integrations/bearer", "integrations:read", {
    summary: "List bearer integration metadata",
    description: "Requires an interactive owner browser session. Returns secret-safe metadata only; stored bearer credentials are never returned.",
    responses: { "200": { description: "Bearer integration metadata", content: { "application/json": { schema: jsonSchema(bearerIntegrationList, "output") } } } },
  }, service => service.integrations.listBearerIntegrations(), { ownerSession: true }),
  route("POST", "/api/v1/integrations/bearer", "integrations:write", {
    summary: "Create a bearer integration",
    description: "Requires an interactive owner browser session. Accepts the secret over the authenticated connection and encrypts it with Factorize-managed storage before persistence. The secret is never returned.",
    responses: { "201": { description: "Created integration", content: { "application/json": { schema: jsonSchema(bearerIntegrationWriteResult, "output") } } } },
  }, (service, { body }) => service.integrations.createBearerIntegration(body), { body: bearerIntegrationCreate, maxBodyBytes: 70_000, ownerSession: true }),
  route("PUT", "/api/v1/integrations/bearer/{integrationId}", "integrations:write", {
    summary: "Update a bearer integration",
    description: "Requires an interactive owner browser session and the current collection revision. Accepts a replacement secret and encrypts it with Factorize-managed storage before persistence. The secret is never returned.",
    responses: { "200": { description: "Updated integration", content: { "application/json": { schema: jsonSchema(bearerIntegrationWriteResult, "output") } } } },
  }, (service, { params, body }) => service.integrations.updateBearerIntegration(params.integrationId, body), { body: bearerIntegrationUpdate, maxBodyBytes: 70_000, ownerSession: true }),
  route("DELETE", "/api/v1/integrations/bearer/{integrationId}", "integrations:write", {
    summary: "Delete an encrypted bearer integration",
    description: "Requires an interactive owner browser session and the current collection revision.",
    responses: { "200": { description: "Deleted integration", content: { "application/json": { schema: jsonSchema(bearerIntegrationDeleteResult, "output") } } } },
  }, (service, { params, body }) => service.integrations.deleteBearerIntegration(params.integrationId, body), { body: bearerIntegrationDelete, maxBodyBytes: 4096, ownerSession: true }),
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
    (service) => service.integrations.listExeConnections(),
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
    (service) => service.integrations.listGitHubInstallations(),
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
    (service) => service.integrations.listTailIntegrations(),
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
    (service) => service.integrations.integrationStatus(),
  ),
  route("GET", "/api/v1/hetzner/connection", "integrations:read", {
    summary: "Read the saved Hetzner Cloud project connection",
    description: "Owner browser session only. Returns the local project name, never the token.",
    responses: { "200": { description: "Connection metadata", content: { "application/json": { schema: jsonSchema(z.object({ connection: hetznerConnectionMetadata.nullable() }), "output") } } } },
  }, service => service.integrations.getHetznerConnection(), { ownerSession: true }),
  route("PUT", "/api/v1/hetzner/connection", "integrations:write", {
    summary: "Save a Hetzner Cloud project connection",
    description: "Owner browser session only. Supply a project API token with Read permission. Factorize verifies that it can list servers and stores it encrypted; no provider resources are changed.",
    responses: { "200": { description: "Saved connection metadata", content: { "application/json": { schema: jsonSchema(z.object({ connection: hetznerConnectionMetadata }), "output") } } } },
  }, (service, { body }) => service.integrations.saveHetznerConnection(body), { body: hetznerConnectionInput, ownerSession: true, maxBodyBytes: 4096 }),
  route("DELETE", "/api/v1/hetzner/connection", "integrations:write", {
    summary: "Delete the saved Hetzner Cloud project connection",
    description: "Owner browser session only. Deletes the encrypted credential from Factorize, without altering Hetzner resources or revoking the token there.",
    responses: { "200": { description: "Whether a saved connection was deleted", content: { "application/json": { schema: jsonSchema(z.object({ deleted: z.boolean() }), "output") } } } },
  }, service => service.integrations.deleteHetznerConnection(), { ownerSession: true }),
  route("GET", "/api/v1/hetzner/servers", "integrations:read", {
    summary: "List the saved Hetzner Cloud project's servers",
    description: "Owner browser session only. Returns up to 100 servers with basic inventory fields only. Factorize does not expose addresses, labels, or credentials.",
    responses: { "200": { description: "Read-only server inventory", content: { "application/json": { schema: jsonSchema(hetznerInventory, "output") } } } },
  }, service => service.integrations.listHetznerServers(), { ownerSession: true }),
  route("GET", "/api/v1/fly/connection", "integrations:read", {
    summary: "Read Fly account connection status",
    description: "Owner browser session only. Returns organization metadata and never returns the provisioning token.",
    responses: { "200": { description: "Connection status", content: { "application/json": { schema: jsonSchema(z.object({ connection: flyConnectionMetadata.nullable() }), "output") } } } },
  }, service => service.integrations.getFlyConnection(), { ownerSession: true }),
  route("POST", "/api/v1/fly/connection/test", "integrations:write", {
    summary: "Validate a Fly organization token",
    description: "Owner browser session only. Supply an org-scoped Fly deploy token with permission to manage Machines in the selected organization, created with `fly tokens create org --org <slug>`. A read-only org token is insufficient for later provisioning. Validation calls Fly's documented read-only current-token endpoint and launches no resources.",
    responses: { "200": { description: "Validated organization", content: { "application/json": { schema: jsonSchema(z.object({ valid: z.literal(true), connection: flyConnectionMetadata }), "output") } } } },
  }, (service, { body }) => service.integrations.validateFlyConnection(body), { body: flyConnectionInput, ownerSession: true }),
  route("PUT", "/api/v1/fly/connection", "integrations:write", {
    summary: "Save a Fly account connection",
    description: "Owner browser session only. Supply an org-scoped Fly deploy token with permission to manage Machines in the selected organization, created with `fly tokens create org --org <slug>`. A read-only org token is insufficient for provisioning. The server validates the connection and encrypts the token with its credential key; the token is never returned.",
    responses: { "200": { description: "Saved connection metadata", content: { "application/json": { schema: jsonSchema(z.object({ connection: flyConnectionMetadata }), "output") } } } },
  }, (service, { body }) => service.integrations.saveFlyConnection(body), { body: flyConnectionInput, ownerSession: true }),
  route("DELETE", "/api/v1/fly/connection", "integrations:write", {
    summary: "Remove the Fly account connection",
    description: "Owner browser session only. Deletes the tenant's encrypted provisioning token.",
    responses: { "200": { description: "Deletion result", content: { "application/json": { schema: jsonSchema(z.object({ deleted: z.boolean() }), "output") } } } },
  }, service => service.integrations.removeFlyConnection(), { ownerSession: true }),
  route(
    "PUT",
    "/api/v1/integrations/exe",
    "integrations:write",
    {
      summary: "Create an exe.dev integration",
      responses: { "200": { description: "Saved", content: { "application/json": { schema: jsonSchema(savedExe, "output") } } } },
    },
    (service, { body }) => service.integrations.saveExeIntegration(body),
    { body: exeBody },
  ),
  route(
    "PUT",
    "/api/v1/integrations/amp",
    "integrations:write",
    {
      summary: "Create an Amp integration",
      responses: { "200": { description: "Saved", content: { "application/json": { schema: jsonSchema(savedAmp, "output") } } } },
    },
    (service, { body }) => service.integrations.saveAmpIntegration(body),
    { body: ampBody },
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
    (service) => service.integrations.linearProjects(),
  ),
  route(
    "GET",
    "/api/v1/providers/linear/options",
    "integrations:read",
    {
      summary: "List Linear event options",
      responses: { "200": { description: "Options", content: { "application/json": { schema: jsonSchema(providerOptions, "output") } } } },
    },
    (service) => service.integrations.linearOptions(),
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
    (service) => service.integrations.clickUpLists(),
  ),
  route(
    "GET",
    "/api/v1/providers/clickup/options",
    "integrations:read",
    {
      summary: "List ClickUp event options",
      responses: { "200": { description: "Options", content: { "application/json": { schema: jsonSchema(providerOptions, "output") } } } },
    },
    (service, { query }) => service.integrations.clickUpOptions(query.listId),
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
    (service) => service.integrations.listGitHubInstallations(),
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
      service.integrations.removeIntegration("exe", params.connectionId),
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
      service.integrations.removeIntegration("amp", params.connectionId),
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
      service.integrations.removeTailIntegration(params.integrationId),
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
      service.integrations.githubRepositories(Number(params.installationId)),
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
      service.integrations.githubIssueOptions(
        Number(params.installationId),
        Number(params.repositoryId),
      ),
  ),
  route(
    "DELETE",
    "/api/v1/providers/github/installations/{installationId}",
    "integrations:write",
    {
      summary: "Delete the Factorize connection to a GitHub installation",
      responses: { "200": { description: "Connection deleted" } },
    },
    (service, { params }) =>
      service.integrations.removeGitHubInstallation(Number(params.installationId)),
  ),
] satisfies RouteContract[];
