import {z} from "zod";
import {isPublicHttpsOrigin} from "./public-address";
export const phoenixInput=z.object({endpoint:z.string().url().max(2048).refine(value=>{try{const url=new URL(value);return isPublicHttpsOrigin(url.origin)&&!url.username&&!url.password&&!url.search&&!url.hash;}catch{return false;}},"Use a public HTTPS Phoenix base URL without query parameters or credentials."),projectName:z.string().trim().min(1).max(128).refine(value=>!/[/?#\r\n\0]/.test(value)),apiKey:z.string().min(1).max(8192).regex(/^[^\r\n]+$/).optional().meta({writeOnly:true}),enabled:z.boolean().default(true),expectedRevision:z.number().int().nonnegative()}).strict();
export const phoenixRevision=z.object({expectedRevision:z.number().int().nonnegative()}).strict();
export const phoenixConfig=z.object({configured:z.boolean(),endpoint:z.string(),projectName:z.string(),projectId:z.string().nullable(),credentialConfigured:z.boolean(),enabled:z.boolean(),revision:z.number().int(),lastTestAt:z.string().nullable(),lastError:z.string().nullable()});
export const phoenixTest=z.object({connected:z.boolean(),projectFound:z.boolean(),error:z.string().nullable()});
export const phoenixRunStatus=z.object({url:z.string().nullable(),pending:z.number().int(),sent:z.number().int(),failed:z.number().int(),canceled:z.number().int(),lastError:z.string().nullable()});
