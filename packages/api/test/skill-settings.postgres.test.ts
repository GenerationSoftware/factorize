import { InvocationService } from "../src/job-domain";
import { PostgresTriggerRepository } from "../src/postgres/job-repository";
import { CredentialRepository } from "../src/postgres/credential-repository";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { loadingFixture } from "./helpers/loading-fixture";
import { ApiService } from "../src/flow-service";
import { encrypt, decrypt } from "../src/crypto";
import { skillDefaults } from "../src/skill-settings";
import { protectedApiFetch } from "../src/protected-api";
vi.mock("cloudflare:workers",()=>({WorkerEntrypoint:class{},DurableObject:class{}}));
vi.mock("@cloudflare/workers-oauth-provider",()=>({OAuthProvider:class{},AuthorizationError:class extends Error{},getOAuthApi:vi.fn()}));
describe.skipIf(!process.env.AUTH_TEST_DATABASE_URL)("skill-owned execution defaults",()=>{
 let f:Awaited<ReturnType<typeof loadingFixture>>,service:ApiService,id:string;
 beforeAll(async()=>{f=await loadingFixture(process.env.AUTH_TEST_DATABASE_URL!);service=new ApiService(f.env,{...f.auth,scopes:[...f.auth.scopes,"skills:read","skills:write","runs:start"]});id=crypto.randomUUID();await f.db.pool.query("INSERT INTO app.skills(tenant_id,id,key,encrypted_body) VALUES($1,$2,'execution-skill',$3)",[f.tenantId,id,await encrypt("Skill instructions",f.env.CREDENTIAL_ENCRYPTION_KEY)]);});
 afterAll(async()=>{await f?.cleanup();});
 it("copies team settings once and validates the public boundary",async()=>{
   const initial=await service.getSkillSettings(id);expect(initial.defaults).toMatchObject({concurrencyLimit:1,requiresVm:false});
   await f.db.pool.query("UPDATE app.team_settings SET run_defaults=run_defaults||'{\"concurrencyLimit\":9}' WHERE tenant_id=$1",[f.tenantId]);
   expect((await service.getSkillSettings(id)).defaults.concurrencyLimit).toBe(1);
   expect(skillDefaults.safeParse({executionType:"code",script:"echo test",requiresVm:false}).success).toBe(false);
   expect(skillDefaults.safeParse({vmImage:"https://registry.example/image"}).success).toBe(false);
   expect(skillDefaults.safeParse({vmImage:"ghcr.io/example/image:tag"}).success).toBe(true);
   const request=new Request(f.env.APP_ORIGIN+`/api/v1/skills/${id}/settings`,{method:"PUT",headers:{Origin:f.env.APP_ORIGIN,"Content-Type":"application/json"},body:JSON.stringify({expectedRevision:1,defaults:{executionType:"code",requiresVm:false}})});
   expect((await protectedApiFetch(request.clone() as typeof request,f.env,null,{} as ExecutionContext)).status).toBe(401);
   expect((await protectedApiFetch(request,f.env,{...f.auth,scopes:[...f.auth.scopes,"skills:write"]},{} as ExecutionContext)).status).toBe(400);
 });
 it("uses skill settings for manual and triggered scripts and pins old snapshots",async()=>{
   let settings=await service.getSkillSettings(id);
   settings=await service.setSkillSettings(id,{expectedRevision:settings.revision,defaults:{executionType:"code",script:"echo first",requiresVm:true,executionConfigId:"local",vmImage:"alpine:3.22",concurrencyLimit:2,runScopes:[]}});
   const trigger=await service.createTrigger({name:"execution-trigger",skillId:id,prompt:"",events:[{kind:"manual",enabled:true,config:{}}]} as any);
   expect(trigger.executionType).toBe("code");expect(trigger.skill?.id).toBe(id);
   const first=await service.startRun({skill:id,idempotencyKey:"first-skill-launch"});
   const triggered=await service.invokeTrigger(trigger.id,{prompt:"",idempotencyKey:"first-triggered"});
   const config=async(runId:string)=>(await f.db.pool.query("SELECT execution_config FROM app.runs WHERE tenant_id=$1 AND id=$2",[f.tenantId,runId])).rows[0].execution_config;
   expect(await config(first.runId)).toMatchObject({script:"echo first",image:"alpine:3.22",runScopes:[]});
   expect(await config(triggered.runId)).toMatchObject({script:"echo first",image:"alpine:3.22"});
   settings=await service.setSkillSettings(id,{expectedRevision:settings.revision,defaults:{...settings.defaults,script:"echo second",vmImage:"alpine:3.23"}});
   const next=await service.startRun({skill:id,vmImage:"alpine:3.21",idempotencyKey:"explicit"});
   const nextTriggered=await service.invokeTrigger(trigger.id,{prompt:"",idempotencyKey:"second-triggered"});
   expect(await config(next.runId)).toMatchObject({script:"echo second",image:"alpine:3.21"});
   expect(await config(nextTriggered.runId)).toMatchObject({script:"echo second",image:"alpine:3.23"});
   expect(await config(first.runId)).toMatchObject({script:"echo first",image:"alpine:3.22"});
   await expect(service.setSkillSettings(id,{expectedRevision:1,defaults:settings.defaults})).rejects.toMatchObject({status:409});
   await expect(service.setSkillSettings(id,{expectedRevision:settings.revision,defaults:{executionType:"code",script:"echo invalid",requiresVm:false}})).rejects.toThrow();
 });
 it("applies agent model, prompt and permission defaults to both launch paths",async()=>{
   const modelId=crypto.randomUUID();
   await new CredentialRepository(f.db,f.tenantId,f.env.CREDENTIAL_ENCRYPTION_KEY).write({id:modelId,kind:"model",name:"Local model",origin:null,description:null,expectedRevision:0,idempotencyKey:crypto.randomUUID(),operation:"upsert",managedModelPayload:JSON.stringify({providerUrl:"https://models.example/v1"})});
   const current=await service.getSkillSettings(id);
   await service.setSkillSettings(id,{expectedRevision:current.revision,defaults:{executionType:"agent",requiresVm:false,modelAccountId:modelId,model:"skill-model",prompt:"Skill prompt",runScopes:[],concurrencyLimit:4}});
   const direct=await service.startRun({skill:id,prompt:"Caller prompt",idempotencyKey:"agent-direct"});
   const triggerId=(await f.db.pool.query("SELECT trigger_id FROM app.trigger_skills WHERE tenant_id=$1 AND skill_id=$2",[f.tenantId,id])).rows[0].trigger_id;
   const eventRun=await service.invokeTrigger(triggerId,{prompt:"",idempotencyKey:"agent-event"});
   for(const runId of [direct.runId,eventRun.runId]){
     const row=(await f.db.pool.query("SELECT execution_config FROM app.runs WHERE tenant_id=$1 AND id=$2",[f.tenantId,runId])).rows[0];
     expect(row.execution_config).toMatchObject({model:"skill-model",modelAccountId:modelId,runScopes:[]});
   }
   const history=await service.listRuns(new URLSearchParams({skillId:id}));
   expect(history.items.map(run=>run.id)).toEqual(expect.arrayContaining([direct.runId,eventRun.runId]));
   const prompt=(await f.db.pool.query("SELECT encrypted_prompt FROM app.trigger_runs WHERE tenant_id=$1 AND id=$2",[f.tenantId,direct.runId])).rows[0].encrypted_prompt;
   expect(await decrypt(prompt,f.env.CREDENTIAL_ENCRYPTION_KEY)).toBe("Skill instructions\n\nSkill prompt\n\nCaller prompt");
 });

 it("keeps a trigger optional, enforces uniqueness, and accepts multiple event sources",async()=>{
   const optional=crypto.randomUUID();await f.db.pool.query("INSERT INTO app.skills(tenant_id,id,key,encrypted_body) VALUES($1,$2,'optional-skill',$3)",[f.tenantId,optional,await encrypt("Optional",f.env.CREDENTIAL_ENCRYPTION_KEY)]);
   expect(await service.getSkillTrigger(optional)).toEqual({trigger:null});
   const ownedTrigger=await service.saveSkillTrigger(optional,{enabled:true,events:[{kind:"manual",enabled:true,config:{}}]});
   const ownedRun=await service.invokeTrigger(ownedTrigger.trigger!.id,{prompt:"",idempotencyKey:"skill-label"});
   expect((await f.db.pool.query("SELECT run_name FROM app.runs WHERE id=$1",[ownedRun.runId])).rows[0].run_name).toBe("optional-skill");
   const current=await service.getSkillTrigger(id);
   expect(current.trigger?.name).toBe("execution-skill");
   await expect(service.createTrigger({name:"second-trigger",skillId:id,events:[],prompt:""} as any)).rejects.toMatchObject({status:409});
   const saved=await service.saveSkillTrigger(id,{expectedUpdatedAt:current.trigger!.updatedAt,enabled:true,events:[{kind:"manual",slug:"manual",enabled:true,config:{}},{kind:"schedule",slug:"hourly",enabled:true,config:{cron:"0 * * * *",timezone:"UTC"}}]});
   expect(saved.trigger!.events).toHaveLength(2);
   expect(saved.trigger!.skillId).toBe(id);
   expect(saved.trigger!.name).toBe("execution-skill");
   await f.db.pool.query("UPDATE app.skills SET key='renamed-execution' WHERE tenant_id=$1 AND id=$2",[f.tenantId,id]);
   expect((await service.getSkillTrigger(id)).trigger?.name).toBe("renamed-execution");
   const manual=await service.invokeTrigger(saved.trigger!.id,{prompt:"",idempotencyKey:"multi-event"});
   expect((await f.db.pool.query("SELECT launch_skill_id FROM app.runs WHERE id=$1",[manual.runId])).rows[0].launch_skill_id).toBe(id);
   const event=saved.trigger!.events.find(event=>event.kind==="schedule")!;
   const scheduled=await new InvocationService(new PostgresTriggerRepository(f.db,f.tenantId,value=>encrypt(value,f.env.CREDENTIAL_ENCRYPTION_KEY),value=>decrypt(value,f.env.CREDENTIAL_ENCRYPTION_KEY)),value=>encrypt(value,f.env.CREDENTIAL_ENCRYPTION_KEY)).invoke(saved.trigger!.id,{source:"schedule",claimKey:"scheduled-skill-event",eventId:event.id,context:{[event.slug]:{}}});
   expect((await f.db.pool.query("SELECT launch_skill_id FROM app.runs WHERE id=$1",[scheduled.run.id])).rows[0].launch_skill_id).toBe(id);
 });

});
