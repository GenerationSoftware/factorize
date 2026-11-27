import { sql } from "drizzle-orm";
import { boolean, check, integer, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { app, createdAt, updatedAt } from "./schema-support";

export const schemaMigrations = app.table("schema_migrations", {
  version: text("version").primaryKey(), appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tenants = app.table("tenants", { id: uuid("id").primaryKey(), personalOwnerId:uuid("personal_owner_id").references(()=>authUsers.id), name: text("name"), createdAt: createdAt(), updatedAt: updatedAt() });

export const teamSettings = app.table("team_settings", {
  tenantId: uuid("tenant_id").primaryKey().references(() => tenants.id, { onDelete: "cascade" }),
  updatedAt: updatedAt(),
});

export const authUsers = app.table("auth_users", { id: uuid("id").primaryKey(), username:text("username").notNull().unique("auth_users_username_unique").default(sql`'user-' || replace(gen_random_uuid()::text,'-','')`), email: text("email").notNull().unique(), emailVerified: boolean("email_verified").notNull().default(false), googleRecoveryManaged: boolean("google_recovery_managed").notNull().default(false), googleRecoveryAddressConfirmed: boolean("google_recovery_address_confirmed").notNull().default(false), googleRecoveryCandidate: text("google_recovery_candidate"), googleRecoverySuspended: boolean("google_recovery_suspended").notNull().default(false), googleRecoveryObservedAt: integer("google_recovery_observed_at").notNull().default(0), googleRecoveryRevision: integer("google_recovery_revision").notNull().default(0), createdAt: createdAt() }, t => [uniqueIndex("auth_users_email_normalized").on(sql`lower(${t.email})`)]);

export const members = app.table("members", {
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }), userId: uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }), email: text("email").notNull(), role: text("role").$type<"owner" | "member">().notNull(), sessionVersion: integer("session_version").notNull().default(1), createdAt: createdAt(),
}, t => [primaryKey({ columns: [t.tenantId, t.userId] }), check("members_role_check", sql`${t.role} in ('owner','member')`), check("members_session_version_check", sql`${t.sessionVersion} > 0`)]);
