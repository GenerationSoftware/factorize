import { z } from "zod";
export const cloneInfo = z.object({ source: z.enum(["managed", "github"]).nullable(), url: z.string().nullable(), writable: z.boolean(), branch: z.string(), folder: z.string() });
export const gitCredential = z.object({ username: z.literal("git"), token: z.string(), expiresAt: z.iso.datetime() });
