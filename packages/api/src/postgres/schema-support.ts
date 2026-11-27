import { pgSchema, timestamp } from "drizzle-orm/pg-core";

export const app = pgSchema("app");
export const createdAt = () => timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();
export const updatedAt = () => timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();
