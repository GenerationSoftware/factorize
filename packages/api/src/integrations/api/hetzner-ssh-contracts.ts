import { z } from "zod";

export const hetznerServerId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const hetznerSshEnrollment = z.strictObject({
  serverId: hetznerServerId,
  username: z.string().min(1).max(32).regex(/^[a-z_][a-z0-9_-]*$/).refine(value => value !== "root"),
  hostFingerprint: z.string().regex(/^SHA256:[A-Za-z0-9+/]{43}$/),
  clientInstallationId: z.string().min(1).max(512).optional(), // Requires the separate live Hetzner checkbox at check time.
});
export const hetznerSshTarget = hetznerSshEnrollment.extend({ publicKey: z.string() });
export const hetznerSshResult = z.strictObject({ serverId: hetznerServerId, authenticated: z.literal(true), reusedConnection: z.boolean() });
export const hetznerSshToolInput = z.strictObject({ serverId: hetznerServerId });
export type HetznerSshEnrollment = z.infer<typeof hetznerSshEnrollment>;
