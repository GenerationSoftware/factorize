import { z } from "zod";

export const okResult = z.object({ ok: z.boolean() });
