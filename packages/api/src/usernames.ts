import { z } from "zod";
export const usernameSchema = z.string().trim().toLowerCase().min(3).max(39).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and single hyphens between segments.");
export const profileInput = z.object({ username: usernameSchema }).strict();
export const profileResponse = z.object({ username: usernameSchema, email: z.email() }).strict();
