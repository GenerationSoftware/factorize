import { inputMapping } from "../../events/api/event-enrichment-contracts";
import { z } from "zod";
import { triggerInputSchema, triggerSourceSchema, webhookSourceConfigSchema } from "./trigger-schemas";

const triggerSourceIdentity = { id: z.guid(), triggerId: z.guid(), slug: z.string(), createdAt: z.string(), updatedAt: z.string() };
const webhookResponse = z.discriminatedUnion("provider", [
  webhookSourceConfigSchema.options[0].extend({ secretConfigured: z.boolean().optional() }).strip(),
  webhookSourceConfigSchema.options[1].extend({ secretConfigured: z.boolean().optional() }).strip(),
  webhookSourceConfigSchema.options[2].extend({ secretConfigured: z.boolean().optional() }).strip(),
  webhookSourceConfigSchema.options[3].extend({ destination: z.string().optional(), secretConfigured: z.boolean().optional() }).strip(),
]);
export const triggerSourceResponse = z.discriminatedUnion("kind", [
  triggerSourceSchema.options[0].extend(triggerSourceIdentity),
  triggerSourceSchema.options[1].extend(triggerSourceIdentity),
  triggerSourceSchema.options[2].extend({ ...triggerSourceIdentity, config: webhookResponse }),
]);
export const triggerResponse = z.object({ inputMapping: inputMapping.optional(), id: z.guid(), name: z.string(), description: z.string(), enabled: z.boolean(), eventId: z.guid(), sources: z.array(triggerSourceResponse), createdAt: z.string(), updatedAt: z.string() });
// Omission preserves last-writer-wins behavior for existing REST/MCP clients.
export const triggerUpdateInput = triggerInputSchema.extend({ expectedUpdatedAt: z.iso.datetime().optional() });
