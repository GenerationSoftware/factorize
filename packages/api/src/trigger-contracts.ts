import { z } from "zod";
import { triggerInputSchema, triggerSourceSchema, webhookEventConfigSchema } from "./trigger-schemas";

const triggerSourceIdentity = { id: z.guid(), triggerId: z.guid(), slug: z.string(), createdAt: z.string(), updatedAt: z.string() };
const webhookResponse = z.discriminatedUnion("provider", [
  webhookEventConfigSchema.options[0].extend({ secretConfigured: z.boolean().optional() }).strip(),
  webhookEventConfigSchema.options[1].extend({ secretConfigured: z.boolean().optional() }).strip(),
  webhookEventConfigSchema.options[2].extend({ secretConfigured: z.boolean().optional() }).strip(),
  webhookEventConfigSchema.options[3].extend({ destination: z.string().optional(), secretConfigured: z.boolean().optional() }).strip(),
]);
export const triggerSourceResponse = z.discriminatedUnion("kind", [
  triggerSourceSchema.options[0].extend(triggerSourceIdentity),
  triggerSourceSchema.options[1].extend(triggerSourceIdentity),
  triggerSourceSchema.options[2].extend({ ...triggerSourceIdentity, config: webhookResponse }),
]);
export const triggerResponse = z.object({ id: z.guid(), name: z.string(), description: z.string(), enabled: z.boolean(), eventId: z.guid(), events: z.array(triggerSourceResponse), createdAt: z.string(), updatedAt: z.string() });
// Omission preserves last-writer-wins behavior for existing REST/MCP clients.
export const triggerUpdateInput = triggerInputSchema.extend({ expectedUpdatedAt: z.iso.datetime().optional() });
