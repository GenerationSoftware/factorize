import { clientPermissionsUpdate, clientNameInput, authorizedClient, accessToken, createdAccessToken, teamPermissionList, teamPermissionUpdate } from "./access-contracts";
import { okResult } from "../../transport/rest/result-contracts";

import { z } from "zod";

import { scopeSchema, teamResponse } from "../../triggers/api/trigger-schemas";

import { route, jsonSchema, type RouteContract } from "../../transport/rest/route-contract";

const accessTokenBody = z.object({
  name: z.string().trim().min(1).max(100),
  scopes: z.array(scopeSchema).min(1),
  expiryDays: z.union([z.literal(7), z.literal(30), z.literal(90)]),
});
export const accessRoutes = [
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
    (service) => service.access.listAuthorizedClients(),
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
    (service) => service.access.listAccessTokens(),
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
    (service, { body }) => service.access.createAccessToken(body),
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
    (service, { params }) => service.access.revokeAccessToken(params.tokenId),
    { ownerSession: true },
  ),
  route("PUT", "/api/v1/access/authorizations/{grantId}/name", "triggers:write", {
    summary: "Rename an authorized OAuth connection",
    description: "Interactive owner session required. Changes only this connection’s display name, not the registered app name or permissions.",
    responses: { "200": { description: "Connection renamed", content: { "application/json": { schema: jsonSchema(clientNameInput, "output") } } } },
  }, (service, { params, body }) => service.access.renameAuthorizedClient(params.grantId, body), { ownerSession: true, body: clientNameInput }),
  route("PUT", "/api/v1/access/authorizations/{grantId}/permissions", "triggers:write", {
    summary: "Save the selected permissions for one OAuth connection",
    description: "The authenticated owner sets the connection policy. Removals take effect immediately; additions need a fresh authorization for this same connection. This never enlarges an existing bearer or refresh credential.",
    responses: {"200": {description: "Permissions saved", content: {"application/json": {schema: jsonSchema(okResult, "output")}}}},
  }, (service, {params, body}) => service.access.updateClientPermissions(params.grantId, body), {ownerSession: true, body: clientPermissionsUpdate}),
  route("GET", "/api/v1/team-permissions", "team:read", {
    summary: "List workspace consent defaults", responses: { "200": { description: "Team permission defaults", content: { "application/json": { schema: jsonSchema(teamPermissionList, "output") } } } },
  }, service => service.access.listTeamPermissions(), { ownerSession: true }),
  route("PUT", "/api/v1/team-permissions", "team:write", {
    summary: "Change one workspace consent default", responses: { "200": { description: "Default updated", content: { "application/json": { schema: jsonSchema(okResult, "output") } } } },
  }, (service, { body }) => service.access.updateTeamPermission(body), { ownerSession: true, body: teamPermissionUpdate }),
  route("DELETE", "/api/v1/access/authorizations/{grantId}", "triggers:write", {summary:"Revoke one isolated OAuth connection", description:"Other connections, including copies of the same client, retain their approvals.",responses:{"200":{description:"Authorization revoked",content:{"application/json":{schema:jsonSchema(z.object({revoked:z.number().int()}),"output")}}}}}, (service,{params})=>service.access.revokeOAuthAuthorization(params.grantId), {ownerSession:true}),
  route(
    "DELETE",
    "/api/v1/access/authorized-clients/{clientId}",
    "triggers:write",
    {
      summary: "Revoke a client only when it has one connection",
      description: "If this app has several connections, use the exact connection endpoint instead.",
      responses: { "200": { description: "Revoked one OAuth connection" } },
    },
    (service, { params }) => service.access.revokeAuthorizedClient(params.clientId),
    { ownerSession: true },
  ),
  route("GET", "/api/v1/team", "team:read", {
    summary: "Get the current team",
    responses: { "200": { description: "Team", content: { "application/json": { schema: jsonSchema(teamResponse, "output") } } } },
  }, service => service.access.getTeam()),
] satisfies RouteContract[];
