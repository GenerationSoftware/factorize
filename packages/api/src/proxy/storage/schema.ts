import { foreignKey, index, integer, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { agentIdentities } from "../../access-control/storage/schema";
import { agentIntegrations } from "../../credentials/storage/schema";
import { app } from "../../postgres/schema-support";

export const agentProxyResponses = app.table("agent_proxy_responses", {
  tenantId:uuid("tenant_id").notNull(),id:uuid("id").notNull(),identityId:uuid("identity_id").notNull(),integrationId:uuid("integration_id").notNull(),integrationEpoch:integer("integration_epoch").notNull(),objectKey:text("object_key").notNull().unique(),size:integer("size"),expiresAt:timestamp("expires_at",{withTimezone:true}).notNull(),
},t=>[primaryKey({columns:[t.tenantId,t.id]}),foreignKey({columns:[t.tenantId,t.identityId],foreignColumns:[agentIdentities.tenantId,agentIdentities.id]}),foreignKey({columns:[t.tenantId,t.integrationId],foreignColumns:[agentIntegrations.tenantId,agentIntegrations.id]}),index("agent_proxy_response_expiry").on(t.expiresAt)]);
