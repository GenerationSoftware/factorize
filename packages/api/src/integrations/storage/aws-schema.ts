import { index, integer, text, uuid } from "drizzle-orm/pg-core";
import { authUsers, tenants } from "../../postgres/identity-schema";
import { app, createdAt } from "../../postgres/schema-support";

export const awsConnections = app.table("aws_connections", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  region: text("region").notNull(),
  roleArn: text("role_arn"),
  oauthInstallationId: text("oauth_installation_id"),
  revision: integer("revision").notNull().default(0),
  createdAt: createdAt(),
}, t => [index("aws_connections_owner_idx").on(t.tenantId, t.userId)]);
