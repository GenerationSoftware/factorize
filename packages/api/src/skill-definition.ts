import { parseDocument } from "yaml";
import { z } from "zod";

export const presetSlug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120);
export const factorizeMetadata = z.object({
  "vm-preset": presetSlug.optional(),
  "permission-preset": presetSlug.optional(),
  "model-preset": presetSlug.optional(),
  concurrency: z.number().int().nonnegative().max(2147483647).default(0),
  disabled: z.boolean().default(false),
}).passthrough();
export const skillDefinition = z.object({
  name: presetSlug.max(64).refine(name=>name!=="manual","The name manual is reserved."),
  description: z.string().max(1024),
  factorize: factorizeMetadata,
  markdown: z.string().max(100_000),
});
export type SkillDefinition = z.infer<typeof skillDefinition>;

function invalid(message:string):never { throw new z.ZodError([{code:"custom",path:["body"],message}]); }
function split(source: string) {
  const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  if(/^---\r?\n/.test(source)&&!header)invalid("SKILL.md frontmatter is missing its closing delimiter.");
  const doc = parseDocument(header?.[1] ?? "{}");
  let raw:Record<string,any>;
  try{raw=doc.toJS({maxAliasCount:100});}catch{invalid("SKILL.md frontmatter contains invalid or excessive aliases.");}
  if(doc.errors.length||!raw||typeof raw!=="object"||Array.isArray(raw))invalid("SKILL.md frontmatter must be a valid YAML mapping.");
  return {doc,raw,markdown:header?source.slice(header[0].length):source};
}
export function readSkillDefinition(source: string, key: string): SkillDefinition {
  const { raw, markdown } = split(source);
  if (raw.metadata !== undefined && (!raw.metadata || typeof raw.metadata !== "object" || Array.isArray(raw.metadata))) invalid("Skill metadata must be a mapping.");
  return skillDefinition.parse({ name: raw.name ?? key, description: raw.description ?? "", factorize: raw.metadata?.factorize ?? {}, markdown });
}
/** Patch only managed keys, retaining unknown fields and YAML comments. */
export function writeSkillDefinition(source: string, value: SkillDefinition): string {
  const parsed = skillDefinition.parse(value), { doc } = split(source);
  doc.set("name", parsed.name);
  doc.set("description", parsed.description);
  const metadata = doc.get("metadata");
  if (metadata !== undefined && (!metadata || !doc.getIn(["metadata"]) || Array.isArray(doc.toJS().metadata) || typeof doc.toJS().metadata !== "object")) invalid("Skill metadata must be a mapping.");
  for (const field of ["vm-preset", "permission-preset", "model-preset", "concurrency", "disabled"] as const) {
    if (parsed.factorize[field] === undefined) { if(doc.hasIn(["metadata", "factorize", field]))doc.deleteIn(["metadata", "factorize", field]); }
    else doc.setIn(["metadata", "factorize", field], parsed.factorize[field]);
  }
  return `---\n${doc.toString()}---\n${parsed.markdown}`;
}

/** Public list/deletion index only. Never duplicate Markdown or arbitrary
 * frontmatter into unencrypted database metadata. */
export function skillDefinitionIndex(value:SkillDefinition){
 const fields=["vm-preset","permission-preset","model-preset","concurrency","disabled"] as const;
 return {name:value.name,description:value.description,factorize:Object.fromEntries(fields.filter(field=>value.factorize[field]!==undefined).map(field=>[field,value.factorize[field]]))};
}
