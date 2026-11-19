import { z } from "zod";
import { validPath } from "./skill-files";

export const librarySource = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("managed") }).strict(),
  z
    .object({
      kind: z.literal("github"),
      installationId: z.number().int().positive(),
      repositoryId: z.number().int().positive(),
      branch: z
        .string()
        .min(1)
        .max(255)
        .regex(/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/)
        .refine((value) => !value.includes("..") && validPath(value)),
      folder: z
        .string()
        .max(512)
        .refine((value) => value === "" || validPath(value)),
    })
    .strict(),
]);
export type LibrarySource = z.infer<typeof librarySource>;
export const libraryStatus = z.object({
  source: librarySource.nullable(),
  remote: z.string().nullable(),
  commit: z.string().nullable(),
  upstreamCommit: z.string().nullable(),
  error: z.string().nullable(),
});
export const libraryToken = z.object({ remote: z.string(), token: z.string(), expiresAt: z.string() });
