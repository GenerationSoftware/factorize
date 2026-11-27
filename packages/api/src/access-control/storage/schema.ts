import { sql } from "drizzle-orm";
import { boolean, foreignKey, index, integer, jsonb, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { tenants, members } from "../../postgres/identity-schema";
import { app, createdAt, updatedAt } from "../../postgres/schema-support";

export const accessTokens = app.table("access_tokens", {
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }), id: uuid("id").notNull(), name: text("name").notNull(), digest: text("digest").notNull().unique(), userId: uuid("user_id").notNull(), sessionVersion: integer("session_version").notNull(), scopes: jsonb("scopes").$type<string[]>().notNull().default([]), createdAt: createdAt(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), lastUsedAt: timestamp("last_used_at", { withTimezone: true }), revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, t => [primaryKey({ columns: [t.tenantId, t.id] }), foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [members.tenantId, members.userId] }).onDelete("cascade"), index("access_tokens_expiration").on(t.expiresAt,t.tenantId,t.id)]);

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
