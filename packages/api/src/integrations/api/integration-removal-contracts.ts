import { z } from "zod";

export const integrationRemovalKind = z.enum(["linear", "exe", "amp", "github", "cloudflareTail", "cloudflare", "fly", "bearer", "ghcr"]);
export const integrationRemovalTarget = z.strictObject({ kind: integrationRemovalKind, id: z.string().min(1).max(128) });
export const integrationRemovalConfirmation = integrationRemovalTarget.extend({ fingerprint: z.string().min(1).max(128), confirmImpact: z.boolean() });
const object = z.object({id: z.string(), name: z.string()});
export const integrationRemovalPreview = z.object({
  fingerprint: z.string(), needsConfirmation: z.boolean(),
  sources: z.array(z.object({id: z.string(), triggerId: z.string(), triggerName: z.string(), eventId: z.string(), eventName: z.string(), sourceName: z.string(), deleteTrigger: z.boolean()})),
  lookups: z.array(z.object({eventId: z.string(), eventName: z.string(), name: z.string(), cascaded: z.boolean()})),
  pausedEvents: z.array(object), clients: z.array(object), workloads: z.array(object.extend({revoked: z.boolean()})),
});
export type IntegrationRemovalTarget = z.infer<typeof integrationRemovalTarget>;
