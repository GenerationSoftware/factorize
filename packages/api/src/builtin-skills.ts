import {builtinSkillDocuments,builtinSkillsVersion} from "./generated/builtin-skills";
import {SkillContentError} from "./skill-files";
export {builtinSkillDocuments,builtinSkillsVersion};
const prefix=`skill://factorize/${builtinSkillsVersion}/`;
export const builtinSkillUri=(name:string)=>`${prefix}${name}/SKILL.md`;
export function builtinSkill(uri:string){
 const skill=builtinSkillDocuments.find(skill=>uri===builtinSkillUri(skill.name));
 if(!skill)throw new SkillContentError("Unknown built-in skill resource. Rediscover the current built-in catalog after an upgrade.");
 return skill;
}
export function builtinSkillEntry(skill:typeof builtinSkillDocuments[number]){
 const uri=builtinSkillUri(skill.name);
 return {uri,frontmatter:skill.frontmatter,resources:[{uri,digest:skill.digest,size:skill.size}]};
}
export function builtinSkillResource(uri:string){const skill=builtinSkill(uri);return {uri,mimeType:"text/markdown",text:skill.text};}
