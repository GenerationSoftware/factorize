import { z } from "zod";
import { RESOURCE_NAME, resourceName } from "./resource-names";

export const SKILL_KEY = RESOURCE_NAME;
export const SKILL_BODY_LIMIT = 100_000;
export const skillInput = z.object({ key: resourceName, body: z.string().max(SKILL_BODY_LIMIT) }).strict();
export const skillUpdateInput = z.object({ key: resourceName.optional(), body: z.string().max(SKILL_BODY_LIMIT).optional(), expectedRevision: z.number().int().positive() }).strict();
export const skillResponse = z.object({ id: z.guid(), key: z.string(), revision: z.number().int().positive(), body: z.string(), usageCount: z.number().int().nonnegative(), createdAt: z.string(), updatedAt: z.string() });
export const skillMetadata = skillResponse.omit({ body: true });
export const skillPage = z.object({ items: z.array(skillMetadata), nextCursor: z.guid().nullable() });
export const skillTriggersResponse = z.object({ skillId: z.guid(), triggers: z.array(z.object({ id: z.guid(), name: z.string(), enabled: z.boolean() })) });
export const previewSkillInput = z.object({
  skillId:z.guid().nullable().optional(),prompt:z.string().max(50_000).default(""),eventTemplate:z.string().max(50_000).optional(),
  eventData:z.record(z.string(),z.unknown()).optional(),eventSlug:z.string().max(64).optional(),eventKind:z.enum(["manual","schedule","webhook","triggerLifecycle","triggerIdle"]).default("manual"),instructions:z.string().max(50_000).default(""),runNameTemplate:z.string().max(500).optional(),
}).strict();
export const previewPromptResponse=z.object({prompt:z.string(),eventText:z.string(),skill:z.object({id:z.guid(),key:z.string(),revision:z.number().int().positive()}).nullable(),runName:z.string()});
export type Skill = z.infer<typeof skillResponse>;
/** Skill instructions and caller prompt text remain literal. */
export function composePrompt(skill: {body:string}|undefined, prompt:string):string {
  return [skill?.body ?? "",prompt].filter(text=>text.trim()).join("\n\n");
}
