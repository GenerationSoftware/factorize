import { foreignKey, index, integer, jsonb, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { tenants } from "../../postgres/identity-schema";
import { app, createdAt, updatedAt } from "../../postgres/schema-support";

export const eventDefinitions = app.table("event_definitions", {
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }), id: uuid("id").notNull(),
  name: text("name").notNull(), description: text("description").notNull().default(""), currentRevision: integer("current_revision").notNull(), createdAt: createdAt(), updatedAt: updatedAt(),
}, t => [primaryKey({ columns: [t.tenantId,t.id] }), unique().on(t.tenantId,t.name)]);

export const eventDefinitionRevisions = app.table("event_definition_revisions", {
  tenantId: uuid("tenant_id").notNull(), definitionId: uuid("definition_id").notNull(), revision: integer("revision").notNull(),
  payloadSchema: jsonb("payload_schema").$type<Record<string,unknown>>().notNull().default({type:"object"}),
  createdAt: createdAt(),
}, t => [primaryKey({columns:[t.tenantId,t.definitionId,t.revision]}),foreignKey({columns:[t.tenantId,t.definitionId],foreignColumns:[eventDefinitions.tenantId,eventDefinitions.id]}).onDelete("cascade")]);

export const eventOccurrences = app.table("event_occurrences", {
  tenantId: uuid("tenant_id").notNull(), id: uuid("id").notNull(), definitionId: uuid("definition_id").notNull(), definitionRevision: integer("definition_revision").notNull(),
  occurredAt: timestamp("occurred_at", {withTimezone:true}).notNull().defaultNow(), payload: jsonb("payload").$type<Record<string,unknown>>().notNull(),
  producerIdentity: jsonb("producer_identity").$type<Record<string,unknown>>().notNull(), evidence: jsonb("evidence").notNull().default([]), sourceIdentity: text("source_identity").notNull(), idempotencyKey: text("idempotency_key").notNull(), createdAt: createdAt(),
}, t => [primaryKey({columns:[t.tenantId,t.id]}),unique().on(t.tenantId,t.sourceIdentity,t.idempotencyKey),foreignKey({columns:[t.tenantId,t.definitionId,t.definitionRevision],foreignColumns:[eventDefinitionRevisions.tenantId,eventDefinitionRevisions.definitionId,eventDefinitionRevisions.revision]}).onDelete("cascade"),index("event_occurrences_by_definition").on(t.tenantId,t.definitionId,t.occurredAt,t.id),index("event_occurrences_recorded").on(t.tenantId,t.definitionId,t.createdAt,t.id)]);
