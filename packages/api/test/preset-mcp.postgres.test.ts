import { expect,it,vi } from "vitest";
import { loadingFixture } from "./helpers/loading-fixture";
import { installSkillArtifacts } from "./helpers/memory-skill-git";
import { SkillLibrary } from "../src/skill-library";
import { protectedApiFetch } from "../src/protected-api";
import { CredentialRepository } from "../src/postgres/credential-repository";
vi.mock("../src/skill-git",()=>({withSkillGit:vi.fn()}));
vi.mock("cloudflare:workers",()=>({WorkerEntrypoint:class{},DurableObject:class{}}));
vi.mock("@cloudflare/workers-oauth-provider",()=>({OAuthProvider:class{},AuthorizationError:class extends Error{},getOAuthApi:vi.fn()}));
const meta={"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientInfo":{name:"preset-fixture",version:"1"},"io.modelcontextprotocol/clientCapabilities":{}};
it.skipIf(!process.env.AUTH_TEST_DATABASE_URL)("MCP manages referenced presets and skill definitions with the same run snapshot and authorization semantics as REST",async()=>{
 const f=await loadingFixture(process.env.AUTH_TEST_DATABASE_URL!);
 try{
  installSkillArtifacts(f.env);await new SkillLibrary(f.env,f.tenantId).configure({kind:"managed"});
  const auth={...f.auth,scopes:[...f.auth.scopes,"skills:read","skills:write","runs:start"]};
  async function rpc(method:string,params:Record<string,unknown>={}){
   const response=await protectedApiFetch(new Request(f.env.APP_ORIGIN+"/mcp",{method:"POST",headers:{"Mcp-Method":method,...(method==="tools/call"?{"Mcp-Name":String(params.name)}:{}),Host:"factorize.test","Content-Type":"application/json",Accept:"application/json, text/event-stream"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params:{_meta:meta,...params}})}),f.env,auth,{} as any);
   const text=await response.text();expect(response.status,text).toBe(200);return JSON.parse(text.startsWith("{")?text:text.split("\n").find(line=>line.startsWith("data: "))!.slice(6));
  }
  async function call(name:string,args:Record<string,unknown>={}){const response=await rpc("tools/call",{name,arguments:args});expect(response.error,JSON.stringify(response)).toBeUndefined();expect(response.result.isError,JSON.stringify(response)).not.toBe(true);return response.result.structuredContent;}
  const catalog=await rpc("tools/list");expect(catalog.result.tools.map((t:any)=>t.name)).toEqual(expect.arrayContaining(["list_presets","create_preset","update_preset","set_default_preset","delete_preset","get_skill_trigger","save_skill_trigger"]));
  expect((await call("list_presets")).presets.filter((p:any)=>p.isDefault)).toHaveLength(3);
  const modelId=crypto.randomUUID();await new CredentialRepository(f.db,f.tenantId,f.env.CREDENTIAL_ENCRYPTION_KEY).write({id:modelId,kind:"model",name:"Fixture",origin:null,description:null,expectedRevision:0,idempotencyKey:crypto.randomUUID(),operation:"upsert",managedModelPayload:JSON.stringify({providerUrl:"https://fixture.invalid/v1"})});
  const model={kind:"model",name:"Careful",slug:"careful",settings:{modelAccountId:modelId,model:"fixture-model",effort:"high"}};
  const created=(await call("create_preset",model)).preset;await call("set_default_preset",{presetId:created.id});
  const definition={name:"mcp-skill",description:"MCP fixture",markdown:"# Instructions",factorize:{concurrency:0,disabled:false,"model-preset":"careful"}};
  const skill=await call("create_skill",{key:"mcp-skill",definition});expect(skill.definition.factorize["model-preset"]).toBe("careful");
  const updated=await call("update_skill",{skillId:skill.id,expectedRevision:skill.revision,definition:{...definition,description:"Updated"}});
  const run=await call("start_run",{skill:skill.id,idempotencyKey:"mcp-preset-run"});expect(run.runId).toBeTruthy();
  const detail=await call("get_run",{runId:run.runId});expect(detail.execution_configuration.presetSnapshot.presets.model).toMatchObject({slug:"careful",revision:1,inherited:false});
  await call("update_preset",{presetId:created.id,preset:{...model,expectedRevision:1,settings:{...model.settings,model:"next-model"}}});
  expect((await call("get_run",{runId:run.runId})).execution_configuration.model).toBe("fixture-model");
  await call("save_skill_trigger",{skillId:skill.id,trigger:{enabled:true,events:[]}});expect((await call("get_skill_trigger",{skillId:skill.id})).trigger.events).toEqual([]);
  await call("update_skill",{skillId:skill.id,expectedRevision:updated.revision,definition:{...definition,factorize:{...definition.factorize,disabled:true}}});
  const disabled=await rpc("tools/call",{name:"start_run",arguments:{skill:skill.id}});expect(JSON.stringify(disabled)).toContain("skill_disabled");
  const retired=await rpc("tools/call",{name:"start_run",arguments:{script:"echo retired"}});expect(JSON.stringify(retired)).toContain("scripts_retired");
  const current=await call("get_skill",{skillId:skill.id});expect(current.definition.factorize.disabled).toBe(true);
  const response=await protectedApiFetch(new Request(f.env.APP_ORIGIN+`/api/v1/skills/${skill.id}/settings`,{method:"PUT",headers:{Origin:f.env.APP_ORIGIN,"Content-Type":"application/json"},body:JSON.stringify({expectedRevision:1,defaults:{}})}),f.env,auth,{} as any);expect(response.status).toBe(410);
 }finally{await f.cleanup();}
});
