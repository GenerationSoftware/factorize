import {parseDocument, stringify} from "yaml";
import {base64, markdown, validPath, SkillContentError, type SkillFile, type SkillVersion} from "./skill-files";

export const SKILLS_EXTENSION = "io.modelcontextprotocol/skills";
export type PublishedSkill = {key:string;body?:string;version?:SkillVersion};
export type SkillFrontmatter = {name:string;description:string;[key:string]:unknown};

/** Old literal bodies are published as valid SKILL.md without changing stored instructions. */
export function skillDocument(key:string,body:string|undefined):{frontmatter:SkillFrontmatter;text:string} {
  if(typeof body!=="string")throw new SkillContentError("Skill content is unavailable.");
  let frontmatter:Record<string,unknown>={},instructions=body;
  const header=/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(body);
  if(header) {
    const doc=parseDocument(header[1],{uniqueKeys:true});
    if(doc.errors.length) throw new SkillContentError("SKILL.md frontmatter must be valid YAML.");
    const value=doc.toJS({maxAliasCount:20});
    if(!value || typeof value!=="object" || Array.isArray(value))throw new SkillContentError("SKILL.md frontmatter must be an object.");
    frontmatter=value;instructions=body.slice(header[0].length);
  }
  // Names are authoritative in the shared Team namespace, including migrated/renamed skills.
  frontmatter={...frontmatter,name:key,description:frontmatter.description || `Instructions for the ${key} team skill.`};
  if(typeof frontmatter.description!=="string" || !frontmatter.description.trim() || frontmatter.description.length>1024)throw new SkillContentError("Skill description must contain 1 to 1024 characters.");
  return {frontmatter:frontmatter as SkillFrontmatter,text:`---\n${stringify(frontmatter)}---\n${instructions}`};
}
export function skillUri(tenant:string,name:string,path="SKILL.md") {
  return `skill://teams/${tenant}/${name}/${path.split("/").map(encodeURIComponent).join("/")}`;
}
export function parseSkillUri(uri:string,tenant:string) {
  const prefix=`skill://teams/${tenant}/`;
  if(!uri.startsWith(prefix))throw new SkillContentError("Unknown skill resource.");
  const parts=uri.slice(prefix.length).split("/");
  let name:string,path:string;
  try {name=decodeURIComponent(parts.shift()!);path=parts.map(decodeURIComponent).join("/");}catch{throw new SkillContentError("Unknown skill resource.");}
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || !validPath(path) || uri!==skillUri(tenant,name,path))throw new SkillContentError("Unknown skill resource.");
  return {name,path};
}
export function publishedFiles(skill:PublishedSkill) {
  const {frontmatter,text}=skillDocument(skill.key,skill.body);
  const files=(skill.version?.files ?? [markdown(skill.body!)]).map(file=>file.path==="SKILL.md"?markdown(text):file);
  if(!files.some(file=>file.path==="SKILL.md") || files.length>512 || new Set(files.map(file=>file.path)).size!==files.length)throw new SkillContentError("A skill must contain SKILL.md and at most 512 unique files.");
  let total=0;
  for(const file of files) {
    if(!validPath(file.path))throw new SkillContentError("Invalid skill file path.");
    total+=bytesOf(file).byteLength;
  }
  if(total>16*1024*1024)throw new SkillContentError("Skill exceeds the MCP Skills size limit.");
  return {frontmatter,files};
}
export function bytesOf(file:SkillFile) {
  try {return Uint8Array.from(atob(file.content),c=>c.charCodeAt(0));}catch{throw new SkillContentError("Skill file content must be base64.");}
}
export async function skillEntry(tenant:string,skill:PublishedSkill,uriFor=(path="SKILL.md")=>skillUri(tenant,skill.key,path)) {
  const {frontmatter,files}=publishedFiles(skill);
  return {uri:uriFor(),frontmatter,resources:await Promise.all(files.map(async file=>{
    const bytes=bytesOf(file),digest=await crypto.subtle.digest("SHA-256",bytes);
    return {uri:uriFor(file.path),digest:"sha256:"+Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,"0")).join(""),size:bytes.byteLength};
  }))};
}
export function skillResource(tenant:string,skill:PublishedSkill,path:string,uriFor=(path:string)=>skillUri(tenant,skill.key,path)) {
  const file=publishedFiles(skill).files.find(file=>file.path===path);
  if(!file)throw new SkillContentError("Unknown skill resource.");
  const uri=uriFor(path),bytes=bytesOf(file);
  const mimeType=path.endsWith(".md")?"text/markdown":path.endsWith(".json")?"application/json":/\.(png|jpg|jpeg|gif|webp)$/.test(path)?`image/${path.split(".").at(-1)==="jpg"?"jpeg":path.split(".").at(-1)}`:"application/octet-stream";
  try {return {uri,mimeType,text:new TextDecoder("utf-8",{fatal:true}).decode(bytes)};}catch{return {uri,mimeType,blob:base64(bytes)};}
}

export function snapshotSkillUri(tenant:string,run:string,name:string,path="SKILL.md") {return `skill://runs/${tenant}/${run}/${name}/${path.split("/").map(encodeURIComponent).join("/")}`;}
export function parseSnapshotSkillUri(uri:string,tenant:string,run:string){
 const prefix=`skill://runs/${tenant}/${run}/`;if(!uri.startsWith(prefix))throw new SkillContentError("Unknown skill resource.");
 return parseSkillUri(`skill://teams/${tenant}/`+uri.slice(prefix.length),tenant);
}
