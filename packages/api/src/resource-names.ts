import { z } from "zod";

// `manual` is reserved in this namespace.
export const RESOURCE_NAME = /^(?=.{1,64}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const resourceName = z.string().regex(RESOURCE_NAME, "Use 1–64 lowercase letters, digits, and single hyphens, without leading or trailing hyphens.")
  .refine(name => name !== "manual", "The name manual is reserved.");
