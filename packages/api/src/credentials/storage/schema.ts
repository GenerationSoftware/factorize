import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { tenants, authUsers } from "../../postgres/identity-schema";
import { app, createdAt, updatedAt } from "../../postgres/schema-support";

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

export const connections = app.table("connections", { tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }), kind: text("kind").notNull(), encryptedValue: text("encrypted_value").notNull(), updatedAt: updatedAt() }, t => [primaryKey({ columns: [t.tenantId, t.kind] })]);

export const integrationCollections = app.table("integration_collections", {
  tenantId: uuid("tenant_id").primaryKey().references(() => tenants.id, { onDelete: "cascade" }), revision: bigint("revision", { mode: "number" }).notNull().default(0), createdAt: createdAt(), updatedAt: updatedAt(),
});

export const integrationRecords = app.table("integration_records", {
  tenantId: uuid("tenant_id").notNull().references(() => integrationCollections.tenantId, { onDelete: "cascade" }), id: uuid("id").notNull(), kind: text("kind").$type<"bearer">().notNull(), name: text("name").notNull(), origin: text("origin"), description: text("description"), revision: bigint("revision", { mode: "number" }).notNull(), encryptedPayload: text("encrypted_payload"), deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }), createdAt: createdAt(), updatedAt: updatedAt(),
}, t => [primaryKey({ columns: [t.tenantId, t.id] }), uniqueIndex("integration_records_active_name").on(t.tenantId, t.kind, sql`lower(${t.name})`).where(sql`${t.deletedAt} is null`), index("integration_records_collection_order").on(t.tenantId, t.revision, t.id), check("integration_records_kind_check", sql`${t.kind} = 'bearer'`), check("integration_records_origin_check", sql`${t.origin} IS NOT NULL`), check("integration_records_payload_check", sql`(${t.deletedAt} IS NULL AND ${t.encryptedPayload} IS NOT NULL) OR (${t.deletedAt} IS NOT NULL AND ${t.encryptedPayload} IS NULL)`)]);

export const agentIntegrations = app.table("agent_integrations", {
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, {onDelete:"cascade"}), id: uuid("id").notNull().defaultRandom(),
  kind: text("kind").$type<"bearer"|"github"|"linear"|"fly"|"exe"|"amp"|"clickup"|"x"|"cloudflare">().notNull(), credentialId: text("credential_id").notNull(), name:text("name").notNull(), description:text("description"), available:boolean("available").notNull(),
  policy:text("policy").$type<"baseline"|"requestable"|"disabled">().notNull().default("requestable"),epoch:integer("epoch").notNull().default(1),revision:integer("revision").notNull().default(1),
},t=>[primaryKey({columns:[t.tenantId,t.id]}),unique().on(t.tenantId,t.kind,t.credentialId)]);

export const integrationChanges = app.table("integration_changes", {
  tenantId: uuid("tenant_id").notNull().references(() => integrationCollections.tenantId, { onDelete: "cascade" }), revision: bigint("revision", { mode: "number" }).notNull(), id: uuid("id").notNull(), idempotencyKey: uuid("idempotency_key").notNull(), operation: text("operation").$type<"upsert" | "delete">().notNull(), recordId: uuid("record_id").notNull(), kind: text("kind").$type<"bearer">().notNull(), name: text("name").notNull(), origin: text("origin"), description: text("description"), encryptedPayload: text("encrypted_payload"), createdAt: createdAt(),
}, t => [primaryKey({ columns: [t.tenantId, t.revision] }), unique().on(t.tenantId, t.idempotencyKey), index("integration_changes_page").on(t.tenantId, t.revision), check("integration_changes_operation_check", sql`${t.operation} IN ('upsert','delete')`), check("integration_changes_kind_check", sql`${t.kind} = 'bearer'`), check("integration_changes_origin_check", sql`${t.origin} IS NOT NULL`), check("integration_changes_payload_check", sql`(${t.operation} = 'upsert' AND ${t.encryptedPayload} IS NOT NULL) OR (${t.operation} = 'delete' AND ${t.encryptedPayload} IS NULL)`)]);

export const linearWorkspaces = app.table("linear_workspaces", { organizationId: uuid("organization_id").primaryKey(), tenantId: uuid("tenant_id").notNull().unique().references(() => tenants.id, { onDelete: "cascade" }) });

export const githubInstallations = app.table("github_installations", { installationId: bigint("installation_id", { mode: "number" }).primaryKey(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }), accountLogin: text("account_login").notNull(), accountType: text("account_type").notNull(), state: text("state").$type<"active" | "suspended">().notNull(), updatedAt: updatedAt() }, t => [unique().on(t.tenantId, t.installationId), check("github_installations_state_check", sql`${t.state} in ('active','suspended')`)]);

export const githubSetupStates = app.table("github_setup_states", { tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }), nonce: text("nonce").notNull(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), usedAt: timestamp("used_at", { withTimezone: true }) }, t => [primaryKey({ columns: [t.tenantId, t.nonce] }), index("github_setup_states_expiration").on(t.expiresAt,t.tenantId,t.nonce)]);
