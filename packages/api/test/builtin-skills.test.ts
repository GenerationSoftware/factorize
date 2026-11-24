import {describe,it,expect} from "vitest";
import {readFile,mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {resolve} from "node:path";
import {builtinSkillDocuments,builtinSkillsVersion,builtinSkillUri,builtinSkill,builtinSkillEntry,builtinSkillResource} from "../src/builtin-skills";

describe("build-shipped workflow catalog",()=>{
 it("ships the standalone management documents with exact canonical bytes and manifests",async()=>{
  expect(builtinSkillDocuments.map(skill=>skill.name)).toEqual(["manage-triggers"]);
  for(const skill of builtinSkillDocuments){
   const text=await readFile(resolve(import.meta.dirname,"../../../skills",skill.name,"SKILL.md"),"utf8");
   expect(skill.text).toBe(text);expect(skill.frontmatter.name).toBe(skill.name);expect(skill.frontmatter.description.length).toBeGreaterThan(10);
   const uri=builtinSkillUri(skill.name),entry=builtinSkillEntry(skill),resource=builtinSkillResource(uri);
   expect(uri).toBe(`skill://factorize/${builtinSkillsVersion}/${skill.name}/SKILL.md`);
   const bytes=new TextEncoder().encode(resource.text);
   expect(entry.resources).toEqual([{uri,size:bytes.length,digest:"sha256:"+Buffer.from(await crypto.subtle.digest("SHA-256",bytes)).toString("hex")}]);
   expect(builtinSkill(uri)).toBe(skill);
  }
 });
 it("covers the live Trigger and Event tools",()=>{
  for(const term of ["create_trigger","webhook","list_webhook_deliveries"])
   expect(builtinSkillDocuments[0].text).toContain(term);
 });
 it("rejects noncanonical and unknown versions/paths",()=>{
  for(const uri of [builtinSkillUri("missing"),builtinSkillUri("manage-triggers")+"?q=1",builtinSkillUri("manage-triggers").replace("SKILL.md","%53KILL.md"),builtinSkillUri("manage-triggers").replace(builtinSkillsVersion,"old")])expect(()=>builtinSkill(uri)).toThrow();
 });
 it("generates deterministically and detects stale embedded content",async()=>{
  // This Node-only generator is never imported by the Worker.
  const {renderBuiltinSkills,generateBuiltinSkills}=await import("../../../scripts/generate-builtin-skills.mjs");
  const first=await renderBuiltinSkills();expect(await renderBuiltinSkills()).toBe(first);
  const directory=await mkdtemp(resolve(tmpdir(),"builtin-skills-")),output=resolve(directory,"generated.ts");
  try{await generateBuiltinSkills({output});await generateBuiltinSkills({output,check:true});await writeFile(output,first+"stale");await expect(generateBuiltinSkills({output,check:true})).rejects.toThrow(/drift/);}finally{await rm(directory,{recursive:true,force:true});}
 });
});
