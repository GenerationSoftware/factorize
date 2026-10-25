import { z } from "zod";

export const SKILL_KEY = /^[a-z][a-z0-9_-]{0,63}$/;
export const SKILL_BODY_LIMIT = 100_000;
export const skillInput = z.object({ key: z.string().trim().regex(SKILL_KEY), body: z.string().max(SKILL_BODY_LIMIT) }).strict();
export const skillUpdateInput = z.object({ key: z.string().trim().regex(SKILL_KEY).optional(), body: z.string().max(SKILL_BODY_LIMIT).optional(), expectedRevision: z.number().int().positive() }).strict();
export const skillResponse = z.object({ id: z.guid(), key: z.string(), revision: z.number().int().positive(), body: z.string(), usageCount: z.number().int().nonnegative(), createdAt: z.string(), updatedAt: z.string() });
export const skillMetadata = skillResponse.omit({ body: true });
export const skillPage = z.object({ items: z.array(skillMetadata), nextCursor: z.guid().nullable() });
export const skillJobsResponse = z.object({ skillId: z.guid(), jobs: z.array(z.object({ id: z.guid(), name: z.string(), slug: z.string(), enabled: z.boolean(), projectId: z.guid() })) });
export const previewSkillInput = z.object({ skillIds: z.array(z.guid()).max(50), jobContext: z.string().max(50_000), sampleTriggerData: z.record(z.string(), z.unknown()).optional() }).strict();
export type Skill = z.infer<typeof skillResponse>;
/** Skill bodies are opaque; only the job template is Mustache-rendered. */
export function composePrompt(skills: readonly { body: string }[], jobContext: string): string { return [...skills.map(skill => skill.body), jobContext].join("\n\n"); }
