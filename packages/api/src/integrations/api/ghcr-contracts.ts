import { z } from "zod";

export const ghcrImage = z.string().trim().max(255).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:(?:[.]|_{1,2}|-+)[a-z0-9]+)*)+$/);
const username = z.string().trim().min(1).max(39).regex(/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/);
const token = z.string().trim().regex(/^[A-Za-z0-9_]{16,255}$/).meta({ writeOnly: true });
export const ghcrCreate = z.strictObject({ image: ghcrImage, username, token });
export const ghcrReplace = z.strictObject({ username, token, expectedRevision: z.number().int().min(0).max(2147483646) });
export const ghcrConnection = z.object({ id: z.uuid(), image: ghcrImage, username, revision: z.number().int().nonnegative() });
export type GhcrConnection = z.infer<typeof ghcrConnection>;
