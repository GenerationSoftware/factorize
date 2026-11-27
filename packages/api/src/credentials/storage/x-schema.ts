import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { tenants } from "../../postgres/identity-schema";
import { app, createdAt, updatedAt } from "../../postgres/schema-support";

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
