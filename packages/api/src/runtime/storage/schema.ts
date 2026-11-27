import { primaryKey, text, timestamp } from "drizzle-orm/pg-core";

import { app, updatedAt } from "../../postgres/schema-support";

export const wakeHints = app.table("wake_hints", { key: text("key").primaryKey().default("global"), notBefore: timestamp("not_before", { withTimezone: true }).notNull(), updatedAt: updatedAt() });
