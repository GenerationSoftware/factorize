import { z } from "zod";
import { AGENT_SCOPES, ACCESS_SCOPES } from "./access-tokens";
import { tailIntegration } from "./editor-contracts";
const timestamp = z.string();
export const exeConnection = z.object({ connectionId: z.string(), credentialStatus: z.literal("connected"), accountTags: z.array(z.string()).default([]), tags: z.array(z.string()).optional() });
export const ampConnection = z.object({ connectionId: z.string(), project: z.string(), apiBaseUrl: z.string().optional() });
export const integrationStatus = z.object({ linear: z.object({ organizationName: z.string().nullable(), viewerEmail: z.string().nullable() }).nullable(), clickup: z.object({ teamName: z.string().nullable() }).nullable(), exe: exeConnection.nullable(), exeConnections: z.array(exeConnection), ampConnections: z.array(ampConnection), cloudflareTail: z.object({ count: z.number().int(), installations: z.array(tailIntegration) }) });
export const clientNameInput = z.object({ name: z.string().trim().min(1).max(120) }).strict();
export const clientPermissionsInput = z.object({
  disabledScopes: z.array(z.enum(AGENT_SCOPES)).max(AGENT_SCOPES.length),
  integrationOverrides: z.record(z.uuid(), z.union([z.string(), z.literal(false)])).describe("Integration ID to approved epoch-bound scope, or false to block."),
  expectedRevision: z.number().int().nonnegative().optional(),
}).strict();
export const authorizedClient = z.object({ availableScopes: z.array(z.enum(AGENT_SCOPES)), integrationOverrides: clientPermissionsInput.shape.integrationOverrides, revision: z.number().int(), grantId: z.string(), clientId: z.string(), clientName: z.string(), scopes: z.array(z.string()), authorizationDate: timestamp, expiresAt: timestamp.nullable(), lastUsedAt: timestamp.nullable() });
export const accessToken = z.object({ id: z.string(), name: z.string(), scopes: z.array(z.enum(ACCESS_SCOPES)), created_at: timestamp, expires_at: timestamp, last_used_at: timestamp.nullable().optional(), revoked_at: timestamp.nullable().optional() });
export const createdAccessToken = accessToken.extend({ token: z.string() });
export const okResult = z.object({ ok: z.boolean() });
export const savedExe = okResult.extend({ connectionId: z.string() });
export const testedExe = okResult.extend({ missingPermissions: z.array(z.string()), tags: z.array(z.string()), checks: z.array(z.object({ command: z.string(), ok: z.boolean(), httpStatus: z.number(), exitCode: z.number().nullable(), output: z.string() })) });
export const savedAmp = okResult.extend({ connectionId: z.string() });
export const savedTail = z.object({ integrationId: z.string(), name: z.string(), status: z.literal("connected"), secretConfigured: z.literal(true), generatedSecret: z.string().optional() });
