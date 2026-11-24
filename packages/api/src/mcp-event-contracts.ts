import { z } from "zod";

const meta = z.record(z.string(), z.unknown()).optional();
export const occurrenceEventName = "factorize.occurrence";
const legacyPrefix = "factorize.event.";
const legacyName = z.templateLiteral([legacyPrefix, z.uuid()]).refine(name => name === name.toLowerCase());
const occurrenceArguments = z.strictObject({ event_id: z.uuid().transform(id => id.toLowerCase()) });
const legacyArguments = z.strictObject({});
const target = z.object({ mode: z.literal("webhook"), url: z.string().max(2048) });
const stableIdentity = { name: z.literal(occurrenceEventName), arguments: occurrenceArguments, _meta: meta };
const legacyIdentity = { name: legacyName, arguments: legacyArguments.default({}), _meta: meta };
const subscribeFields = {
  delivery: target.extend({ secret: z.string().max(100) }).strict(),
  cursor: z.null().optional(),
  ttlMs: z.number().int().positive().nullable().optional(),
};
const unsubscribeFields = { delivery: target.partial({ mode: true }).strict() };
export const subscribeEventInput = z.union([
  z.strictObject({ ...stableIdentity, ...subscribeFields }),
  z.strictObject({ ...legacyIdentity, ...subscribeFields }),
]);
export const unsubscribeEventInput = z.union([
  z.strictObject({ ...stableIdentity, ...unsubscribeFields }),
  z.strictObject({ ...legacyIdentity, ...unsubscribeFields }),
]);

type SubscriptionIdentity = Pick<z.infer<typeof unsubscribeEventInput>, "name" | "arguments">;
export function eventDefinitionId(input: SubscriptionIdentity) {
  return "event_id" in input.arguments ? input.arguments.event_id : input.name.slice(legacyPrefix.length);
}

// Empty persisted arguments identify the legacy protocol. Keep its signed
// envelope name unchanged while existing subscriptions migrate organically.
export function deliveryEventName(definitionId: string, args: unknown) {
  const stable = occurrenceArguments.safeParse(args);
  if (stable.success) return stable.data.event_id === definitionId ? occurrenceEventName : null;
  return legacyArguments.safeParse(args).success ? legacyPrefix + definitionId : null;
}
export const occurrenceInputSchema = {
  type: "object",
  properties: { event_id: { type: "string", format: "uuid", description: "Factorize Event UUID from create_event or list_events." } },
  required: ["event_id"],
  additionalProperties: false,
};

export const listEventsInput = z.strictObject({ cursor: z.uuid().optional(), _meta: meta });

export const eventPayloadSchema = {
  type: "object",
  properties: {
    occurrenceId: { type: "string", format: "uuid" },
    definitionId: { type: "string", format: "uuid" },
  },
  required: ["occurrenceId", "definitionId"],
  additionalProperties: false,
};

export const readEventOccurrencesInput = z.union([
  z.strictObject({ occurrenceId: z.uuid() }),
  z.strictObject({
    definitionId: z.uuid(),
    since: z.iso.datetime({ offset: true }).describe("Inclusive ISO timestamp for when Factorize recorded the occurrence."),
    cursor: z.string().max(512).optional(),
    limit: z.number().int().min(1).max(100).default(50),
  }),
]);
export type ReadEventOccurrencesInput = z.infer<typeof readEventOccurrencesInput>;


export const readEventDeliveryDiagnosticsInput = z.strictObject({ occurrenceId: z.uuid() });
