import { z } from "zod";

const key = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/).refine(value => value !== "constructor" && value !== "prototype");
const keyPath = z.string().max(240).regex(/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+){0,11}$/);
const step = z.strictObject({
  name: key, integration: z.uuid(),
  method: z.enum(["GET","HEAD","POST","PUT","PATCH","DELETE","OPTIONS"]),
  path: z.string().min(1).max(2048),
});
export const inputMapping = z.record(key,keyPath).refine(value => Object.keys(value).length > 0 && Object.keys(value).length <= 24);
export const eventEnrichment = z.strictObject({
  extraDataUrls: z.array(step).max(6),
  rule: z.string().trim().min(1).max(1000),
}).refine(value => new Set(value.extraDataUrls.map(step => step.name)).size === value.extraDataUrls.length, "Lookup names must be unique.");
export type EventEnrichment = z.infer<typeof eventEnrichment>;
export type InputMapping = z.infer<typeof inputMapping>;
export const enrichmentRun = z.object({
  id: z.uuid(), triggerId: z.uuid(), createdAt: z.iso.datetime(),
  state: z.enum(["running","matched","excluded","failed"]),
  stage: z.string().nullable(), reason: z.string().nullable(),
  input: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).nullable(),
  steps: z.array(z.object({name: key, outcome: z.enum(["ok","failed"]), status: z.number().int().min(100).max(599).optional()})),
});
