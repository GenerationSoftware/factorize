import { sql } from "drizzle-orm";
import { bigint, boolean, check, foreignKey, index, integer, jsonb, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { authUsers, members } from "../../postgres/identity-schema";
import { app, createdAt, updatedAt } from "../../postgres/schema-support";

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
