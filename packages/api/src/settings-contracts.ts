import { z } from "zod";
import { AGENT_SCOPES, ACCESS_SCOPES } from "./access-tokens";
import { tailIntegration } from "./editor-contracts";
const timestamp = z.string();
export const exeConnection = z.object({ connectionId: z.string(), credentialStatus: z.literal("connected") });
export const ampConnection = z.object({ connectionId: z.string(), project: z.string(), apiBaseUrl: z.string().optional() });
export const integrationStatus = z.object({ linear: z.object({ organizationName: z.string().nullable(), viewerEmail: z.string().nullable() }).nullable(), clickup: z.object({ teamName: z.string().nullable() }).nullable(), exe: exeConnection.nullable(), exeConnections: z.array(exeConnection), ampConnections: z.array(ampConnection), cloudflareTail: z.object({ count: z.number().int(), installations: z.array(tailIntegration) }) });
export const clientNameInput = z.object({ name: z.string().trim().min(1).max(120) }).strict();
export const clientPermissionsInput = z.object({
  scopes: z.array(z.string()).max(100).optional().describe("Complete owner-selected effective scope set for this connection."),
  // Accept the previous restriction-only payload during client upgrades.
  disabledScopes: z.array(z.enum(AGENT_SCOPES)).max(AGENT_SCOPES.length).optional(),
  integrationOverrides: z.record(z.uuid(), z.union([z.string(), z.literal(false)])).optional().describe("Integration ID to approved epoch-bound scope, or false to block."),
  expectedRevision: z.number().int().nonnegative().optional(),
}).strict().refine(value => value.scopes !== undefined || value.disabledScopes !== undefined || value.integrationOverrides !== undefined, "Supply a scope selection.");
export const clientPermissionsUpdate = clientPermissionsInput;
export const authorizedClient = z.object({ availableScopes: z.array(z.string()), scopeLabels: z.record(z.string(),z.string()).default({}), integrationOverrides: z.record(z.uuid(), z.union([z.string(), z.literal(false)])).default({}), revision: z.number().int(), grantId: z.string(), clientId: z.string(), clientName: z.string(), appName: z.string().optional(), scopes: z.array(z.string()), authorizationDate: timestamp, expiresAt: timestamp.nullable(), lastUsedAt: timestamp.nullable() });
export const accessToken = z.object({ id: z.string(), name: z.string(), scopes: z.array(z.enum(ACCESS_SCOPES)), created_at: timestamp, expires_at: timestamp, last_used_at: timestamp.nullable().optional(), revoked_at: timestamp.nullable().optional() });
export const createdAccessToken = accessToken.extend({ token: z.string() });
export const okResult = z.object({ ok: z.boolean() });
export const permissionPresetInput = z.object({ name: z.string().trim().min(1).max(100), scopes: z.array(z.string()).max(100), expectedRevision: z.number().int().positive().optional() }).strict();
export const permissionPreset = z.object({ id: z.uuid(), name: z.string(), scopes: z.array(z.string()), isDefault: z.boolean(), revision: z.number().int().positive(), createdAt: timestamp, updatedAt: timestamp });
export const permissionPresetList = z.array(permissionPreset);
export const savedExe = okResult.extend({ connectionId: z.string() });
export const savedAmp = okResult.extend({ connectionId: z.string() });
export const savedTail = z.object({ integrationId: z.string(), name: z.string(), status: z.literal("connected"), secretConfigured: z.literal(true), generatedSecret: z.string().optional() });
