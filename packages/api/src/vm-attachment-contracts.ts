import { z } from "zod";

export const vmAttachment = z.object({
  id: z.string(),
  source: z.enum(["run", "client"]),
  sourceId: z.string(),
  sourceName: z.string().nullable(),
  vmId: z.string(),
  app: z.string().nullable(),
  provider: z.enum(["exe.dev", "fly.io"]),
  expiresAt: z.iso.datetime(),
  revokedAt: z.iso.datetime().nullable(),
  status: z.enum(["active", "expired", "revoked", "inactive", "pending"]),
});

export const vmAttachments = z.array(vmAttachment);
