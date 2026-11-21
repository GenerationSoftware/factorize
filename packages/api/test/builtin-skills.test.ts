import {describe,it,expect} from "vitest";
import {readFile,mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {resolve} from "node:path";
import {builtinSkillDocuments,builtinSkillsVersion,builtinSkillUri,builtinSkill,builtinSkillEntry,builtinSkillResource} from "../src/builtin-skills";

describe("build-shipped workflow catalog",()=>{
 it("ships exactly five portable documents with exact canonical bytes and manifests",async()=>{
  expect(builtinSkillDocuments.map(skill=>skill.name)).toEqual(["manage-presets","manage-skills","run-and-supervise","manage-triggers","manage-environments"]);
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
 it("covers the live tools and completion/renewal distinctions",()=>{
  const bodies=builtinSkillDocuments.map(skill=>skill.text);
  for(const [index,terms] of [[0,["create_preset","permission","expectedRevision","set_default_preset"]],[1,["create_skill","update_skill","list_skill_triggers","metadata.factorize"]],[2,["start_run","subscriptions/listen","eventId","get_run_diagnostics","stop_run"]],[3,["save_skill_trigger","create_trigger","webhook","list_webhook_deliveries"]],[4,["get_api_reflection","Fly.io","grant_vm","renew_vm_grant","revoke_vm_grant","one hour"]]] as const)
   for(const term of terms)expect(bodies[index]).toContain(term);
 });
 it("rejects noncanonical and unknown versions/paths",()=>{
  for(const uri of [builtinSkillUri("missing"),builtinSkillUri("manage-skills")+"?q=1",builtinSkillUri("manage-skills").replace("SKILL.md","%53KILL.md"),builtinSkillUri("manage-skills").replace(builtinSkillsVersion,"old")])expect(()=>builtinSkill(uri)).toThrow();
 });
 it("generates deterministically and detects stale embedded content",async()=>{
  // This Node-only generator is never imported by the Worker.
  const {renderBuiltinSkills,generateBuiltinSkills}=await import("../../../scripts/generate-builtin-skills.mjs");
  const first=await renderBuiltinSkills();expect(await renderBuiltinSkills()).toBe(first);
  const directory=await mkdtemp(resolve(tmpdir(),"builtin-skills-")),output=resolve(directory,"generated.ts");
  try{await generateBuiltinSkills({output});await generateBuiltinSkills({output,check:true});await writeFile(output,first+"stale");await expect(generateBuiltinSkills({output,check:true})).rejects.toThrow(/drift/);}finally{await rm(directory,{recursive:true,force:true});}
 });
});
