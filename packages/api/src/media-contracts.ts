import {z} from "zod";
export const MEDIA_LIMIT=32*1024*1024;
export const mediaType=z.string().max(120).regex(/^image\/[a-zA-Z0-9!#$&^_.+-]+$/,"The pinned Pi framework supports image content. Audio/video content is not accepted by this version.").transform(value=>value.toLowerCase());
export const mediaUploadInput=z.object({mediaType,byteSize:z.number().int().min(1).max(MEDIA_LIMIT),sha256:z.string().regex(/^[a-f0-9]{64}$/),idempotencyKey:z.string().min(1).max(160)}).strict();
export const mediaReceipt=z.object({artifactId:z.uuid(),mediaType:z.string(),byteSize:z.number().int(),sha256:z.string(),state:z.enum(["pending","uploading","ready","deleting","deleted"]),uploadUrl:z.url(),readUrl:z.url()});
export const mediaRef=z.object({artifactId:z.uuid()}).strict();
export const fetchMediaInput=z.object({integration:z.uuid(),path:z.string().startsWith("/").max(8192),headers:z.record(z.string(),z.string()).optional(),idempotencyKey:z.string().min(1).max(160)}).strict();
export const MEDIA_DATA_PREFIX="factorize-media:";
