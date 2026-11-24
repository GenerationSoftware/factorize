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

const recoveryCursor = z.tuple([z.uuid(), z.iso.datetime({ offset: true }), z.iso.datetime(), z.uuid()]);
export function parseOccurrenceCursor(cursor: string, definitionId: string, since: string) {
  try {
    const value = recoveryCursor.parse(JSON.parse(atob(cursor)));
    if (value[0] === definitionId && value[1] === since && Date.parse(value[2]) >= Date.parse(since)) return value;
  } catch { /* The caller converts malformed cursors to a validation error. */ }
  return null;
}

export const eventSubscriptionId = z.string().regex(/^sub_[a-f0-9]{64}$/);
export const eventSubscription = z.object({
  id: eventSubscriptionId,
  eventId: z.uuid(),
  eventName: z.string(),
  grantId: z.string(),
  status: z.enum(["active", "expired", "stopped"]),
  acknowledgmentMode: z.enum(["required", "off"]),
  expiresAt: z.iso.datetime(),
});
export const eventSubscriptionList = z.array(eventSubscription);
