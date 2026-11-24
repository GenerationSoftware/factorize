import { z } from "zod";
import { skillDefinition, readSkillDefinition } from "./skill-definition";
import { RESOURCE_NAME, resourceName } from "./resource-names";

export const SKILL_KEY = RESOURCE_NAME;
export const SKILL_BODY_LIMIT = 100_000;
export const skillInput = z.object({ key: resourceName, body: z.string().max(SKILL_BODY_LIMIT).optional(), definition: skillDefinition.optional() }).strict().refine(value => value.body !== undefined || value.definition !== undefined, "Supply a skill body or definition.");
export const skillUpdateInput = z.object({ key: resourceName.optional(), body: z.string().max(SKILL_BODY_LIMIT).optional(), definition: skillDefinition.optional(), expectedRevision: z.number().int().positive() }).strict();
export const skillResponse = z.object({ id: z.guid(), key: z.string(), revision: z.number().int().positive(), body: z.string(), definition: skillDefinition.optional(), createdAt: z.string(), updatedAt: z.string() });
export const skillMetadata = skillResponse.omit({ body: true, definition: true }).extend({ description: z.string().default("") });
export const skillPage = z.object({ items: z.array(skillMetadata), nextCursor: z.guid().nullable() });
export type Skill = z.infer<typeof skillResponse>;
/** Skill instructions and caller prompt text remain literal. */
export function composePrompt(skill: {body:string}|undefined, prompt:string):string {
  return [skill ? readSkillDefinition(skill.body,"skill").markdown : "",prompt].filter(text=>text.trim()).join("\n\n");
}

export const skillDirectoryResponse=z.object({revision:z.number().int().positive(),commit:z.string().nullable(),files:z.array(z.object({path:z.string(),content:z.string(),executable:z.boolean()}))});
