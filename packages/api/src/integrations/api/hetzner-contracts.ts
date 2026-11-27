import { z } from "zod";

export const hetznerConnectionInput = z.strictObject({
  name: z.string().trim().min(1).max(120),
  nativeWritesEnabled: z.boolean().optional(),
  token: z.string().trim().min(1).max(256).regex(/^[A-Za-z0-9_-]+$/).meta({ writeOnly: true }),
});
export const hetznerConnectionMetadata = z.object({ name: z.string(), nativeWritesEnabled: z.boolean().optional() });
export const hetznerServer = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(255),
  status: z.string().min(1).max(64),
  location: z.string().min(1).max(64).nullable(),
});
export const hetznerInventory = z.object({ servers: z.array(hetznerServer).max(100), truncated: z.boolean() });
