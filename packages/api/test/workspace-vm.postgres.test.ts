import {beforeAll,afterAll,describe,it,expect,vi} from "vitest";
import {createServer,type Server} from "node:http";
import {loadingFixture} from "./helpers/loading-fixture";
import {ApiService} from "../src/flow-service";
import {CredentialRepository} from "../src/postgres/credential-repository";
import {RunRepository,type PersistedRun} from "../src/postgres/run-repository";
import {HostedPi} from "../src/hosted-pi";
import {WorkspaceVm,WorkspaceLeaseLost} from "../src/workspace-vm";
import type {WorkspaceProvider} from "../src/workspace-providers";
import {FlyConnectionRepository} from "../src/postgres/fly-connection-repository";
import {FlyExecutionConfigurationRepository} from "../src/postgres/fly-execution-configuration-repository";
import {startRunInput} from "../src/flow-schemas";
vi.mock("cloudflare:workers",()=>({WorkerEntrypoint:class{},WorkflowEntrypoint:class{},DurableObject:class{}}));
vi.mock("@cloudflare/workers-oauth-provider",()=>({OAuthProvider:class{},AuthorizationError:class extends Error{},getOAuthApi:vi.fn()}));
describe.skipIf(!process.env.AUTH_TEST_DATABASE_URL)("optional, bound workspace VMs",()=>{
 let f:Awaited<ReturnType<typeof loadingFixture>>,service:ApiService,server:Server,account:string,flyId:string;
 let modelRequests=0;
 beforeAll(async()=>{
  f=await loadingFixture(process.env.AUTH_TEST_DATABASE_URL!);f.auth.scopes.push("runs:start");service=new ApiService(f.env,f.auth);
  server=createServer(async(req,res)=>{for await(const _ of req){}modelRequests++;res.writeHead(200,{"Content-Type":"text/event-stream"});res.end('data: '+JSON.stringify({id:"local",object:"chat.completion.chunk",model:"fixture",choices:[{index:0,delta:{role:"assistant",content:"Workspace work complete."},finish_reason:"stop"}]})+'\n\ndata: [DONE]\n\n');});
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));account=crypto.randomUUID();
  await new CredentialRepository(f.db,f.tenantId,f.env.CREDENTIAL_ENCRYPTION_KEY).write({id:account,kind:"model",name:"Local",origin:null,description:null,expectedRevision:0,idempotencyKey:crypto.randomUUID(),operation:"upsert",managedModelPayload:JSON.stringify({providerUrl:`http://127.0.0.1:${(server.address() as any).port}/v1`})});
  await new FlyConnectionRepository(f.db,f.tenantId,f.env.CREDENTIAL_ENCRYPTION_KEY).save({organizationSlug:"fixture",organizationName:"Fixture"},"fixture-token");
  flyId=(await new FlyExecutionConfigurationRepository(f.db,f.tenantId).save({name:"Fixture",image:"fixture/image:v1",region:"ord",size:"shared-cpu-1x"})).id;
  await service.setTeamRunDefaults({modelAccountId:account,model:"fixture",capacity:50,requiresVm:false});
 });
 afterAll(async()=>{server?.closeAllConnections();await new Promise<void>(resolve=>server?.close(()=>resolve()));await f?.cleanup();});
 async function launch(overrides:Record<string,unknown>={}){
  const receipt=await service.startRun(startRunInput.parse({prompt:"Work",...overrides}));
  await f.db.pool.query("UPDATE app.runs SET state='running' WHERE tenant_id=$1 AND id=$2",[f.tenantId,receipt.runId]);
  await f.db.pool.query("UPDATE app.trigger_runs SET state='running' WHERE tenant_id=$1 AND id=$2",[f.tenantId,receipt.runId]);
  const row=(await f.db.pool.query("SELECT r.*,j.encrypted_prompt FROM app.runs r JOIN app.trigger_runs j USING(tenant_id,id) WHERE r.tenant_id=$1 AND r.id=$2",[f.tenantId,receipt.runId])).rows[0];
  return {tenantId:f.tenantId,id:row.id,invocationId:row.invocation_id,triggerId:null,state:"running",backendKind:"hosted-pi",encryptedPrompt:row.encrypted_prompt,executionConfig:row.execution_config,executionHandle:null,capabilities:[],artifactState:"pending",resultProtocolVersion:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()} as PersistedRun;
 }
 function adapter(events:string[],failure=false):WorkspaceProvider{return {reserve:()=>({id:"fixture"}),async provision(_h,save){events.push("provision");if(failure)throw new Error("Selected VM is unavailable");await save(_h);},async verify(){events.push("verify");},async execute(_h,command){events.push(command.includes("mkdir")?"ready":"proof");return {output:"FACTORIZE_WORKSPACE_READY",exitCode:0};},async remove(){events.push("remove");}};}
 it.each(["exe","fly"])("waits for %s readiness before an actual Pi provider turn, binds reflection and cleans up",async provider=>{
  const run=await launch({executionConfigId:provider==="fly"?flyId:"local"}),events:string[]=[];
  const vm=new WorkspaceVm(f.db,f.env,async()=>adapter(events));
  const pi=new HostedPi(f.db,f.env,async()=>[],async run=>{await vm.beforeTurn(run);events.push("model");});
  const count=modelRequests;await pi.initialize(run);await vm.ensure(run);expect(modelRequests).toBe(count);
  await pi.advance(run);expect(modelRequests).toBe(count+1);expect(events.indexOf("ready")).toBeLessThan(events.indexOf("model"));
  expect(await vm.current(f.tenantId,run.id)).toMatchObject({provider:provider==="fly"?"fly.io":"exe.dev",runId:run.id,status:"ready"});
  expect((await f.db.pool.query("SELECT vm_cleanup_complete FROM app.runs WHERE tenant_id=$1 AND id=$2",[f.tenantId,run.id])).rows[0].vm_cleanup_complete).toBe(false);
  await vm.cleanup(f.tenantId,run.id);expect(events.at(-1)).toBe("remove");expect((await vm.row(f.tenantId,run.id))!.status).toBe("deleted");
 });
 it("runs VM-free without provider construction, even with an unused unavailable VM default",async()=>{
  await f.db.pool.query("UPDATE app.team_settings SET run_defaults=run_defaults||'{\"executionConfigId\":\"missing\",\"requiresVm\":false}'::jsonb WHERE tenant_id=$1",[f.tenantId]);
  const run=await launch(),factory=vi.fn(async()=>{throw new Error("No provider should be constructed");});
  const vm=new WorkspaceVm(f.db,f.env,factory);await vm.ensure(run);await vm.beforeTurn(run);expect(factory).not.toHaveBeenCalled();expect(await vm.current(f.tenantId,run.id)).toBeNull();
  await new HostedPi(f.db,f.env).initialize(run);await new HostedPi(f.db,f.env).advance(run);
  expect((await vm.row(f.tenantId,run.id))).toBeNull();
 });
 it("fails explicit and selected Team defaults without fallback or a model turn",async()=>{
  const count=modelRequests;
  await expect(service.startRun(startRunInput.parse({prompt:"Work",executionConfigId:"absent"}))).rejects.toMatchObject({status:400});
  await f.db.pool.query("UPDATE app.team_settings SET run_defaults=run_defaults||'{\"requiresVm\":true}'::jsonb WHERE tenant_id=$1",[f.tenantId]);
  await expect(service.startRun(startRunInput.parse({prompt:"Work"}))).rejects.toMatchObject({status:400});
  const run=await launch({executionConfigId:"local"}),vm=new WorkspaceVm(f.db,f.env,async()=>adapter([],true));
  await expect(vm.ensure(run)).rejects.toThrow("Selected VM");expect((await vm.row(f.tenantId,run.id))!.status).toBe("failed");expect(modelRequests).toBe(count);
  await vm.cleanup(f.tenantId,run.id);
 });
 it("seeds optional VM settings once and keeps saved Trigger choices independent of later Team changes",async()=>{
  await service.setTeamRunDefaults({modelAccountId:account,model:"fixture",requiresVm:false});
  const trigger=await service.createTrigger({name:"optional-workspace",prompt:"Work",events:[{kind:"manual",enabled:true,config:{}}]});
  expect(trigger.requiresVm).toBe(false);expect(trigger.executionConfig.connectionId).toBe("");
  const bound=await service.updateTrigger(trigger.id,{name:trigger.name,prompt:"Work",requiresVm:true,executionConfigId:"local",events:[{kind:"manual",enabled:true,config:{}}]});expect(bound.requiresVm).toBe(true);
  await service.setTeamRunDefaults({modelAccountId:account,model:"fixture",requiresVm:false});
  expect((await service.getTrigger(trigger.id)).requiresVm).toBe(true);
  const free=await service.updateTrigger(trigger.id,{name:trigger.name,prompt:"Work",requiresVm:false,events:[{kind:"manual",enabled:true,config:{}}]});expect(free.executionConfig.connectionId).toBe("");expect(free.requiresVm).toBe(false);
 });
 it("rejects client-selected current VM identity and denies unbound external execution",async()=>{
  const {vmExecInput}=await import("../src/agent-api-contracts");expect(vmExecInput.safeParse({command:"pwd",vmId:"somebody-else"}).success).toBe(false);
  expect(startRunInput.safeParse({prompt:"Work",script:"echo work",requiresVm:false}).success).toBe(false);
  await expect(service.vmExec({command:"pwd"})).rejects.toMatchObject({status:403,code:"workspace_required"});
  expect(await new WorkspaceVm(f.db,f.env).current(f.otherTenant,crypto.randomUUID())).toBeNull();
 });
 it("retains a late provisioning receipt after cancellation and retries cleanup",async()=>{
  const run=await launch({executionConfigId:"local"});let release!:()=>void,entered!:()=>void;
  const started=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve);let removed=0;
  const provider=adapter([]);provider.provision=async(handle,save)=>{entered();await gate;await save(handle);};provider.remove=async()=>{if(++removed===1)throw new Error("retry deletion");};
  const vm=new WorkspaceVm(f.db,f.env,async()=>provider),pending=vm.ensure(run);await started;
  await f.db.pool.query("UPDATE app.runs SET state='stopping' WHERE tenant_id=$1 AND id=$2",[f.tenantId,run.id]);
  await expect(vm.cleanup(f.tenantId,run.id)).rejects.toThrow("still active");release();await expect(pending).rejects.toBeInstanceOf(WorkspaceLeaseLost);
  await expect(vm.cleanup(f.tenantId,run.id)).rejects.toThrow("retry deletion");await vm.cleanup(f.tenantId,run.id);expect(removed).toBe(2);
 });
 it("rechecks the calling lease after slow verification and before any command effect",async()=>{
  const run=await launch({executionConfigId:"local"}),provider=adapter([]),vm=new WorkspaceVm(f.db,f.env,async()=>provider);await vm.ensure(run);
  const execute=vi.spyOn(provider,"execute");await expect(vm.execute(f.tenantId,run.id,"must-not-execute",undefined,undefined,async()=>{throw new Error("Calling lease was replaced");})).rejects.toThrow("lease was replaced");
  expect(execute).toHaveBeenCalledTimes(1);expect(execute.mock.calls[0][1]).not.toContain("must-not-execute");await vm.cleanup(f.tenantId,run.id);
 });
 it("fails a replaced workspace proof without executing the requested command",async()=>{
  const run=await launch({executionConfigId:"local"}),provider=adapter([]),vm=new WorkspaceVm(f.db,f.env,async()=>provider);await vm.ensure(run);
  provider.execute=vi.fn(async()=>({output:"wrong",exitCode:0}));await expect(vm.execute(f.tenantId,run.id,"dangerous")).rejects.toThrow("identity proof");expect(provider.execute).toHaveBeenCalledTimes(1);await vm.cleanup(f.tenantId,run.id);
 });
});
