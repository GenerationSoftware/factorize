import { z } from "zod";

export const eventDefinitionInput = z.object({
  name: z.string().trim().regex(/^[a-z][a-z0-9_.-]{0,127}$/),
  description: z.string().max(2000).default(""),
  payloadSchema: z.record(z.string(), z.unknown()).default({ type: "object" }),
}).strict();
export const eventDefinitionUpdate = eventDefinitionInput.extend({ expectedRevision: z.number().int().positive() }).strict();
export const eventDefinitionResponse = z.object({ id: z.uuid(), name: z.string(), description: z.string(), revision: z.number().int().positive(), payloadSchema: z.record(z.string(), z.unknown()), createdAt: z.string(), updatedAt: z.string() });
export const eventDefinitionList = z.array(eventDefinitionResponse.extend({ triggerCount: z.number().int(), occurrenceCount: z.number().int() }));
export const eventOccurrencePage = z.object({ items: z.array(z.object({ id: z.uuid(), revision: z.number().int(), occurredAt: z.string(), payload: z.record(z.string(), z.unknown()), producer: z.record(z.string(), z.unknown()), createdAt: z.string() })), nextCursor: z.string().optional() });
export const eventOccurrenceQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.uuid().optional() });
