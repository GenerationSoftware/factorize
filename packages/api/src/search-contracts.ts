import { z } from "zod";
export const searchResponse = z.object({ items: z.array(z.object({ kind: z.enum(["job", "run"]), id: z.string(), title: z.string(), subtitle: z.string(), url: z.string() })) });
