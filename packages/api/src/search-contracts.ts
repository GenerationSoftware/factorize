import { z } from "zod";

export const searchRange = z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() });
export const searchResponse = z.object({ items: z.array(z.object({
  kind: z.enum(["job", "run", "trace"]), id: z.string(), title: z.string(), subtitle: z.string(), url: z.string(),
  source: z.object({ kind: z.enum(["job", "run", "trace"]), label: z.string(), id: z.string() }),
  match: z.object({ text: z.string(), ranges: z.array(searchRange) }),
})) });
