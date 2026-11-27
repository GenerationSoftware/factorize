import { okResult } from "../../settings-contracts";

import { z } from "zod";
import { oidcConsentInput, oidcConsentPreview } from "../../oidc-provider";
import { appRegistrationInput, appRegistrationUpdate, appSecret, connectedApp, registeredApp } from "../../apps/api/apps-contracts";

import { route, jsonSchema, type RouteContract } from "../../transport/rest/route-contract";

export const appRoutes = [
  route("GET", "/api/v1/app-consent/{requestId}", "team:read", {
    summary: "Preview a registered app sign-in request",
    responses: { "200": { description: "Requested app permissions", content: { "application/json": { schema: jsonSchema(oidcConsentPreview, "output") } } } },
  }, (service, { params }) => service.apps.inspectAppConsent(params.requestId), { parameters: z.object({ requestId: z.uuid() }), ownerSession: true }),
  route("POST", "/api/v1/app-consent/decision", "team:read", {
    summary: "Allow or deny a registered app sign-in request",
    responses: { "200": { description: "Registered redirect destination", content: { "application/json": { schema: jsonSchema(z.object({ redirectTo: z.string() }), "output") } } } },
  }, (service, { body }) => service.apps.decideAppConsent(body), { body: oidcConsentInput, ownerSession: true }),
  route("GET", "/api/v1/apps", "apps:manage", {
    summary: "List the team's app registrations",
    responses: { "200": { description: "Registered apps", content: { "application/json": { schema: jsonSchema(z.array(registeredApp), "output") } } } },
  }, service => service.apps.listApps()),
  route("POST", "/api/v1/apps", "apps:manage", {
    summary: "Register a server-side application",
    responses: { "200": { description: "Registered app", content: { "application/json": { schema: jsonSchema(registeredApp, "output") } } } },
  }, (service, { body }) => service.apps.createApp(body), { body: appRegistrationInput }),
  route("GET", "/api/v1/apps/{appId}", "apps:manage", {
    summary: "Read an app registration",
    responses: { "200": { description: "Registered app", content: { "application/json": { schema: jsonSchema(registeredApp, "output") } } } },
  }, (service, { params }) => service.apps.getApp(params.appId), { parameters: z.object({ appId: z.uuid() }) }),
  route("PUT", "/api/v1/apps/{appId}", "apps:manage", {
    summary: "Change an app registration, its visibility, or its enabled state",
    responses: { "200": { description: "Registered app", content: { "application/json": { schema: jsonSchema(registeredApp, "output") } } } },
  }, (service, { params, body }) => service.apps.updateApp(params.appId, body), { parameters: z.object({ appId: z.uuid() }), body: appRegistrationUpdate }),
  route("POST", "/api/v1/apps/{appId}/secret", "apps:manage", {
    summary: "Issue or rotate a client secret in a browser session",
    responses: { "200": { description: "One-time secret", content: { "application/json": { schema: jsonSchema(appSecret, "output") } } } },
  }, (service, { params }) => service.apps.rotateAppSecret(params.appId), { parameters: z.object({ appId: z.uuid() }), ownerSession: true }),
  route("GET", "/api/v1/app-connections", "team:read", {
    summary: "List sign-in apps authorized by the current user",
    responses: { "200": { description: "Connected apps", content: { "application/json": { schema: jsonSchema(z.array(connectedApp), "output") } } } },
  }, service => service.apps.listConnectedApps(), { ownerSession: true }),
  route("DELETE", "/api/v1/app-connections/{connectionId}", "team:write", {
    summary: "Revoke one sign-in app connection",
    responses: { "200": { description: "Connection revoked", content: { "application/json": { schema: jsonSchema(okResult, "output") } } } },
  }, (service, { params }) => service.apps.revokeConnectedApp(params.connectionId), { parameters: z.object({ connectionId: z.uuid() }), ownerSession: true }),
] satisfies RouteContract[];
