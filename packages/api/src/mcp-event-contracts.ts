import { z } from "zod";

const meta = z.record(z.string(), z.unknown()).optional();
const eventName = z.templateLiteral(["factorize.event.", z.uuid()]).refine(name => name === name.toLowerCase());
export const eventProtocolName = (definitionId: string) => `factorize.event.${definitionId}`;
export const eventDefinitionId = (name: string) => name.slice("factorize.event.".length);

const argumentsSchema = z.strictObject({});
const target = z.object({ mode: z.literal("webhook"), url: z.string().max(2048) });
const subscriptionIdentity = {
  name: eventName, arguments: argumentsSchema.default({}), _meta: meta,
};
export const subscribeEventInput = z.strictObject({
  ...subscriptionIdentity,
  delivery: target.extend({ secret: z.string().max(100) }).strict(),
  cursor: z.null().optional(),
  ttlMs: z.number().int().positive().nullable().optional(),
});
export const unsubscribeEventInput = z.strictObject({
  ...subscriptionIdentity,
  delivery: target.partial({ mode: true }).strict(),
});
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
