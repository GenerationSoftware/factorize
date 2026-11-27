import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, jsonb, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { eventDefinitions, eventOccurrences } from "../../events/storage/schema";
import { app, updatedAt } from "../../postgres/schema-support";

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
