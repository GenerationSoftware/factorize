import {describe,it,expect} from "vitest";
import {parse} from "yaml";
import {markdown,base64} from "../src/skill-files";
import {skillDocument,skillEntry,skillResource,parseSkillUri,publishedFiles} from "../src/mcp-skills";

describe("MCP skill packages",()=>{
 it("publishes literal legacy bodies with valid frontmatter while preserving author metadata",async()=>{
  const value=skillDocument("renamed","---\nname: original\ndescription: Useful instructions\nmetadata:\n  arbitrary: value\nlicense: MIT\n---\nLiteral {{prompt}}");
  expect(value.frontmatter).toEqual({name:"renamed",description:"Useful instructions",metadata:{arbitrary:"value"},license:"MIT"});
  expect(parse(value.text.split("---\n")[1])).toEqual(value.frontmatter);
  expect(value.text.endsWith("Literal {{prompt}}")).toBe(true);
  expect(skillDocument("plain","Literal").text).toContain("name: plain\n");
 });
 it("manifests exact UTF-8 and binary bytes and preserves executable supporting files",async()=>{
  const skill={key:"guide",body:"Literal",version:{commit:"pinned",files:[markdown("Literal"),{path:"scripts/é.bin",content:base64(new Uint8Array([0,255,254])),executable:true}]}};
  const entry=await skillEntry("team",skill);
  expect(entry.resources).toHaveLength(2);
  for(const resource of entry.resources){
   const path=parseSkillUri(resource.uri,"team").path,read=skillResource("team",skill,path);
   const bytes="text" in read?new TextEncoder().encode(read.text):Uint8Array.from(atob(read.blob),c=>c.charCodeAt(0));
   expect(resource.size).toBe(bytes.length);
   expect(resource.digest).toBe("sha256:"+Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),v=>v.toString(16).padStart(2,"0")).join(""));
  }
  expect(skillResource("team",skill,"scripts/é.bin")).toMatchObject({blob:"AP/+"});
  expect(publishedFiles(skill).files[1].executable).toBe(true);
 });
 it("rejects ambiguous paths, malformed metadata, duplicates and overlarge manifests",()=>{
  for(const uri of ["skill://teams/other/guide/SKILL.md","skill://teams/team/guide/../secret","skill://teams/team/guide/%2e%2e/secret","skill://teams/team/guide/a%2Fb","skill://teams/team/guide/SKILL.md?secret=x"])
   expect(()=>parseSkillUri(uri,"team")).toThrow();
  expect(()=>skillDocument("guide","---\nname: a\nname: b\n---\nBody")).toThrow();
  expect(()=>skillDocument("guide","---\ndescription: []\n---\nBody")).toThrow();
  const files=Array.from({length:513},(_,i)=>({...markdown("text"),path:i?"file-"+i:"SKILL.md"}));
  expect(()=>publishedFiles({key:"guide",body:"Body",version:{commit:"pinned",files}})).toThrow(/512/);
 });
});
