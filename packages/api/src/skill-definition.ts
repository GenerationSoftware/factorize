import { parseDocument } from "yaml";
import { z } from "zod";

const skillName = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(64).refine(name => name !== "manual", "The name manual is reserved.");
export const skillDefinition = z.object({
  name: skillName,
  description: z.string().max(1024),
  markdown: z.string().max(100_000),
});
export type SkillDefinition = z.infer<typeof skillDefinition>;

function invalid(message: string): never { throw new z.ZodError([{ code: "custom", path: ["body"], message }]); }
function split(source: string) {
  const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  if (/^---\r?\n/.test(source) && !header) invalid("SKILL.md frontmatter is missing its closing delimiter.");
  const doc = parseDocument(header?.[1] ?? "{}");
  let raw: Record<string, any>;
  try { raw = doc.toJS({ maxAliasCount: 100 }); } catch { invalid("SKILL.md frontmatter contains invalid or excessive aliases."); }
  if (doc.errors.length || !raw || typeof raw !== "object" || Array.isArray(raw)) invalid("SKILL.md frontmatter must be a valid YAML mapping.");
  return { doc, raw, markdown: header ? source.slice(header[0].length) : source };
}
export function readSkillDefinition(source: string, key: string): SkillDefinition {
  const { raw, markdown } = split(source);
  return skillDefinition.parse({ name: raw.name ?? key, description: raw.description ?? "", markdown });
}
/** Preserve the document and unrelated frontmatter while removing retired execution settings. */
export function writeSkillDefinition(source: string, value: SkillDefinition): string {
  const parsed = skillDefinition.parse(value), { doc } = split(source);
  doc.set("name", parsed.name);
  doc.set("description", parsed.description);
  if (doc.hasIn(["metadata", "factorize"])) doc.deleteIn(["metadata", "factorize"]);
  return `---\n${doc.toString()}---\n${parsed.markdown}`;
}
export function skillDefinitionIndex(value: SkillDefinition) {
  return { name: value.name, description: value.description };
}
