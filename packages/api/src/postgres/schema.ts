import { relations, sql } from "drizzle-orm";
import {
  bigint, boolean, check, foreignKey, index, integer, jsonb, pgSchema,
  primaryKey, text, timestamp, unique, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import type { TriggerSourceKind } from "../trigger-domain";

export const app = pgSchema("app");
const createdAt = () => timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();

export const schemaMigrations = app.table("schema_migrations", {
  version: text("version").primaryKey(), appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tenants = app.table("tenants", { id: uuid("id").primaryKey(), personalOwnerId:uuid("personal_owner_id").references(()=>authUsers.id), name: text("name"), createdAt: createdAt(), updatedAt: updatedAt() });
export const teamSettings = app.table("team_settings", {
  tenantId: uuid("tenant_id").primaryKey().references(() => tenants.id, { onDelete: "cascade" }),
  updatedAt: updatedAt(),
});
export const authUsers = app.table("auth_users", { id: uuid("id").primaryKey(), username:text("username").notNull().unique("auth_users_username_unique").default(sql`'user-' || replace(gen_random_uuid()::text,'-','')`), email: text("email").notNull().unique(), emailVerified: boolean("email_verified").notNull().default(false), googleRecoveryManaged: boolean("google_recovery_managed").notNull().default(false), googleRecoveryAddressConfirmed: boolean("google_recovery_address_confirmed").notNull().default(false), googleRecoveryCandidate: text("google_recovery_candidate"), googleRecoverySuspended: boolean("google_recovery_suspended").notNull().default(false), googleRecoveryObservedAt: integer("google_recovery_observed_at").notNull().default(0), googleRecoveryRevision: integer("google_recovery_revision").notNull().default(0), createdAt: createdAt() }, t => [uniqueIndex("auth_users_email_normalized").on(sql`lower(${t.email})`)]);
export const authAccounts = app.table("auth_accounts", {
  id: uuid("id").primaryKey(), userId: uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }), provider: text("provider").notNull(), providerAccountId: text("provider_account_id").notNull(), passwordHash: text("password_hash"),
}, t => [unique().on(t.provider, t.providerAccountId), uniqueIndex("auth_accounts_google_user_unique").on(t.userId).where(sql`${t.provider}='google'`)]);
export const oauthConnections = app.table("oauth_connections", {
  id: uuid("id").primaryKey(), browserDigest: text("browser_digest").notNull(), deviceUserCode: text("device_user_code"), destination: text("destination").notNull(), clientName: text("client_name").notNull(),
  kind: text("kind").$type<"callback" | "device">().notNull(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  userId: uuid("user_id").references(() => authUsers.id, { onDelete: "cascade" }), readyVersion: integer("ready_version"), ready: boolean("ready").notNull().default(false), usedAt: timestamp("used_at", { withTimezone: true }),
}, t => [index("oauth_connections_expires").on(t.expiresAt), check("oauth_connections_kind_check", sql`${t.kind} IN ('callback','device')`)]);
export const googleSignInAttempts = app.table("google_sign_in_attempts", {
  id: uuid("id").primaryKey(), browserDigest: text("browser_digest").notNull().unique(),
  verifier: text("verifier"), nonce: text("nonce").notNull(), returnTo: text("return_to").notNull(),
  connectionId: uuid("connection_id").references(() => oauthConnections.id, { onDelete: "cascade" }),
  googleSubject: text("google_subject"), email: text("email"), existingUserId: uuid("existing_user_id").references(() => authUsers.id, { onDelete: "cascade" }),
  emailConfirmed: boolean("email_confirmed").notNull().default(false), emailTokenDigest: text("email_token_digest"), emailSentAt: timestamp("email_sent_at", { withTimezone: true }),
  passwordUserId: uuid("password_user_id").references(() => authUsers.id, { onDelete: "cascade" }), totpSettingsVersion: integer("totp_settings_version"), recoveryRevision: integer("recovery_revision"), providerObservedAt: integer("provider_observed_at").notNull().default(0), providerManagedEmail: boolean("provider_managed_email").notNull().default(false),
  passwordAttempts: integer("password_attempts").notNull().default(0), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, t => [index("google_sign_in_attempts_expiry").on(t.expiresAt)]);
export const oauthConsentPreviews = app.table("oauth_consent_previews", { id: uuid("id").primaryKey(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), usedAt: timestamp("used_at", { withTimezone: true }) }, t => [index("oauth_consent_previews_expires").on(t.expiresAt)]);
export const authResetTokens = app.table("auth_reset_tokens", { connectionId: uuid("connection_id").references(() => oauthConnections.id, { onDelete: "set null" }), purpose: text("purpose").$type<"verify" | "reset">().notNull().default("reset"), digest: text("digest").primaryKey(), userId: uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), usedAt: timestamp("used_at", { withTimezone: true }) }, t => [check("auth_reset_tokens_purpose_check", sql`${t.purpose} IN ('verify','reset')`), index("auth_reset_tokens_expiration").on(t.expiresAt,t.digest)]);
export const authSessions = app.table("auth_sessions", { id: uuid("id").primaryKey(), userId: uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), revokedAt: timestamp("revoked_at", { withTimezone: true }) }, t => [index("auth_sessions_expiration").on(t.expiresAt,t.id)]);
export const oauthDeviceAuthorizations = app.table("oauth_device_authorizations", {
  deviceCode: text("device_code").primaryKey(), userCode: text("user_code").notNull().unique(), record: jsonb("record").$type<Record<string, unknown>>().notNull(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), createdAt: createdAt(), updatedAt: updatedAt(),
}, t => [index("oauth_device_authorizations_expires").on(t.expiresAt)]);
export const members = app.table("members", {
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }), userId: uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }), email: text("email").notNull(), role: text("role").$type<"owner" | "member">().notNull(), sessionVersion: integer("session_version").notNull().default(1), createdAt: createdAt(),
}, t => [primaryKey({ columns: [t.tenantId, t.userId] }), check("members_role_check", sql`${t.role} in ('owner','member')`), check("members_session_version_check", sql`${t.sessionVersion} > 0`)]);
export const cloudflareConnections = app.table("cloudflare_connections", {
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  id: uuid("id").notNull(), accountId: text("account_id"), name: text("account_name").notNull(),
  encryptedCredentials: text("encrypted_credentials"),
}, t => [primaryKey({ columns: [t.tenantId, t.id] }), unique().on(t.tenantId, t.accountId), uniqueIndex("cloudflare_broker_connection").on(t.tenantId).where(sql`${t.accountId} IS NULL`)]);
export const cloudflareOauthAttempts = app.table("cloudflare_oauth_attempts", {
  tenantId: uuid("tenant_id").primaryKey().references(() => tenants.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  sessionVersion: integer("session_version").notNull(), state: uuid("state").notNull().unique(),
  verifier: text("verifier"), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, t => [index("cloudflare_oauth_expiry").on(t.expiresAt)]);
export const authTotp = app.table("auth_totp", {
  userId: uuid("user_id").primaryKey().references(() => authUsers.id, { onDelete: "cascade" }), encryptedSecret: text("encrypted_secret").notNull(),
  lastCounter: bigint("last_counter", { mode: "bigint" }).notNull(), enabledAt: timestamp("enabled_at", { withTimezone: true }).notNull().defaultNow(),
});
export const authTotpRecoveryCodes = app.table("auth_totp_recovery_codes", {
  userId: uuid("user_id").notNull().references(() => authTotp.userId, { onDelete: "cascade" }), digest: text("digest").notNull(),
}, t => [primaryKey({ columns: [t.userId, t.digest] })]);
export const authTotpEnrollments = app.table("auth_totp_enrollments", {
  userId: uuid("user_id").primaryKey().references(() => authUsers.id, { onDelete: "cascade" }), browserDigest: text("browser_digest").notNull(),
  sessionVersion: integer("session_version").notNull(), encryptedSecret: text("encrypted_secret").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, t => [index("auth_totp_enrollments_expiry").on(t.expiresAt)]);
export const authTotpChallenges = app.table("auth_totp_challenges", {
  digest: text("digest").primaryKey(), tenantId: uuid("tenant_id").notNull(), userId: uuid("user_id").notNull(),
  sessionVersion: integer("session_version").notNull(), returnTo: text("return_to").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, t => [foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [members.tenantId, members.userId] }).onDelete("cascade"),
  index("auth_totp_challenges_expiry").on(t.expiresAt)]);
export const authTotpLimits = app.table("auth_totp_limits", {
  userId: uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  kind: text("kind").$type<"code" | "settings" | "challenge">().notNull(), attempts: integer("attempts").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, t => [primaryKey({ columns: [t.userId, t.kind] }), check("auth_totp_limits_kind_check", sql`${t.kind} IN ('code','settings','challenge')`),
  index("auth_totp_limits_expiry").on(t.expiresAt)]);
export const accessTokens = app.table("access_tokens", {
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }), id: uuid("id").notNull(), name: text("name").notNull(), digest: text("digest").notNull().unique(), userId: uuid("user_id").notNull(), sessionVersion: integer("session_version").notNull(), scopes: jsonb("scopes").$type<string[]>().notNull().default([]), createdAt: createdAt(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), lastUsedAt: timestamp("last_used_at", { withTimezone: true }), revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, t => [primaryKey({ columns: [t.tenantId, t.id] }), foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [members.tenantId, members.userId] }).onDelete("cascade"), index("access_tokens_expiration").on(t.expiresAt,t.tenantId,t.id)]);

export const connections = app.table("connections", { tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }), kind: text("kind").notNull(), encryptedValue: text("encrypted_value").notNull(), updatedAt: updatedAt() }, t => [primaryKey({ columns: [t.tenantId, t.kind] })]);
export const integrationCollections = app.table("integration_collections", {
  tenantId: uuid("tenant_id").primaryKey().references(() => tenants.id, { onDelete: "cascade" }), revision: bigint("revision", { mode: "number" }).notNull().default(0), createdAt: createdAt(), updatedAt: updatedAt(),
});
export const integrationRecords = app.table("integration_records", {
  tenantId: uuid("tenant_id").notNull().references(() => integrationCollections.tenantId, { onDelete: "cascade" }), id: uuid("id").notNull(), kind: text("kind").$type<"bearer">().notNull(), name: text("name").notNull(), origin: text("origin"), description: text("description"), revision: bigint("revision", { mode: "number" }).notNull(), encryptedPayload: text("encrypted_payload"), deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }), createdAt: createdAt(), updatedAt: updatedAt(),
}, t => [primaryKey({ columns: [t.tenantId, t.id] }), uniqueIndex("integration_records_active_name").on(t.tenantId, t.kind, sql`lower(${t.name})`).where(sql`${t.deletedAt} is null`), index("integration_records_collection_order").on(t.tenantId, t.revision, t.id), check("integration_records_kind_check", sql`${t.kind} = 'bearer'`), check("integration_records_origin_check", sql`${t.origin} IS NOT NULL`), check("integration_records_payload_check", sql`(${t.deletedAt} IS NULL AND ${t.encryptedPayload} IS NOT NULL) OR (${t.deletedAt} IS NOT NULL AND ${t.encryptedPayload} IS NULL)`)]);

export const xConnections = app.table("x_connections", {
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  id: uuid("id").notNull(), name: text("name").notNull(), clientId: text("client_id").notNull(),
  scopes: text("scopes").array().notNull(), encryptedSecret: text("encrypted_secret").notNull(),
  credentialVersion: integer("credential_version").notNull().default(1),
  accountId: text("account_id"), accountHandle: text("account_handle"), grantedScopes: text("granted_scopes").array().notNull().default(sql`'{}'::text[]`),
  status: text("status").$type<"pending" | "connected" | "reconnect_required">().notNull().default("pending"),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, t => [primaryKey({ columns: [t.tenantId, t.id] }), uniqueIndex("x_connections_tenant_name").on(t.tenantId, sql`lower(${t.name})`).where(sql`${t.status} <> 'revoked'`), check("x_connections_status_check", sql`${t.status} IN ('pending','connected','reconnect_required','revoked')`)]);
export const xOAuthAttempts = app.table("x_oauth_attempts", {
  tenantId: uuid("tenant_id").notNull(), nonce: text("nonce").notNull(), userId: uuid("user_id").notNull(), sessionVersion: integer("session_version").notNull(),
  connectionId: uuid("connection_id").notNull(), scopes: text("scopes").array().notNull(), encryptedVerifier: text("encrypted_verifier").notNull(),
  credentialVersion: integer("credential_version").notNull().default(1),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), consumedAt: timestamp("consumed_at", { withTimezone: true }),
}, t => [primaryKey({ columns: [t.tenantId, t.nonce] }), foreignKey({ columns: [t.tenantId, t.connectionId], foreignColumns: [xConnections.tenantId, xConnections.id] }).onDelete("cascade"), index("x_oauth_attempt_expiry").on(t.expiresAt)]);
export const agentIntegrations = app.table("agent_integrations", {
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, {onDelete:"cascade"}), id: uuid("id").notNull().defaultRandom(),
  kind: text("kind").$type<"bearer"|"github"|"linear"|"fly"|"exe"|"amp"|"clickup"|"x"|"cloudflare">().notNull(), credentialId: text("credential_id").notNull(), name:text("name").notNull(), description:text("description"), available:boolean("available").notNull(),
  policy:text("policy").$type<"baseline"|"requestable"|"disabled">().notNull().default("requestable"),epoch:integer("epoch").notNull().default(1),revision:integer("revision").notNull().default(1),
},t=>[primaryKey({columns:[t.tenantId,t.id]}),unique().on(t.tenantId,t.kind,t.credentialId)]);
export const agentIdentities = app.table("agent_identities", {
  displayName: text("display_name"), disabledScopes: text("disabled_scopes").array().notNull().default([]), scopeOverrides: text("scope_overrides").array(),
  integrationOverrides: jsonb("integration_overrides").notNull().default({}), permissionsRevision: integer("permissions_revision").notNull().default(0),
  tenantId:uuid("tenant_id").notNull().references(()=>tenants.id,{onDelete:"cascade"}),id:uuid("id").notNull().defaultRandom(),kind:text("kind").$type<"oauth">().notNull(),subject:text("subject").notNull(),userId:uuid("user_id").notNull(),sessionVersion:integer("session_version").notNull(),revokedAt:timestamp("revoked_at",{withTimezone:true}),createdAt:createdAt(),
},t=>[primaryKey({columns:[t.tenantId,t.id]}),unique().on(t.tenantId,t.kind,t.subject)]);
export const teamPermissionDefaults = app.table("team_permission_defaults", {
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  permission: text("permission").notNull(), enabled: boolean("enabled").notNull(),
}, t => [primaryKey({ columns: [t.tenantId, t.permission] })]);
export const permissionPresets = app.table("permission_presets", {
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  id: uuid("id").notNull(), name: text("name").notNull(), scopes: text("scopes").array().notNull().default([]),
  isDefault: boolean("is_default").notNull().default(false), revision: integer("revision").notNull().default(1),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, t => [primaryKey({ columns: [t.tenantId, t.id] }), uniqueIndex("permission_presets_name").on(t.tenantId, sql`lower(${t.name})`), uniqueIndex("permission_presets_default").on(t.tenantId).where(sql`${t.isDefault}`)]);
export const agentProxyResponses = app.table("agent_proxy_responses", {
  tenantId:uuid("tenant_id").notNull(),id:uuid("id").notNull(),identityId:uuid("identity_id").notNull(),integrationId:uuid("integration_id").notNull(),integrationEpoch:integer("integration_epoch").notNull(),objectKey:text("object_key").notNull().unique(),size:integer("size"),expiresAt:timestamp("expires_at",{withTimezone:true}).notNull(),
},t=>[primaryKey({columns:[t.tenantId,t.id]}),foreignKey({columns:[t.tenantId,t.identityId],foreignColumns:[agentIdentities.tenantId,agentIdentities.id]}),foreignKey({columns:[t.tenantId,t.integrationId],foreignColumns:[agentIntegrations.tenantId,agentIntegrations.id]}),index("agent_proxy_response_expiry").on(t.expiresAt)]);
export const integrationChanges = app.table("integration_changes", {
  tenantId: uuid("tenant_id").notNull().references(() => integrationCollections.tenantId, { onDelete: "cascade" }), revision: bigint("revision", { mode: "number" }).notNull(), id: uuid("id").notNull(), idempotencyKey: uuid("idempotency_key").notNull(), operation: text("operation").$type<"upsert" | "delete">().notNull(), recordId: uuid("record_id").notNull(), kind: text("kind").$type<"bearer">().notNull(), name: text("name").notNull(), origin: text("origin"), description: text("description"), encryptedPayload: text("encrypted_payload"), createdAt: createdAt(),
}, t => [primaryKey({ columns: [t.tenantId, t.revision] }), unique().on(t.tenantId, t.idempotencyKey), index("integration_changes_page").on(t.tenantId, t.revision), check("integration_changes_operation_check", sql`${t.operation} IN ('upsert','delete')`), check("integration_changes_kind_check", sql`${t.kind} = 'bearer'`), check("integration_changes_origin_check", sql`${t.origin} IS NOT NULL`), check("integration_changes_payload_check", sql`(${t.operation} = 'upsert' AND ${t.encryptedPayload} IS NOT NULL) OR (${t.operation} = 'delete' AND ${t.encryptedPayload} IS NULL)`)]);
export const linearWorkspaces = app.table("linear_workspaces", { organizationId: uuid("organization_id").primaryKey(), tenantId: uuid("tenant_id").notNull().unique().references(() => tenants.id, { onDelete: "cascade" }) });
export const githubInstallations = app.table("github_installations", { installationId: bigint("installation_id", { mode: "number" }).primaryKey(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }), accountLogin: text("account_login").notNull(), accountType: text("account_type").notNull(), state: text("state").$type<"active" | "suspended">().notNull(), updatedAt: updatedAt() }, t => [unique().on(t.tenantId, t.installationId), check("github_installations_state_check", sql`${t.state} in ('active','suspended')`)]);
export const githubSetupStates = app.table("github_setup_states", { tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }), nonce: text("nonce").notNull(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), usedAt: timestamp("used_at", { withTimezone: true }) }, t => [primaryKey({ columns: [t.tenantId, t.nonce] }), index("github_setup_states_expiration").on(t.expiresAt,t.tenantId,t.nonce)]);
export const eventDefinitions = app.table("event_definitions", {
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }), id: uuid("id").notNull(),
  name: text("name").notNull(), description: text("description").notNull().default(""), currentRevision: integer("current_revision").notNull(), createdAt: createdAt(), updatedAt: updatedAt(),
}, t => [primaryKey({ columns: [t.tenantId,t.id] }), unique().on(t.tenantId,t.name)]);
export const eventDefinitionRevisions = app.table("event_definition_revisions", {
  tenantId: uuid("tenant_id").notNull(), definitionId: uuid("definition_id").notNull(), revision: integer("revision").notNull(),
  payloadSchema: jsonb("payload_schema").$type<Record<string,unknown>>().notNull().default({type:"object"}),
  createdAt: createdAt(),
}, t => [primaryKey({columns:[t.tenantId,t.definitionId,t.revision]}),foreignKey({columns:[t.tenantId,t.definitionId],foreignColumns:[eventDefinitions.tenantId,eventDefinitions.id]}).onDelete("cascade")]);
export const triggers = app.table("triggers", {
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }), id: uuid("id").notNull(), name: text("name").notNull(), description: text("description").notNull().default(""), slug: text("slug").notNull(), revision: integer("revision").notNull().default(1), eventDefinitionId: uuid("event_definition_id").notNull(), enabled: boolean("enabled").notNull().default(true), createdAt: createdAt(), updatedAt: updatedAt(),
}, t => [primaryKey({ columns: [t.tenantId, t.id] }), unique().on(t.tenantId, t.slug), foreignKey({columns:[t.tenantId,t.eventDefinitionId],foreignColumns:[eventDefinitions.tenantId,eventDefinitions.id]}).onDelete("cascade")]);
export const triggerSources = app.table("events", {
  tenantId: uuid("tenant_id").notNull(), id: uuid("id").notNull(), triggerId: uuid("trigger_id").notNull(), kind: text("kind").$type<TriggerSourceKind>().notNull(), slug: text("slug").notNull(), enabled: boolean("enabled").notNull().default(true), config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}), encryptedTemplate:text("encrypted_template"), legacyTemplate:boolean("legacy_template").notNull().default(false), position: integer("position").notNull().default(0), createdAt: createdAt(), updatedAt: updatedAt(), removedAt: timestamp("removed_at", { withTimezone: true }),
}, t => [primaryKey({ columns: [t.tenantId, t.id] }), uniqueIndex("events_active_slug").on(t.tenantId, t.triggerId, t.slug).where(sql`${t.removedAt} is null`), foreignKey({ columns: [t.tenantId, t.triggerId], foreignColumns: [triggers.tenantId, triggers.id] }).onDelete("cascade"), check("no_webhook_handler_code", sql`NOT (${t.config} ? 'handlerCode')`), check("events_kind_check", sql`${t.kind} in ('manual','schedule','webhook')`)]);
export const eventOccurrences = app.table("event_occurrences", {
  tenantId: uuid("tenant_id").notNull(), id: uuid("id").notNull(), definitionId: uuid("definition_id").notNull(), definitionRevision: integer("definition_revision").notNull(),
  occurredAt: timestamp("occurred_at", {withTimezone:true}).notNull().defaultNow(), payload: jsonb("payload").$type<Record<string,unknown>>().notNull(),
  producerIdentity: jsonb("producer_identity").$type<Record<string,unknown>>().notNull(), evidence: jsonb("evidence").notNull().default([]), sourceIdentity: text("source_identity").notNull(), idempotencyKey: text("idempotency_key").notNull(), createdAt: createdAt(),
}, t => [primaryKey({columns:[t.tenantId,t.id]}),unique().on(t.tenantId,t.sourceIdentity,t.idempotencyKey),foreignKey({columns:[t.tenantId,t.definitionId,t.definitionRevision],foreignColumns:[eventDefinitionRevisions.tenantId,eventDefinitionRevisions.definitionId,eventDefinitionRevisions.revision]}).onDelete("cascade"),index("event_occurrences_by_definition").on(t.tenantId,t.definitionId,t.occurredAt,t.id),index("event_occurrences_recorded").on(t.tenantId,t.definitionId,t.createdAt,t.id)]);
export const mcpEventSubscriptions = app.table("mcp_event_subscriptions", {
  tenantId: uuid("tenant_id").notNull(),
  id: text("id").notNull(),
  userId: uuid("user_id").notNull(),
  sessionVersion: integer("session_version").notNull(),
  grantId: text("grant_id").notNull(),
  clientId: text("client_id").notNull(),
  definitionId: uuid("definition_id").notNull(),
  arguments: jsonb("arguments").$type<Record<string, unknown>>().notNull(),
  ackEpoch: uuid("ack_epoch"),
  ackTimeoutSeconds: integer("ack_timeout_seconds").notNull().default(300),
  cooldownUntil: timestamp("cooldown_until", { withTimezone: true }),
  lastCooldownStartedAt: timestamp("last_cooldown_started_at", { withTimezone: true }),
  lastCooldownEndsAt: timestamp("last_cooldown_ends_at", { withTimezone: true }),
  callbackUrl: text("callback_url").notNull(),
  encryptedSecret: text("encrypted_secret").notNull(),
  secretFingerprint: text("secret_fingerprint").notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
  previousEncryptedSecret: text("previous_encrypted_secret"),
  rotatedAt: timestamp("rotated_at", { withTimezone: true }),
  generation: uuid("generation").notNull(),
  status: text("status", { enum: ["active", "stopped"] }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, t => [
  primaryKey({ columns: [t.tenantId, t.id] }),
  foreignKey({ columns: [t.tenantId, t.definitionId], foreignColumns: [eventDefinitions.tenantId, eventDefinitions.id] }).onDelete("cascade"),
  check("mcp_event_subscriptions_status_check", sql`${t.status} IN ('active','stopped')`),
  check("mcp_event_subscriptions_ack_timeout_seconds_check", sql`${t.ackTimeoutSeconds} BETWEEN 30 AND 86400`),
  index("mcp_event_subscriptions_active").on(t.tenantId, t.definitionId, t.expiresAt).where(sql`${t.status}='active'`),
  index("mcp_event_subscriptions_verification").on(t.tenantId, t.userId, t.grantId, t.callbackUrl, t.secretFingerprint, t.verifiedAt.desc()),
]);

export const mcpEventDeliveries = app.table("mcp_event_deliveries", {
  tenantId: uuid("tenant_id").notNull(),
  subscriptionId: text("subscription_id").notNull(),
  occurrenceId: uuid("occurrence_id").notNull(),
  generation: uuid("generation").notNull(),
  status: text("status", { enum: ["pending", "sending", "accepted", "failed", "cancelled"] }).notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  ackEpoch: uuid("ack_epoch"),
  ackState: text("ack_state", { enum: ["pending", "awaiting_ack", "processed", "waived", "exhausted", "cancelled"] }),
  ackDueAt: timestamp("ack_due_at", { withTimezone: true }),
  ackUpdatedAt: timestamp("ack_updated_at", { withTimezone: true }),
  recoveryEventId: uuid("recovery_event_id"),
  recoveryAttempts: integer("recovery_attempts").notNull().default(0),
  claimId: uuid("claim_id"),
  httpStatus: integer("http_status"),
  lastOutcome: text("last_outcome"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
}, t => [
  primaryKey({ columns: [t.tenantId, t.subscriptionId, t.occurrenceId] }),
  foreignKey({ columns: [t.tenantId, t.subscriptionId], foreignColumns: [mcpEventSubscriptions.tenantId, mcpEventSubscriptions.id] }).onDelete("cascade"),
  foreignKey({ columns: [t.tenantId, t.occurrenceId], foreignColumns: [eventOccurrences.tenantId, eventOccurrences.id] }).onDelete("cascade"),
  check("mcp_event_deliveries_status_check", sql`${t.status} IN ('pending','sending','accepted','failed','cancelled')`),
  check("mcp_event_deliveries_attempts_check", sql`${t.attempts} >= 0`),
  index("mcp_event_deliveries_due").on(t.nextAttemptAt, t.tenantId, t.subscriptionId, t.occurrenceId)
    .where(sql`${t.status} IN ('pending','sending')`),
  index("mcp_event_deliveries_occurrence").on(t.tenantId, t.occurrenceId),
  check("mcp_event_deliveries_ack_state_check", sql`${t.ackState} IN ('pending','awaiting_ack','processed','waived','exhausted','cancelled')`),
  check("mcp_event_deliveries_recovery_attempts_check", sql`${t.recoveryAttempts} >= 0`),
  index("mcp_event_deliveries_ack_due").on(t.ackDueAt, t.tenantId, t.subscriptionId, t.occurrenceId)
    .where(sql`${t.ackState}='awaiting_ack'`),
]);
export const triggerMatches = app.table("trigger_matches", {
  tenantId: uuid("tenant_id").notNull(), id: uuid("id").notNull(), triggerId: uuid("trigger_id").notNull(), triggerRevision: integer("trigger_revision").notNull(), sourceIdentity: text("source_identity").notNull(), deduplicationKey: text("deduplication_key").notNull(), evidence: jsonb("evidence").notNull(), outcome: text("outcome").$type<"matched"|"pending"|"excluded"|"failed">().notNull(), pendingReason: text("pending_reason"), occurrenceId: uuid("occurrence_id"), createdAt: createdAt(), updatedAt: updatedAt(),
}, t => [primaryKey({columns:[t.tenantId,t.id]}),unique().on(t.tenantId,t.triggerId,t.triggerRevision,t.sourceIdentity,t.deduplicationKey),foreignKey({columns:[t.tenantId,t.triggerId],foreignColumns:[triggers.tenantId,triggers.id]}).onDelete("cascade"),foreignKey({columns:[t.tenantId,t.occurrenceId],foreignColumns:[eventOccurrences.tenantId,eventOccurrences.id]}).onDelete("set null"),index("trigger_matches_recent").on(t.tenantId,t.triggerId,t.createdAt)]);
// One-time cutover state; no legacy execution or configuration is retained.
export const webhookConditionsCutover = app.table("webhook_conditions_cutover", {
  tenantId: uuid("tenant_id").notNull(), eventId: uuid("event_id").notNull(), wasEnabled: boolean("was_enabled").notNull(), conditions: jsonb("conditions").$type<Record<string, unknown>>().notNull(), restoredAt: timestamp("restored_at", { withTimezone: true }),
}, t => [primaryKey({ columns: [t.tenantId, t.eventId] }), foreignKey({ columns: [t.tenantId, t.eventId], foreignColumns: [triggerSources.tenantId, triggerSources.id] }).onDelete("cascade")]);
export const scheduleState = app.table("schedule_state", { tenantId: uuid("tenant_id").notNull(), eventId: uuid("event_id").notNull(), triggerId: uuid("trigger_id").notNull(), nextRunAt: timestamp("next_run_at", { withTimezone: true }), lastFiredAt: timestamp("last_fired_at", { withTimezone: true }) }, t => [primaryKey({ columns: [t.tenantId, t.eventId] }), foreignKey({ columns: [t.tenantId, t.eventId], foreignColumns: [triggerSources.tenantId, triggerSources.id] }).onDelete("cascade"), foreignKey({ columns: [t.tenantId, t.triggerId], foreignColumns: [triggers.tenantId, triggers.id] }).onDelete("cascade"), index("schedules_due").on(t.nextRunAt).where(sql`${t.nextRunAt} is not null`)]);
export const triggerEditDeliveries = app.table("trigger_edit_deliveries", {
  tenantId: uuid("tenant_id").notNull(), deliveryId: uuid("delivery_id").notNull(), eventId: uuid("event_id").notNull(), sourceTriggerId: uuid("source_trigger_id").notNull(), editedAt: timestamp("edited_at", { withTimezone: true }).notNull(),
}, t => [primaryKey({ columns: [t.tenantId, t.deliveryId, t.eventId] }), foreignKey({ columns: [t.tenantId, t.eventId], foreignColumns: [triggerSources.tenantId, triggerSources.id] }).onDelete("cascade"), foreignKey({ columns: [t.tenantId, t.sourceTriggerId], foreignColumns: [triggers.tenantId, triggers.id] }).onDelete("cascade"), index("trigger_edit_deliveries_pending").on(t.editedAt, t.deliveryId)]);
export const triggerEvents = app.table("trigger_events", { tenantId: uuid("tenant_id").notNull(), id: uuid("id").notNull(), triggerId: uuid("trigger_id").notNull(), provider: text("provider").notNull(), deliveryId: text("delivery_id").notNull(), outcome: text("outcome").notNull(), detail: text("detail").notNull(), receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow() }, t => [primaryKey({ columns: [t.tenantId, t.id] }), foreignKey({ columns: [t.tenantId, t.triggerId], foreignColumns: [triggers.tenantId, triggers.id] }).onDelete("cascade"), index("trigger_events_by_trigger").on(t.tenantId, t.triggerId, t.receivedAt), index("trigger_events_retention").on(t.receivedAt,t.tenantId,t.id)]);
export const webhookDeliveries = app.table("webhook_deliveries", { tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }), id: uuid("id").notNull(), provider: text("provider").notNull(), deliveryId: text("delivery_id").notNull(), eventType: text("event_type").notNull().default("unknown"), eventAction: text("event_action").notNull().default("unknown"), outcome: text("outcome").notNull(), detail: text("detail").notNull(), receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow() }, t => [primaryKey({ columns: [t.tenantId, t.id] }), unique().on(t.tenantId, t.provider, t.deliveryId), index("webhook_deliveries_retention").on(t.receivedAt,t.tenantId,t.id).where(sql`${t.outcome} <> 'received'`)]);
export const webhookDeliveryEvents = app.table("webhook_delivery_events", { tenantId: uuid("tenant_id").notNull(), id: uuid("id").notNull(), deliveryId: uuid("delivery_id").notNull(), triggerId: uuid("trigger_id"), outcome: text("outcome").notNull(), detail: text("detail").notNull(), createdAt: createdAt() }, t => [primaryKey({ columns: [t.tenantId, t.id] }), foreignKey({ columns: [t.tenantId, t.deliveryId], foreignColumns: [webhookDeliveries.tenantId, webhookDeliveries.id] }).onDelete("cascade"), foreignKey({ columns: [t.tenantId, t.triggerId], foreignColumns: [triggers.tenantId, triggers.id] }).onDelete("cascade"), index("webhook_delivery_events_by_delivery").on(t.tenantId,t.deliveryId)]);
export const pendingVerifications = app.table("pending_verifications", { tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }), id: uuid("id").notNull(), triggerId: uuid("trigger_id").notNull(), eventId: uuid("event_id").notNull(), deliveryId: text("delivery_id").notNull(), installationId: bigint("installation_id", { mode: "number" }).notNull(), repositoryId: bigint("repository_id", { mode: "number" }).notNull(), repositoryOwner: text("repository_owner").notNull(), repositoryName: text("repository_name").notNull(), pullNumber: integer("pull_number").notNull(), attempt: integer("attempt").notNull().default(0), nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull(), payload: jsonb("payload").$type<Record<string, unknown>>().notNull() }, t => [primaryKey({ columns: [t.tenantId, t.id] }), foreignKey({ columns: [t.tenantId, t.triggerId], foreignColumns: [triggers.tenantId, triggers.id] }).onDelete("cascade"), foreignKey({ columns: [t.tenantId, t.eventId], foreignColumns: [triggerSources.tenantId, triggerSources.id] }).onDelete("cascade"), index("pending_verifications_due").on(t.nextAttemptAt)]);
export const tailFingerprints = app.table("tail_fingerprints", { tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }), triggerId: uuid("trigger_id").notNull(), fingerprint: text("fingerprint").notNull(), windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(), count: integer("count").notNull() }, t => [primaryKey({ columns: [t.tenantId, t.triggerId, t.fingerprint] }), foreignKey({ columns: [t.tenantId, t.triggerId], foreignColumns: [triggers.tenantId, triggers.id] }).onDelete("cascade")]);
export const wakeHints = app.table("wake_hints", { key: text("key").primaryKey().default("global"), notBefore: timestamp("not_before", { withTimezone: true }).notNull(), updatedAt: updatedAt() });
export const tenantRelations = relations(tenants, ({ many }) => ({ members: many(members), triggers: many(triggers), connections: many(connections) }));
export const triggerRelations = relations(triggers, ({ one, many }) => ({
  tenant: one(tenants, { fields: [triggers.tenantId], references: [tenants.id] }),
  sources: many(triggerSources),
}));
export const triggerSourceRelations = relations(triggerSources, ({ one }) => ({
  trigger: one(triggers, { fields: [triggerSources.tenantId, triggerSources.triggerId], references: [triggers.tenantId, triggers.id] }),
}));

export const databaseSchema = {
  teamSettings, schemaMigrations, tenants, oauthConnections, googleSignInAttempts, oauthConsentPreviews, authUsers, authAccounts, authResetTokens, authSessions, oauthDeviceAuthorizations, members, cloudflareConnections, cloudflareOauthAttempts, authTotp, authTotpRecoveryCodes, authTotpEnrollments, authTotpChallenges, authTotpLimits, accessTokens,
  connections, agentIntegrations, agentIdentities, agentProxyResponses, integrationCollections, integrationRecords, integrationChanges, linearWorkspaces, githubInstallations, githubSetupStates, eventDefinitions, eventDefinitionRevisions, eventOccurrences, mcpEventSubscriptions, mcpEventDeliveries, triggerMatches, triggers, triggerSources, webhookConditionsCutover,
  scheduleState, triggerEditDeliveries, triggerEvents, webhookDeliveries, webhookDeliveryEvents, pendingVerifications, tailFingerprints, wakeHints,
  tenantRelations, triggerRelations, triggerSourceRelations,
};
