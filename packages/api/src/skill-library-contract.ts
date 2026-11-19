import { z } from "zod";
import { validPath } from "./skill-files";

const nativeSource = z.object({ kind: z.literal("managed") }).strict();
const githubSource = z
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
  .strict();
export const librarySource = z.discriminatedUnion("kind", [nativeSource, githubSource]);
export const configureLibrary = z.discriminatedUnion("kind", [
  nativeSource,
  githubSource.extend({
    confirmOverwrite: z
      .literal(true)
      .optional()
      .describe(
        "Required when changing to a GitHub source. Replaces the active library, including deletions.",
      ),
  }),
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
