import { relations } from "drizzle-orm";

import { tenants, members } from "./identity-schema";
import { connections } from "../credentials/storage/schema";
import { triggers, triggerSources } from "../triggers/storage/schema";

export const tenantRelations = relations(tenants, ({ many }) => ({ members: many(members), triggers: many(triggers), connections: many(connections) }));

export const triggerRelations = relations(triggers, ({ one, many }) => ({
  tenant: one(tenants, { fields: [triggers.tenantId], references: [tenants.id] }),
  sources: many(triggerSources),
}));

export const triggerSourceRelations = relations(triggerSources, ({ one }) => ({
  trigger: one(triggers, { fields: [triggerSources.tenantId, triggerSources.triggerId], references: [triggers.tenantId, triggers.id] }),
}));
