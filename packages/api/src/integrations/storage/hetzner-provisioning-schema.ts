import { bigint, primaryKey, text, unique, uuid } from "drizzle-orm/pg-core";
import { authUsers, tenants } from "../../postgres/identity-schema";
import { app, createdAt } from "../../postgres/schema-support";

export const hetznerServerRequests = app.table("hetzner_server_requests", {
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  ownerId: uuid("owner_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  installationId: text("installation_id").notNull(),
  requestId: uuid("request_id").notNull(),
  projectRevision: uuid("project_revision").notNull(),
  ticket: uuid("ticket").notNull().unique(),
  name: text("name").notNull(),
  serverType: text("server_type").notNull(),
  location: text("location").notNull(),
  serverId: bigint("server_id", { mode: "number" }),
  createdAt: createdAt(),
}, t => [
  primaryKey({ columns: [t.tenantId, t.ownerId, t.installationId, t.requestId] }),
  unique().on(t.tenantId, t.projectRevision, t.name),
  unique().on(t.tenantId, t.projectRevision, t.serverId),
]);
