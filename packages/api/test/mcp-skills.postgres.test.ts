import {beforeAll,afterAll,describe,it,expect,vi} from "vitest";
import {loadingFixture} from "./helpers/loading-fixture";
import {protectedApiFetch} from "../src/protected-api";
import {encrypt} from "../src/crypto";
import {skillUri,SKILLS_EXTENSION} from "../src/mcp-skills";
import {builtinSkillDocuments,builtinSkillUri} from "../src/builtin-skills";
import {IdentityRepository} from "../src/postgres/identity-repository";
import type {OAuthProps} from "../src/types";
vi.mock("cloudflare:workers",()=>({WorkerEntrypoint:class{},WorkflowEntrypoint:class{},DurableObject:class{}}));
vi.mock("@cloudflare/workers-oauth-provider",()=>({OAuthProvider:class{},AuthorizationError:class extends Error{},getOAuthApi:vi.fn()}));
const meta={"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientInfo":{name:"local-skill-client",version:"1"},"io.modelcontextprotocol/clientCapabilities":{}};

describe.skipIf(!process.env.AUTH_TEST_DATABASE_URL)("static authorized MCP Skills extension",()=>{
 let f:Awaited<ReturnType<typeof loadingFixture>>,auth:OAuthProps,id:string;
 const body="---\nname: guide\ndescription: A team guide\nmetadata:\n  author: local\n---\nReflect, then read references/example.txt.";
 beforeAll(async()=>{
  f=await loadingFixture(process.env.AUTH_TEST_DATABASE_URL!);auth={...f.auth,scopes:[...f.auth.scopes,"skills:read"]};id=crypto.randomUUID();
  await f.db.pool.query("INSERT INTO app.skills(tenant_id,id,key,encrypted_body) VALUES($1,$2,'guide',$3)",[f.tenantId,id,await encrypt(body,f.env.CREDENTIAL_ENCRYPTION_KEY)]);
 });
 afterAll(async()=>{await f?.cleanup();});
 async function rpc(method:string,params:Record<string,unknown>={},identity=auth){
  const response=await protectedApiFetch(new Request(f.env.APP_ORIGIN+"/mcp",{method:"POST",headers:{"Mcp-Method":method,...(method==="resources/read"?{"Mcp-Name":String(params.uri)}:method==="tools/call"?{"Mcp-Name":String(params.name)}:{}),Host:"factorize.test","Content-Type":"application/json",Accept:"application/json, text/event-stream"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params:{_meta:meta,...params}})}),f.env,identity,{} as any);
  const text=await response.text();expect(response.status,text).toBe(200);return JSON.parse(text.startsWith("{")?text:text.split("\n").find(line=>line.startsWith("data: "))!.slice(6));
 }
 it("advertises exactly five build-owned workflows even without skills:read",async()=>{
  const discovery=await rpc("server/discover");expect(discovery.result.capabilities.extensions[SKILLS_EXTENSION]).toEqual({});
  const first=(await rpc("skills/list")).result;expect(first.skills).toHaveLength(5);expect(first.nextCursor).toBeUndefined();expect(first.ttlMs).toBeGreaterThan(0);
  expect(first.skills.map((skill:any)=>skill.frontmatter.name)).toEqual(builtinSkillDocuments.map(skill=>skill.name));
  expect((await rpc("skills/list",{}, {...auth,scopes:[]})).result).toEqual(first);
  await new IdentityRepository(f.db,f.otherTenant).upsertOwner(f.userId,"owner@example.test");
  const other={...auth,tenantId:f.otherTenant,scopes:[]};expect((await rpc("skills/list",{},other)).result).toEqual(first);
  for(const entry of first.skills){
   expect((await rpc("skills/get",{uri:entry.uri},other)).result.skill).toEqual(entry);
   const file=(await rpc("resources/read",{uri:entry.uri},other)).result.contents[0];
   expect(file.text).toBe(builtinSkillDocuments.find(skill=>skill.name===entry.frontmatter.name)!.text);
   const bytes=new TextEncoder().encode(file.text);expect(entry.resources).toEqual([{uri:entry.uri,size:bytes.length,digest:"sha256:"+Buffer.from(await crypto.subtle.digest("SHA-256",bytes)).toString("hex")}]);
  }
 });
 it("retains live team tools and protected legacy resources outside extension discovery",async()=>{
  const tools=await rpc("tools/list");expect(tools.result.tools.map((tool:any)=>tool.name)).toEqual(expect.arrayContaining(["list_skills","get_skill"]));
  const list=await rpc("tools/call",{name:"list_skills",arguments:{}});expect(list.result.isError).not.toBe(true);expect(JSON.stringify(list.result)).toContain("guide");
  const skill=await rpc("tools/call",{name:"get_skill",arguments:{skillId:id}});expect(skill.result.structuredContent.body).toContain("author: local");
  expect((await rpc("resources/read",{uri:skillUri(f.tenantId,"guide")})).result.contents[0].text).toContain("author: local");
  expect((await rpc("skills/get",{uri:skillUri(f.tenantId,"guide")})).error).toBeDefined();
  expect((await rpc("resources/read",{uri:skillUri(f.tenantId,"guide")},{...auth,scopes:[]})).error.message).toContain("insufficient_scope");
  expect((await rpc("tools/call",{name:"get_skill",arguments:{skillId:id}},{...auth,scopes:[]})).result.isError).toBe(true);
 });
 it("checks identity and rejects unknown, stale and noncanonical paths",async()=>{
  for(const method of ["skills/list","skills/get","resources/read"])
   expect((await rpc(method,{uri:builtinSkillUri("manage-skills")},{...auth,sessionVersion:999})).error.message).toContain("invalid_token");
  for(const uri of [builtinSkillUri("missing"),builtinSkillUri("manage-skills")+"?q=x",builtinSkillUri("manage-skills").replace("SKILL.md","%53KILL.md"),"skill://factorize/old/manage-skills/SKILL.md",skillUri(f.otherTenant,"guide")])
   for(const method of ["skills/get","resources/read"])expect((await rpc(method,{uri})).error).toBeDefined();
 });
 it("does not change publication when team skills are edited, renamed or deleted",async()=>{
  const before=(await rpc("skills/list")).result;
  await f.db.pool.query("UPDATE app.skills SET key='renamed-guide',encrypted_body=$3,revision=revision+1 WHERE tenant_id=$1 AND id=$2",[f.tenantId,id,await encrypt("Updated",f.env.CREDENTIAL_ENCRYPTION_KEY)]);
  expect((await rpc("skills/list")).result).toEqual(before);
  await f.db.pool.query("DELETE FROM app.skills WHERE tenant_id=$1 AND id=$2",[f.tenantId,id]);expect((await rpc("skills/list")).result).toEqual(before);
 });
});
