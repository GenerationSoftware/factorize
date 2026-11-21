import {requestBodySource,multipartPart} from "./proxy-payload-contracts";
import { z } from "zod";
export const integrationScopePattern = /^integration:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([1-9][0-9]{0,9})$/;
export const isIntegrationScope = (scope: string) => integrationScopePattern.test(scope);
export const integrationRef = z.uuid();
export const apiPolicyInput = z.object({ policy: z.enum(["baseline", "requestable", "disabled"]), expectedRevision: z.number().int().positive() }).strict();
export const apiPolicy = z.object({ id: integrationRef, credentialId: z.string(), name: z.string(), description: z.string().nullable(), kind: z.enum(["bearer", "github", "linear", "model", "fly", "exe", "amp", "clickup", "x"]), policy: z.enum(["baseline", "requestable", "disabled"]), available: z.boolean(), revision: z.number().int(), requiredScope: z.string() });
export const apiPolicyList = z.object({ integrations: z.array(apiPolicy) });
export const vmExecInput=z.object({command:z.string().min(1).max(50000).refine(value=>!value.includes("\0")),cwd:z.string().startsWith("/").max(4096).refine(value=>!/[\0\r\n]/.test(value)).optional()}).strict();
export const vmExecResult=z.object({output:z.string(),exitCode:z.number().int()});
export const currentVm=z.object({provider:z.enum(["exe.dev","fly.io"]),id:z.string(),runId:z.uuid(),status:z.literal("ready"),cwd:z.string(),verifiedAt:z.string(),tool:z.literal("vm_exec")}).nullable();
export const apiReflection = z.object({media:z.object({frameworkVersion:z.literal("1.5.2"),contentTypes:z.array(z.enum(["text","image"])),maxUploadBytes:z.number().int(),maxTurnMediaBytes:z.number().int(),uploadUrl:z.url(),fetchTool:z.literal("fetch_media"),readTool:z.literal("read_media")}).optional(),agentHost:z.enum(["factorize","external","vm"]),current_vm:currentVm, identity: z.object({ id: z.uuid(), kind: z.enum(["oauth", "run"]) }), scopes: z.array(z.string()), proxy: z.object({ requestUrl: z.url(), readResponseUrl: z.url(), requestTool:z.literal("request_api"), readResponseTool:z.literal("read_api_response"), authentication: z.string() }), integrations: z.array(apiPolicy.extend({ access: z.enum(["granted", "requestable", "unavailable"]), instructions: z.string(), requestExample:z.object({integration:integrationRef,method:z.enum(["GET","POST"]),path:z.string(),headers:z.record(z.string(),z.string()).optional(),body:z.string().optional()}), vmGrantProvider: z.enum(["exe.dev","fly.io"]).optional() })) });
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

export const grantVmInput = z.object({
  providerIntegrationId: integrationRef,
  app: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/).optional(),
  vm: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/),
  integrationIds: z.array(integrationRef).min(1).max(64).refine(ids => new Set(ids).size === ids.length),
  idempotencyKey: z.string().min(1).max(160),
}).strict();
export const vmGrantRenewal = z.object({grantId:z.uuid(),expiresAt:z.string()});
export const revokeVmInput = z.object({ grantId: z.uuid() }).strict();
export const vmGrantReceipt = z.object({ provider:z.enum(["exe.dev","fly.io"]).optional(),app:z.string().optional(),audience:z.string().optional(),tokenSocket:z.string().optional(),readResponseUrl:z.url().optional(),grantId: z.uuid(), vm: z.string(), integrationIds: z.array(integrationRef), expiresAt: z.string(), tokenUrl: z.url(), proofFile: z.string(), requestUrl: z.url(), instructions: z.string() });

export const queryApiResponseInput=z.object({handle:z.uuid(),mode:z.enum(["json","text","bytes"]).default("json"),expression:z.string().min(1).max(256).default("@"),offset:z.number().int().nonnegative().default(0),limit:z.number().int().min(1).max(1000).default(25),maxResultBytes:z.number().int().min(2048).max(32768).default(4096)}).strict();
export const queryApiResponseResult=z.object({handle:z.uuid(),mode:z.enum(["json","text","bytes"]),data:z.unknown(),offset:z.number().int(),nextOffset:z.number().int(),done:z.boolean(),encoding:z.enum(["json","utf8","base64"])});
