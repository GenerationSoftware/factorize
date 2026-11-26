import { z } from "zod";
import { vmPermissionSource } from "./vm-permissions";

const providerTarget = z.strictObject({
  kind: z.literal("machine"),
  providerId: z.uuid(),
  vm: z.string().regex(/^[a-zA-Z0-9-]{1,64}$/),
  app: z.string().regex(/^[a-z0-9-]{1,64}$/).optional(),
  requestKey: z.string().min(1).max(200),
});
const existingGrant = z.strictObject({
  kind: z.literal("existing"),
  grantId: z.uuid(),
  expectedRevision: z.number().int().positive(),
});

export const vmGrantInput = z.strictObject({
  target: z.discriminatedUnion("kind", [providerTarget, existingGrant]),
  permissions: vmPermissionSource,
});
export const vmGrantRef = z.strictObject({ grantId: z.uuid() });
export const vmGrantView = z.object({
  id: z.uuid(),
  providerId: z.uuid(),
  provider: z.enum(["exe.dev", "fly.io"]),
  vm: z.string(),
  app: z.string().nullable(),
  scopes: z.array(z.string()),
  revision: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const vmGrantList = z.array(vmGrantView);
export const vmGrantResult = vmGrantView.extend({
  authentication: z.object({
    audience: z.string(),
    guestKeyPath: z.string(),
  }),
});
export const vmRevokeResult = z.object({ id: z.uuid(), revoked: z.literal(true) });
