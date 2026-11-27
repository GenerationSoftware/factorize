import {beforeAll,afterAll,describe,it,expect,vi} from "vitest";
import {loadingFixture} from "./helpers/loading-fixture";
import {mcpRequest} from "./helpers/mcp-request";
import {SKILLS_EXTENSION} from "../src/skills/api/mcp-skills";
import {builtinSkillDocuments,builtinSkillUri} from "../src/skills/builtin-skills";
import {IdentityRepository} from "../src/auth/storage/identity-repository";
import {EventMatchRepository} from "../src/events/storage/event-match-repository";
import type {OAuthProps} from "../src/types";
vi.mock("cloudflare:workers",()=>({WorkerEntrypoint:class{},WorkflowEntrypoint:class{},DurableObject:class{}}));
vi.mock("@cloudflare/workers-oauth-provider",()=>({OAuthProvider:class{},AuthorizationError:class extends Error{},getOAuthApi:vi.fn()}));

describe.skipIf(!process.env.AUTH_TEST_DATABASE_URL)("MCP Skills and Event resources",()=>{
 let f:Awaited<ReturnType<typeof loadingFixture>>,auth:OAuthProps;
 beforeAll(async()=>{
  f=await loadingFixture(process.env.AUTH_TEST_DATABASE_URL!);
  auth=f.auth;
 });
 afterAll(async()=>{await f?.cleanup();});
 async function rpc(method:string,params:Record<string,unknown>={},identity=auth){
  const {status,message}=await mcpRequest(f.env,auth)(method,params,identity);
  expect(status,JSON.stringify(message)).toBe(200);
  return message;
 }
 it("advertises standalone built-in Skills without any feature scope",async()=>{
  const discovery=await rpc("server/discover");expect(discovery.result.capabilities.extensions[SKILLS_EXTENSION]).toEqual({});
  const first=(await rpc("skills/list")).result;expect(first.skills).toHaveLength(3);expect(first.nextCursor).toBeUndefined();expect(first.ttlMs).toBeGreaterThan(0);
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
 it("retires team Skills tools and resources while preserving Event resources",async()=>{
  const tools=await rpc("tools/list");
  const retired=["list_skills","get_skill","create_skill","update_skill","delete_skill"];
  expect(tools.result.tools.map((tool:any)=>tool.name).filter((name:string)=>retired.includes(name))).toEqual([]);
  const uri=`skill://teams/${f.tenantId}/guide/SKILL.md`;
  expect((await rpc("resources/read",{uri})).error).toBeDefined();
  expect((await rpc("skills/get",{uri})).error).toBeDefined();
  const { triggerId, definitionId: eventId } = await f.seedEventTrigger();
  const occurrence=await new EventMatchRepository(f.db).match({tenantId:f.tenantId,triggerId,triggerRevision:1,sourceIdentity:"mcp-test",deduplicationKey:"occurrence-1",evidence:{value:"durable"},decision:"matched"});
  const eventResource=await rpc("resources/read",{uri:`factorize://events/${eventId}/occurrences`});
  expect(eventResource.result.contents[0].text).toContain(occurrence.occurrence!.id);
 });
 it("checks identity and rejects unknown, stale and noncanonical paths",async()=>{
  for(const method of ["skills/list","skills/get","resources/read"])
   expect((await rpc(method,{uri:builtinSkillUri("manage-triggers")},{...auth,sessionVersion:999})).error.message).toContain("invalid_token");
  for(const uri of [builtinSkillUri("missing"),builtinSkillUri("manage-triggers")+"?q=x",builtinSkillUri("manage-triggers").replace("SKILL.md","%53KILL.md"),"skill://factorize/old/manage-skills/SKILL.md",`skill://teams/${f.otherTenant}/guide/SKILL.md`])
   for(const method of ["skills/get","resources/read"])expect((await rpc(method,{uri})).error).toBeDefined();
 });
});
