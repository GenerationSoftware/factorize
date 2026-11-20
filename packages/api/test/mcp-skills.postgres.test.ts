import {beforeAll,afterAll,describe,it,expect,vi} from "vitest";
import {loadingFixture} from "./helpers/loading-fixture";
import {protectedApiFetch} from "../src/protected-api";
import {encrypt} from "../src/crypto";
import {markdown,base64} from "../src/skill-files";
import {skillUri,SKILLS_EXTENSION} from "../src/mcp-skills";
import type {OAuthProps} from "../src/types";
vi.mock("cloudflare:workers",()=>({WorkerEntrypoint:class{},WorkflowEntrypoint:class{},DurableObject:class{}}));
vi.mock("@cloudflare/workers-oauth-provider",()=>({OAuthProvider:class{},AuthorizationError:class extends Error{},getOAuthApi:vi.fn()}));
const meta={"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientInfo":{name:"local-skill-client",version:"1"},"io.modelcontextprotocol/clientCapabilities":{}};

describe.skipIf(!process.env.AUTH_TEST_DATABASE_URL)("authorized MCP Skills extension",()=>{
 let f:Awaited<ReturnType<typeof loadingFixture>>,auth:OAuthProps,id:string;
 const body="---\nname: guide\ndescription: A team guide\nmetadata:\n  author: local\n---\nReflect, then read references/example.txt.";
 beforeAll(async()=>{
  f=await loadingFixture(process.env.AUTH_TEST_DATABASE_URL!);auth={...f.auth,scopes:[...f.auth.scopes,"skills:read"]};id=crypto.randomUUID();
  const version={commit:"fixture",files:[markdown(body),{path:"references/example.txt",content:base64(new TextEncoder().encode("Supporting file")),executable:false},{path:"assets/image.bin",content:"AP/+",executable:false}]};
  await f.db.pool.query("INSERT INTO app.skills(tenant_id,id,key,encrypted_body,encrypted_directory) VALUES($1,$2,'guide',$3,$4)",[f.tenantId,id,await encrypt(body,f.env.CREDENTIAL_ENCRYPTION_KEY),await encrypt(JSON.stringify(version),f.env.CREDENTIAL_ENCRYPTION_KEY)]);
  for(let i=0;i<31;i++)await f.db.pool.query("INSERT INTO app.skills(tenant_id,id,key,encrypted_body) VALUES($1,$2,$3,$4)",[f.tenantId,crypto.randomUUID(),"page-"+i,await encrypt("Literal "+i,f.env.CREDENTIAL_ENCRYPTION_KEY)]);
  await f.db.pool.query("INSERT INTO app.skills(tenant_id,id,key,encrypted_body) VALUES($1,$2,'private-guide',$3)",[f.otherTenant,crypto.randomUUID(),await encrypt("Private",f.env.CREDENTIAL_ENCRYPTION_KEY)]);
 });
 afterAll(async()=>{await f?.cleanup();});
 async function rpc(method:string,params:Record<string,unknown>={},identity=auth){
  const response=await protectedApiFetch(new Request(f.env.APP_ORIGIN+"/mcp",{method:"POST",headers:{"Mcp-Method":method,...(method==="resources/read"?{"Mcp-Name":String(params.uri)}:method==="tools/call"?{"Mcp-Name":String(params.name)}:{}),Host:"factorize.test","Content-Type":"application/json",Accept:"application/json, text/event-stream"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params:{_meta:meta,...params}})}),f.env,identity,{} as any);
  const text=await response.text();expect(response.status,text).toBe(200);return JSON.parse(text.startsWith("{")?text:text.split("\n").find(line=>line.startsWith("data: "))!.slice(6));
 }
 it("advertises the extension and paginates complete authorized manifests",async()=>{
  const discovery=await rpc("server/discover");expect(discovery.error).toBeUndefined();expect(discovery.result.capabilities.extensions[SKILLS_EXTENSION]).toEqual({});
  const first=await rpc("skills/list");expect(first.error).toBeUndefined();expect(first.result.skills).toHaveLength(30);expect(first.result.cacheScope).toBe("private");
  const next=await rpc("skills/list",{cursor:first.result.nextCursor});expect(next.result.skills).toHaveLength(2);expect(next.result.nextCursor).toBeUndefined();
  const all=[...first.result.skills,...next.result.skills];expect(new Set(all.map(s=>s.uri)).size).toBe(32);expect(all.some(s=>s.frontmatter.name==="private-guide")).toBe(false);
  for(const skill of all)expect(skill.resources.some((r:{uri:string})=>r.uri===skill.uri)).toBe(true);
 });
 it("reads the exact package through standard resources and preserves metadata",async()=>{
  const entry=await rpc("skills/get",{uri:skillUri(f.tenantId,"guide")});expect(entry.error).toBeUndefined();expect(entry.result.skill.frontmatter).toMatchObject({name:"guide",description:"A team guide",metadata:{author:"local"}});
  expect(entry.result.skill.resources).toHaveLength(3);
  for(const resource of entry.result.skill.resources){
   const read=await rpc("resources/read",{uri:resource.uri});expect(read.error).toBeUndefined();const file=read.result.contents[0];
   const bytes=file.text!==undefined?new TextEncoder().encode(file.text):Uint8Array.from(atob(file.blob),c=>c.charCodeAt(0));expect(bytes.length).toBe(resource.size);
   expect(resource.digest).toBe("sha256:"+Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),v=>v.toString(16).padStart(2,"0")).join(""));
  }
 });
 it("keeps legacy skill tools visible and usable without extension negotiation",async()=>{
  const tools=await rpc("tools/list");expect(tools.result.tools.map((tool:any)=>tool.name)).toEqual(expect.arrayContaining(["list_skills","get_skill"]));
  const list=await rpc("tools/call",{name:"list_skills",arguments:{}});expect(list.result.isError).not.toBe(true);expect(JSON.stringify(list.result)).toContain("guide");
  const skill=await rpc("tools/call",{name:"get_skill",arguments:{skillId:id}});expect(skill.result.isError).not.toBe(true);expect(skill.result.structuredContent.body).toBe(body);
 });
 it("enforces scopes, membership, canonical paths and Team isolation on every method",async()=>{
  for(const method of ["skills/list","skills/get","resources/read"]){
   const params={uri:skillUri(f.tenantId,"guide")};
   expect((await rpc(method,params,{...auth,scopes:["triggers:read"]})).error.message).toContain("insufficient_scope");
   expect((await rpc(method,params,{...auth,sessionVersion:999})).error.message).toContain("invalid_token");
  }
  for(const uri of [skillUri(f.otherTenant,"private-guide"),skillUri(f.tenantId,"missing"),`skill://teams/${f.tenantId}/guide/../private-guide/SKILL.md`]){
   for(const method of ["skills/get","resources/read"])expect((await rpc(method,{uri})).error.code).toBe(-32602);
  }
 });
 it("observes committed edits, renames and deletion without stale publication",async()=>{
  const old=(await rpc("skills/get",{uri:skillUri(f.tenantId,"guide")})).result.skill.resources[0].digest;
  await f.db.pool.query("UPDATE app.skills SET encrypted_body=$3,encrypted_directory=NULL,revision=revision+1 WHERE tenant_id=$1 AND id=$2",[f.tenantId,id,await encrypt("Updated",f.env.CREDENTIAL_ENCRYPTION_KEY)]);
  expect((await rpc("skills/get",{uri:skillUri(f.tenantId,"guide")})).result.skill.resources[0].digest).not.toBe(old);
  await f.db.pool.query("UPDATE app.skills SET key='renamed-guide' WHERE tenant_id=$1 AND id=$2",[f.tenantId,id]);
  expect((await rpc("skills/get",{uri:skillUri(f.tenantId,"guide")})).error.code).toBe(-32602);
  expect((await rpc("skills/get",{uri:skillUri(f.tenantId,"renamed-guide")})).result.skill.frontmatter.name).toBe("renamed-guide");
  await f.db.pool.query("DELETE FROM app.skills WHERE tenant_id=$1 AND id=$2",[f.tenantId,id]);expect((await rpc("resources/read",{uri:skillUri(f.tenantId,"renamed-guide")})).error.code).toBe(-32602);
 });
});
