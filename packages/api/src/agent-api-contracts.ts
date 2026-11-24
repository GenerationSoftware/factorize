import {requestBodySource,multipartPart} from "./proxy-payload-contracts";
import { z } from "zod";
export const integrationScopePattern = /^integration:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([1-9][0-9]{0,9})$/;
export const isIntegrationScope = (scope: string) => integrationScopePattern.test(scope);
export const integrationRef = z.uuid();
export const apiPolicyInput = z.object({ policy: z.enum(["baseline", "requestable", "disabled"]), expectedRevision: z.number().int().positive() }).strict();
export const apiPolicy = z.object({ id: integrationRef, credentialId: z.string(), name: z.string(), description: z.string().nullable(), kind: z.enum(["bearer", "github", "linear", "model", "fly", "exe", "amp", "clickup", "x"]), policy: z.enum(["baseline", "requestable", "disabled"]), available: z.boolean(), revision: z.number().int(), requiredScope: z.string() });
export const apiPolicyList = z.object({ integrations: z.array(apiPolicy) });
export const apiReflection = z.object({ identity: z.object({ id: z.uuid(), kind: z.literal("oauth") }), scopes: z.array(z.string()), proxy: z.object({ requestUrl: z.url(), readResponseUrl: z.url(), requestTool:z.literal("request_api"), readResponseTool:z.literal("read_api_response"), authentication: z.string() }), integrations: z.array(apiPolicy.extend({ access: z.enum(["granted", "requestable", "unavailable"]), instructions: z.string(), requestExample:z.object({integration:integrationRef,method:z.enum(["GET","POST"]),path:z.string(),headers:z.record(z.string(),z.string()).optional(),body:z.string().optional()}) })) });
export const requestApiInput = z.object({
 integration: integrationRef,
 method: z.enum(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]),
 path: z.string().min(1).max(8192).refine(path => path.startsWith("/") && !path.startsWith("//") && !/[\\\r\n\0#]/.test(path), "Supply a relative path/query starting with one slash"),
 headers: z.record(z.string().regex(/^[!#$%&'*+.^_\x60|~0-9A-Za-z-]+$/), z.string().max(8192).refine(value => !/[\r\n\0]/.test(value))).default({}).refine(headers => Object.keys(headers).length <= 64),
 execution:z.enum(["sync","async"]).optional(),idempotencyKey:z.string().min(1).max(160).optional(),
 maxResultBytes:z.number().int().min(2048).max(32768).optional(),
 bodySource:requestBodySource.optional(),multipart:z.array(multipartPart).min(1).max(16).optional(),
 body: z.string().max(44_739_244).optional(), encoding: z.enum(["utf8", "base64"]).default("utf8"),
}).strict().refine(input => !(input.body!==undefined||input.bodySource||input.multipart) || input.method !== "GET" && input.method !== "HEAD", "GET/HEAD cannot have a body").refine(input=>[input.body!==undefined,!!input.bodySource,!!input.multipart].filter(Boolean).length<=1,"Supply one of body, bodySource or multipart.");
export const readApiResponseInput = z.object({ handle: z.uuid(), offset: z.number().int().nonnegative().default(0), limit:z.number().int().min(1).max(65536).optional() }).strict();
export const apiResponseChunk = z.object({ handle: z.uuid(), offset: z.number().int().nonnegative(), nextOffset: z.number().int().nonnegative(), size: z.number().int().nonnegative(), encoding: z.literal("base64"), body: z.string(), done: z.boolean() });
export const requestApiResponse = z.object({ status: z.number().int(), headers: z.record(z.string(), z.string()), size: z.number().int().nonnegative(), encoding: z.enum(["utf8", "base64"]), body: z.string().optional(), handle: z.uuid().optional(), expiresAt: z.string().optional(), preview:z.string().optional(),instructions:z.string().optional() });

export const queryApiResponseInput=z.object({handle:z.uuid(),mode:z.enum(["json","text","bytes"]).default("json"),expression:z.string().min(1).max(256).default("@"),offset:z.number().int().nonnegative().default(0),limit:z.number().int().min(1).max(1000).default(25),maxResultBytes:z.number().int().min(2048).max(32768).default(4096)}).strict();
export const queryApiResponseResult=z.object({handle:z.uuid(),mode:z.enum(["json","text","bytes"]),data:z.unknown(),offset:z.number().int(),nextOffset:z.number().int(),done:z.boolean(),encoding:z.enum(["json","utf8","base64"])});
