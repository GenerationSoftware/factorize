import {CredentialRepository} from "../src/postgres/credential-repository";
import {ConnectionRepository} from "../src/postgres/connection-repository";
import {beforeAll,afterAll,describe,it,expect,vi} from "vitest";
import {loadingFixture} from "./helpers/loading-fixture";
import {ApiService} from "../src/flow-service";
import {protectedApiFetch} from "../src/protected-api";
vi.mock("@cloudflare/workers-oauth-provider",()=>({OAuthProvider:class{},AuthorizationError:class extends Error{},getOAuthApi:vi.fn()}));
vi.mock("cloudflare:workers",()=>({WorkerEntrypoint:class{},WorkflowEntrypoint:class{},DurableObject:class{}}));

describe.skipIf(!process.env.AUTH_TEST_DATABASE_URL)("Team defaults seed concrete Triggers",()=>{
 let f:Awaited<ReturnType<typeof loadingFixture>>,service:ApiService;
 beforeAll(async()=>{f=await loadingFixture(process.env.AUTH_TEST_DATABASE_URL!);service=new ApiService(f.env,f.auth);await new ConnectionRepository(f.db,f.tenantId,f.env.CREDENTIAL_ENCRYPTION_KEY).put("exe:local",{apiToken:"synthetic-local",agentKind:"codex",models:["first-model","second-model"]});});
 afterAll(async()=>{await f?.cleanup();});
 const create=(body:unknown)=>protectedApiFetch(new Request(f.env.APP_ORIGIN+"/api/v1/triggers",{method:"POST",headers:{"Content-Type":"application/json",Origin:f.env.APP_ORIGIN},body:JSON.stringify(body)}),f.env,f.auth,{waitUntil(){}} as any);
 it("fails before writing when both explicit configuration and required defaults are missing",async()=>{
  const count=(await f.db.pool.query("SELECT count(*)::int n FROM app.triggers WHERE tenant_id=$1",[f.tenantId])).rows[0].n;
  const response=await create({name:"missing-settings",requiresVm:true,prompt:"Do work"});
  expect(response.status).toBe(409);expect(await response.json()).toMatchObject({error:{code:"run_defaults_required"}});
  expect((await f.db.pool.query("SELECT count(*)::int n FROM app.triggers WHERE tenant_id=$1",[f.tenantId])).rows[0].n).toBe(count);
 });
 it("copies VM, model, concurrency and permission defaults once, with explicit empty overrides",async()=>{
  await service.setTeamRunDefaults({executionConfigId:"local",requiresVm:true,model:"first-model",concurrencyLimit:3,capacity:7,runScopes:[],portableIntegrationIds:[],allowedTriggerIds:[f.triggerIds[1]]});
  const firstResponse=await create({name:"seeded-first",prompt:"Do work"});expect(firstResponse.status).toBe(201);
  const first=await firstResponse.json() as any;
  expect(first).toMatchObject({executionConfigId:"local",requiresVm:true,model:"first-model",concurrencyLimit:3,runScopes:[],portableIntegrationIds:[]});
  expect((await service.getInvocationPermissions(first.id)).destinationTriggerIds).toEqual([f.triggerIds[1]]);
  await service.setTeamRunDefaults({executionConfigId:"local",requiresVm:true,model:"second-model",vmImage:"alpine:3.22",concurrencyLimit:5,capacity:9,runScopes:["skills:read"],allowedTriggerIds:[]});
  expect(await service.getTrigger(first.id)).toMatchObject({concurrencyLimit:3,runScopes:[],executionConfig:{connectionId:"local"}});
  expect((await service.getInvocationPermissions(first.id)).destinationTriggerIds).toEqual([f.triggerIds[1]]);
  const second=await create({name:"seeded-second",prompt:"Do work"});expect(second.status).toBe(201);
  expect(await second.json()).toMatchObject({model:"second-model",concurrencyLimit:5,runScopes:["skills:read"],executionConfig:{image:"alpine:3.22"}});
  const override=await create({name:"seeded-override",prompt:"Do work",concurrencyLimit:1,runScopes:[],portableIntegrationIds:[],vmImage:"",model:""});
  expect(override.status).toBe(201);const value=await override.json() as any;
  expect(value).toMatchObject({model:"",concurrencyLimit:1,runScopes:[],portableIntegrationIds:[]});expect(value.executionConfig.image).toBeUndefined();
  expect((await service.getInvocationPermissions(value.id)).destinationTriggerIds).toEqual([]);
 });
 it("keeps saved Trigger settings when Team defaults change and validates team-owned destinations",async()=>{
  await expect(service.setTeamRunDefaults({allowedTriggerIds:[crypto.randomUUID()]})).rejects.toMatchObject({status:400});
  const first=(await f.db.pool.query("SELECT id FROM app.triggers WHERE tenant_id=$1 AND name='seeded-first'",[f.tenantId])).rows[0].id;
  const updated=await service.updateTrigger(first,{name:"seeded-first",prompt:"Changed",events:[]});
  expect(updated).toMatchObject({model:"first-model",executionConfigId:"local",requiresVm:true,concurrencyLimit:3,runScopes:[]});
 });
 it("surfaces unavailable default and explicit VM selections without fallback",async()=>{
  await f.db.pool.query("UPDATE app.team_settings SET run_defaults=$2 WHERE tenant_id=$1",[f.tenantId,{executionConfigId:"unavailable",requiresVm:true}]);
  expect((await create({name:"bad-default",prompt:"Do work"})).status).toBe(400);
  await service.setTeamRunDefaults({executionConfigId:"local",requiresVm:true,runScopes:[]});
  expect((await create({name:"bad-explicit",prompt:"Do work",executionConfigId:"unavailable"})).status).toBe(400);
 });
 it("rejects stale default destinations atomically with an actionable error",async()=>{
  const target=crypto.randomUUID();
  await f.db.pool.query("INSERT INTO app.triggers(tenant_id,id,name,slug,encrypted_prompt,execution_config,concurrency_limit) VALUES($1,$2,'temporary-destination','temporary-destination','fixture','{}',1)",[f.tenantId,target]);
  await service.setTeamRunDefaults({executionConfigId:"local",requiresVm:true,runScopes:[],allowedTriggerIds:[target]});
  await f.db.pool.query("DELETE FROM app.triggers WHERE tenant_id=$1 AND id=$2",[f.tenantId,target]);
  const response=await create({name:"stale-destination",prompt:"Do work"});expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({error:{code:"run_defaults_required",message:expect.stringContaining("destination")}});
  expect((await f.db.pool.query("SELECT id FROM app.triggers WHERE tenant_id=$1 AND name='stale-destination'",[f.tenantId])).rows).toEqual([]);
 });

 it("seeds provider credentials, validates ownership before VM setup, and permits explicit empty selections",async()=>{
  const credentials=new CredentialRepository(f.db,f.tenantId,f.env.CREDENTIAL_ENCRYPTION_KEY);
  const bearer=crypto.randomUUID(),model=crypto.randomUUID();
  await credentials.write({id:bearer,idempotencyKey:crypto.randomUUID(),expectedRevision:await credentials.revision(),operation:"upsert",kind:"bearer",name:"Team bearer",origin:"https://fixture.example.test",description:null,managedSecret:"synthetic-bearer"});
  await credentials.write({id:model,idempotencyKey:crypto.randomUUID(),expectedRevision:await credentials.revision(),operation:"upsert",kind:"model",name:"Team model",origin:null,description:null,managedModelPayload:JSON.stringify({providerUrl:"https://model.fixture/v1",apiKey:"synthetic-model"})});
  await expect(service.setTeamRunDefaults({modelAccountId:crypto.randomUUID()})).rejects.toMatchObject({status:400});
  await service.setTeamRunDefaults({executionConfigId:"local",requiresVm:true,model:"first-model",modelAccountId:model,portableIntegrationIds:[bearer],runScopes:[]});
  const response=await create({name:"credential-seed",prompt:"Do work"});expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({modelAccountId:model,portableIntegrationIds:[bearer]});
  await credentials.write({id:bearer,idempotencyKey:crypto.randomUUID(),expectedRevision:await credentials.revision(),operation:"delete",kind:"bearer",name:"Team bearer",origin:"https://fixture.example.test",description:null});
  expect((await create({name:"revoked-default",prompt:"Do work"})).status).toBe(400);
  const override=await create({name:"empty-provider-override",prompt:"Do work",portableIntegrationIds:[]});expect(override.status).toBe(201);
  expect(await override.json()).toMatchObject({portableIntegrationIds:[],modelAccountId:model});
 });

 it("bounds direct-run destination defaults and delegated permissions by the active caller",async()=>{
  const target=f.triggerIds[1],denied=f.triggerIds[2];
  const account=crypto.randomUUID(),records=new CredentialRepository(f.db,f.tenantId,f.env.CREDENTIAL_ENCRYPTION_KEY);await records.write({id:account,kind:"model",name:"Delegation",origin:null,description:null,expectedRevision:await records.revision(),idempotencyKey:crypto.randomUUID(),operation:"upsert",managedModelPayload:JSON.stringify({providerUrl:"https://model.fixture/v1"})});
  await service.setTeamRunDefaults({executionConfigId:"local",requiresVm:true,modelAccountId:account,model:"fixture",capacity:20,runScopes:["runs:start","runs:invoke"],allowedTriggerIds:[target]});
  const owner=new ApiService(f.env,{...f.auth,scopes:[...f.auth.scopes,"runs:start"]});
  const parent=await owner.startRun({prompt:"Parent",idempotencyKey:"permission-parent"});
  await f.db.pool.query("UPDATE app.runs SET state='running' WHERE tenant_id=$1 AND id=$2",[f.tenantId,parent.runId]);
  await f.db.pool.query("UPDATE app.trigger_runs SET state='running' WHERE tenant_id=$1 AND id=$2",[f.tenantId,parent.runId]);
  await f.db.pool.query("INSERT INTO app.vendor_run_identity_bindings(tenant_id,run_id,provider,vm_id,issuer,subject,audience,issued_at,expires_at) VALUES($1,$2::uuid,'fly.io',$2::text,'https://issuer.example.test',$2::text,'factorize',now(),now()+interval '1 hour')",[f.tenantId,parent.runId]);
  const actor=new ApiService(f.env,{...f.auth,authMethod:"vendor_identity",runId:parent.runId,runIdentityProvider:"fly.io",scopes:["runs:start","runs:invoke"]});
  await expect(actor.invokeTrigger(target,{prompt:"Allowed",idempotencyKey:"allowed-destination"})).resolves.toHaveProperty("runId");
  await expect(actor.invokeTrigger(denied,{prompt:"Denied"})).rejects.toMatchObject({status:403});
  await service.setTeamRunDefaults({executionConfigId:"local",requiresVm:true,modelAccountId:account,model:"fixture",capacity:20,runScopes:["runs:start","runs:invoke","skills:write"],allowedTriggerIds:[target,denied]});
  const child=await actor.startRun({prompt:"Bounded child",idempotencyKey:"permission-child"});
  const config=(await f.db.pool.query("SELECT execution_config FROM app.runs WHERE tenant_id=$1 AND id=$2",[f.tenantId,child.runId])).rows[0].execution_config;
  expect(config.allowedTriggerIds).toEqual([target]);expect(config.runScopes).not.toContain("skills:write");
  await f.db.pool.query("UPDATE app.vendor_run_identity_bindings SET revoked_at=now() WHERE tenant_id=$1 AND run_id=$2",[f.tenantId,parent.runId]);
  await expect(actor.invokeTrigger(target,{prompt:"Revoked"})).rejects.toMatchObject({status:403});
 });

});
