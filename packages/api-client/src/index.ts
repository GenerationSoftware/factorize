import createClient from "openapi-fetch";
import type { paths } from "./schema";

export type { paths, components, operations } from "./schema";
// Same-origin HttpOnly cookies; no browser token storage or backend imports.
export const api = createClient<paths>({ credentials: "same-origin" });
