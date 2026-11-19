import { z } from "zod";
import { storedRunDefaults } from "./flow-schemas";
export const projectResponse = z.object({ id: z.guid(), name: z.string(), description: z.string().optional(), createdAt: z.string(), updatedAt: z.string(), runDefaults:storedRunDefaults.optional(), jobCount: z.number().int() });
export const projectListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(100),
  sort: z.enum(["name", "updated"]).default("name"),
});
export const projectInput = z.object({ name: z.string().trim().min(1).max(120), description: z.string().trim().max(2000).optional() }).strict();
