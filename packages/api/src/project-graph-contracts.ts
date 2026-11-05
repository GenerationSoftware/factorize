import { z } from "zod";

export const projectGraphResponse = z.object({
  nodes: z.array(z.object({ id: z.string(), type: z.enum(["job", "webhook"]), label: z.string(), jobKind: z.enum(["Agent", "Code"]).optional(), enabled: z.boolean().optional(), provider: z.string().optional(), resource: z.string().optional() })),
  edges: z.array(z.object({ id: z.string(), source: z.string(), target: z.string(), label: z.string(), kind: z.enum(["lifecycle", "idle", "manual", "webhook"]), enabled: z.boolean() })),
});
