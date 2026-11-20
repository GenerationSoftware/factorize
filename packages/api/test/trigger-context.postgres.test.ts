import {CredentialRepository} from "../src/postgres/credential-repository";
import {beforeAll,afterAll,describe,it,expect,vi} from "vitest";
import {loadingFixture} from "./helpers/loading-fixture";
import {protectedApiFetch} from "../src/protected-api";
import {ApiService} from "../src/flow-service";
import {encrypt,decrypt} from "../src/crypto";
import type {OAuthProps} from "../src/types";
vi.mock("@cloudflare/workers-oauth-provider",()=>({OAuthProvider:class{},AuthorizationError:class extends Error{},getOAuthApi:vi.fn()}));
vi.mock("cloudflare:workers",()=>({WorkerEntrypoint:class{},WorkflowEntrypoint:class{},DurableObject:class{}}));

describe.skipIf(!process.env.AUTH_TEST_DATABASE_URL)("Trigger context contract and persistence",()=>{
 let f:Awaited<ReturnType<typeof loadingFixture>>,auth:OAuthProps,skillId:string;
 const body="Skill literal {{not-rendered}}";
 beforeAll(async()=>{
  f=await loadingFixture(process.env.AUTH_TEST_DATABASE_URL!);auth={...f.auth,scopes:[...f.auth.scopes,"skills:read","skills:write","runs:start"]};
  const model=crypto.randomUUID();await new CredentialRepository(f.db,f.tenantId,f.env.CREDENTIAL_ENCRYPTION_KEY).write({id:model,kind:"model",name:"Context fixture",origin:null,description:null,expectedRevision:0,idempotencyKey:crypto.randomUUID(),operation:"upsert",managedModelPayload:JSON.stringify({providerUrl:"https://model.fixture/v1"})});
  await new ApiService(f.env,auth).setTeamRunDefaults({modelAccountId:model,model:"fixture",capacity:50,requiresVm:false,runScopes:[]});
  skillId=crypto.randomUUID();await f.db.pool.query("INSERT INTO app.skills(tenant_id,id,key,encrypted_body) VALUES($1,$2,'context-guide',$3)",[f.tenantId,skillId,await encrypt(body,f.env.CREDENTIAL_ENCRYPTION_KEY)]);
 });
 afterAll(async()=>{await f?.cleanup();});
 const request=(path:string,value:unknown,identity=auth)=>protectedApiFetch(new Request(f.env.APP_ORIGIN+path,{method:"POST",headers:{Origin:f.env.APP_ORIGIN,Host:new URL(f.env.APP_ORIGIN).host,"Content-Type":"application/json",Accept:"application/json, text/event-stream"},body:JSON.stringify(value)}),f.env,identity,{waitUntil(){}} as any);
 it("previews exact composition through REST and MCP and enforces scopes",async()=>{
  const input={skillId,prompt:"Base {{literal}}",eventTemplate:"Issue {{data.title}}",eventSlug:"event-2",eventKind:"manual",eventData:{data:{title:"Bug",massive:"x".repeat(100000)}},instructions:"Caller {{literal}}",runNameTemplate:"Review {{event-2.data.title}}"};
  const response=await request("/api/v1/triggers/preview",input);expect(response.status).toBe(200);
  const result=await response.json() as any;
  expect(result).toMatchObject({prompt:body+"\n\nBase {{literal}}\n\nIssue Bug\n\nCaller {{literal}}",eventText:"Issue Bug",runName:"Review Bug",skill:{id:skillId}});
  expect((await request("/api/v1/triggers/preview",input,{...auth,scopes:["triggers:read"]})).status).toBe(403);
  const rpc=await request("/mcp",{jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"preview_trigger_prompt",arguments:input}});expect(rpc.status).toBe(200);
  const text=await rpc.text(),payload=JSON.parse(text.startsWith("{")?text:text.split("\n").find(line=>line.startsWith("data: "))!.slice(6));
  expect(payload.result.structuredContent).toMatchObject(result);
 });
 it("binds the full normalized webhook object without implicitly contributing it",async()=>{
  const eventData={title:"Bug",webhook:{providerOwned:"untouched"},large:"x".repeat(100000)};
  const input={prompt:"Base",eventKind:"webhook",eventData,eventSlug:"event-3",runNameTemplate:"{{event-3.title}}"};
  const absent=await request("/api/v1/triggers/preview",input);expect(absent.status).toBe(200);expect(await absent.json()).toMatchObject({prompt:"Base",eventText:"",runName:"Bug"});
  const selected=await request("/api/v1/triggers/preview",{...input,eventTemplate:"{{webhook.title}}"});expect(selected.status).toBe(200);expect(await selected.json()).toMatchObject({prompt:"Base\n\nBug"});
  const full=await request("/api/v1/triggers/preview",{...input,prompt:"",eventTemplate:"{{webhook}}"});expect(full.status).toBe(200);expect(JSON.parse((await full.json() as any).prompt)).toEqual(eventData);
 });
 it("rejects retired multi-skill/context fields and malformed Event templates",async()=>{
  for(const retired of [{skillIds:[skillId]},{launchSkillId:skillId},{promptTemplate:"legacy"}])expect((await request("/api/v1/triggers",{name:"retired-context",prompt:"Base",...retired})).status).toBe(400);
  expect((await request("/api/v1/triggers",{name:"broken-context",events:[{kind:"manual",template:"{{#broken}}",config:{}}]})).status).toBe(400);
  expect((await request("/api/v1/triggers/preview",{eventTemplate:"{{#broken}}"})).status).toBe(400);
  expect((await request("/api/v1/skills/preview",{skillIds:[skillId],triggerContext:"Old"})).status).toBe(404);
 });
 it("denies selecting or previewing another Team's skill",async()=>{
  const foreign=crypto.randomUUID();await f.db.pool.query("INSERT INTO app.skills(tenant_id,id,key,encrypted_body) VALUES($1,$2,'foreign-context',$3)",[f.otherTenant,foreign,await encrypt("Foreign private instructions",f.env.CREDENTIAL_ENCRYPTION_KEY)]);
  expect((await request("/api/v1/triggers/preview",{skillId:foreign})).status).toBe(400);
  expect((await request("/api/v1/triggers",{name:"foreign-context-selection",skillId:foreign})).status).toBe(400);
  expect((await request("/api/v1/runs",{skill:"foreign-context"})).status).toBe(404);
 });
 it("stores one skill and Event template, then snapshots the exact effective prompt and name",async()=>{
  const created=await request("/api/v1/triggers",{name:"context-snapshot",skillId,prompt:"Base {{literal}}",runNameTemplate:"Name {{data.id}}",events:[{kind:"manual",template:"Selected {{data.id}}",config:{}}]});expect(created.status).toBe(201);
  const trigger=await created.json() as any;
  expect(trigger.events[0].template).toBe("Selected {{data.id}}");expect(trigger).not.toHaveProperty("skills");expect(trigger).not.toHaveProperty("promptTemplate");
  const invoked=await request(`/api/v1/triggers/${trigger.id}/invocations`,{prompt:"Caller {{literal}}",data:{id:7},idempotencyKey:"context-snapshot"});expect(invoked.status).toBe(202);
  const receipt=await invoked.json() as any;
  const row=(await f.db.pool.query("SELECT encrypted_prompt,encrypted_skill_snapshot,run_name FROM app.trigger_runs WHERE tenant_id=$1 AND id=$2",[f.tenantId,receipt.runId])).rows[0];
  expect(await decrypt(row.encrypted_prompt,f.env.CREDENTIAL_ENCRYPTION_KEY)).toBe(body+"\n\nBase {{literal}}\n\nSelected 7\n\nCaller {{literal}}");expect(row.run_name).toBe("Name 7");
  expect(JSON.parse(await decrypt(row.encrypted_skill_snapshot,f.env.CREDENTIAL_ENCRYPTION_KEY))).toMatchObject([{id:skillId,body}]);
  expect((await f.db.pool.query("SELECT skill_id FROM app.trigger_skills WHERE tenant_id=$1 AND trigger_id=$2",[f.tenantId,trigger.id])).rows).toEqual([{skill_id:skillId}]);
 });
 it("rejects empty effective invocation input without queuing or waking a VM and supports skill-only direct runs",async()=>{
  const created=await request("/api/v1/triggers",{name:"empty-context"});expect(created.status).toBe(201);const trigger=await created.json() as any;
  const before=(await f.db.pool.query("SELECT count(*)::int n FROM app.runs WHERE tenant_id=$1",[f.tenantId])).rows[0].n;
  const wake=vi.fn(async()=>new Response("ok"));f.env.SCHEDULER={idFromName:()=>"scheduler",get:()=>({fetch:wake})} as any;
  const response=await request(`/api/v1/triggers/${trigger.id}/invocations`,{});expect(response.status).toBe(400);expect(await response.json()).toMatchObject({error:{code:"invalid_invocation"}});
  expect(wake).not.toHaveBeenCalled();expect((await f.db.pool.query("SELECT count(*)::int n FROM app.runs WHERE tenant_id=$1",[f.tenantId])).rows[0].n).toBe(before);
  const direct=await request("/api/v1/runs",{skill:"context-guide",idempotencyKey:"skill-only"});expect(direct.status).toBe(202);const receipt=await direct.json() as any;
  expect(await decrypt((await f.db.pool.query("SELECT encrypted_prompt FROM app.trigger_runs WHERE tenant_id=$1 AND id=$2",[f.tenantId,receipt.runId])).rows[0].encrypted_prompt,f.env.CREDENTIAL_ENCRYPTION_KEY)).toBe(body);
 });
});
