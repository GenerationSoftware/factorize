import { z } from "zod";
export const integrationScopePattern = /^integration:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([1-9][0-9]{0,9})$/;
export const isIntegrationScope = (scope: string) => integrationScopePattern.test(scope);
export const integrationRef = z.uuid();
export const apiPolicyInput = z.object({ policy: z.enum(["baseline", "requestable", "disabled"]), expectedRevision: z.number().int().positive() }).strict();
export const apiPolicy = z.object({ id: integrationRef, name: z.string(), description: z.string().nullable(), kind: z.enum(["bearer", "github", "linear", "model"]), policy: z.enum(["baseline", "requestable", "disabled"]), available: z.boolean(), revision: z.number().int(), requiredScope: z.string() });
export const apiPolicyList = z.object({ integrations: z.array(apiPolicy) });
export const apiReflection = z.object({ identity: z.object({ id: z.uuid(), kind: z.enum(["oauth", "run"]) }), scopes: z.array(z.string()), integrations: z.array(apiPolicy.extend({ access: z.enum(["granted", "requestable", "unavailable"]), instructions: z.string() })) });
export const requestApiInput = z.object({
 integration: integrationRef,
 method: z.enum(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]),
 path: z.string().min(1).max(8192).refine(path => path.startsWith("/") && !path.startsWith("//") && !/[\\\r\n\0#]/.test(path), "Supply a relative path/query starting with one slash"),
 headers: z.record(z.string().regex(/^[!#$%&'*+.^_\x60|~0-9A-Za-z-]+$/), z.string().max(8192).refine(value => !/[\r\n\0]/.test(value))).default({}).refine(headers => Object.keys(headers).length <= 64),
 body: z.string().max(44_739_244).optional(), encoding: z.enum(["utf8", "base64"]).default("utf8"),
}).strict().refine(input => !input.body || input.method !== "GET" && input.method !== "HEAD", "GET/HEAD cannot have a body");
export const readApiResponseInput = z.object({ handle: z.uuid(), offset: z.number().int().nonnegative().default(0) }).strict();
export const apiResponseChunk = z.object({ handle: z.uuid(), offset: z.number().int().nonnegative(), nextOffset: z.number().int().nonnegative(), size: z.number().int().nonnegative(), encoding: z.literal("base64"), body: z.string(), done: z.boolean() });
export const requestApiResponse = z.object({ status: z.number().int(), headers: z.record(z.string(), z.string()), size: z.number().int().nonnegative(), encoding: z.enum(["utf8", "base64"]), body: z.string().optional(), handle: z.uuid().optional(), expiresAt: z.string().optional() });
