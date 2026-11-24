import { z } from "zod";
import { triggerInputSchema, eventSchema, webhookEventConfigSchema } from "./flow-schemas";

const eventIdentity = { id: z.guid(), triggerId: z.guid(), slug: z.string(), createdAt: z.string(), updatedAt: z.string() };
const webhookResponse = z.discriminatedUnion("provider", [
  webhookEventConfigSchema.options[0].extend({ secretConfigured: z.boolean().optional() }).strip(),
  webhookEventConfigSchema.options[1].extend({ secretConfigured: z.boolean().optional() }).strip(),
  webhookEventConfigSchema.options[2].extend({ secretConfigured: z.boolean().optional() }).strip(),
  webhookEventConfigSchema.options[3].extend({ destination: z.string().optional(), secretConfigured: z.boolean().optional() }).strip(),
]);
export const eventResponse = z.discriminatedUnion("kind", [
  eventSchema.options[0].extend(eventIdentity),
  eventSchema.options[1].extend(eventIdentity),
  eventSchema.options[2].extend({ ...eventIdentity, config: webhookResponse }),
]);
export const triggerResponse = z.object({ id: z.guid(), name: z.string(), description: z.string(), enabled: z.boolean(), eventId: z.guid(), events: z.array(eventResponse), createdAt: z.string(), updatedAt: z.string() });
// Omission preserves last-writer-wins behavior for existing REST/MCP clients.
export const triggerUpdateInput = triggerInputSchema.extend({ expectedUpdatedAt: z.iso.datetime().optional() });
