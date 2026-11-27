import { z } from "zod";
import { AGENT_SCOPES, ACCESS_SCOPES } from "../domain/scopes";

const timestamp = z.string();
export const clientNameInput = z.object({ name: z.string().trim().min(1).max(120) }).strict();
export const clientPermissionsInput = z.object({
  scopes: z.array(z.string()).max(100).optional().describe("Complete owner-selected effective scope set for this connection."),
  // Accept the previous restriction-only payload during client upgrades.
  disabledScopes: z.array(z.enum(AGENT_SCOPES)).max(AGENT_SCOPES.length).optional(),
  integrationOverrides: z.record(z.uuid(), z.union([z.string(), z.literal(false)])).optional().describe("Integration ID to approved epoch-bound scope, or false to block. Explicit approval is required to re-enable a blocked integration, including when scopes are supplied."),
  expectedRevision: z.number().int().nonnegative().optional(),
}).strict().refine(value => value.scopes !== undefined || value.disabledScopes !== undefined || value.integrationOverrides !== undefined, "Supply a scope selection.");
export const clientPermissionsUpdate = clientPermissionsInput;
export const authorizedClient = z.object({ availableScopes: z.array(z.string()), scopeLabels: z.record(z.string(),z.string()).default({}), integrationOverrides: z.record(z.uuid(), z.union([z.string(), z.literal(false)])).default({}), revision: z.number().int(), grantId: z.string(), clientId: z.string(), clientName: z.string(), appName: z.string().optional(), ownerUsername: z.string().optional(), scopes: z.array(z.string()), credentialScopes: z.array(z.string()), pendingScopes: z.array(z.string()), authorizationDate: timestamp, expiresAt: timestamp.nullable(), lastUsedAt: timestamp.nullable() });
export const accessToken = z.object({ id: z.string(), name: z.string(), scopes: z.array(z.enum(ACCESS_SCOPES)), created_at: timestamp, expires_at: timestamp, last_used_at: timestamp.nullable().optional(), revoked_at: timestamp.nullable().optional() });
export const createdAccessToken = accessToken.extend({ token: z.string() });
export const teamPermission = z.object({ scope: z.string(), name: z.string(), isDefault: z.boolean(),
  integrationId: z.uuid().nullable(), kind: z.string().nullable(), credentialId: z.string().nullable(), preferenceSet: z.boolean(), available: z.boolean() });
export const teamPermissionList = z.array(teamPermission);
export const teamPermissionUpdate = z.strictObject({ scope: z.string().min(1).max(200), isDefault: z.boolean() });
