import {beforeAll,afterAll,beforeEach,describe,it,expect,vi} from "vitest";
import {createServer,type Server} from "node:http";
import {loadingFixture} from "./helpers/loading-fixture";
import {RunScheduler} from "../src/postgres/run-scheduler";
import {HostedPi} from "../src/hosted-pi";
import {PiSessionRepository} from "../src/postgres/pi-session-repository";
import {CredentialRepository} from "../src/postgres/credential-repository";
import {RunRepository,type PersistedRun} from "../src/postgres/run-repository";
import {encrypt,decrypt} from "../src/crypto";
vi.mock("cloudflare:workers",()=>({WorkerEntrypoint:class{},WorkflowEntrypoint:class{},DurableObject:class{}}));
vi.mock("@cloudflare/workers-oauth-provider",()=>({OAuthProvider:class{},AuthorizationError:class extends Error{},getOAuthApi:vi.fn()}));

describe.skipIf(!process.env.AUTH_TEST_DATABASE_URL)("bundled hosted Pi with PostgreSQL",()=>{
 let f:Awaited<ReturnType<typeof loadingFixture>>,server:Server,origin:string,accountId:string,run:PersistedRun,requests:any[];
 let mode:"text"|"tool"|"error"|"slow"|"compact"="text",turn=0;
 beforeAll(async()=>{
  f=await loadingFixture(process.env.AUTH_TEST_DATABASE_URL!);accountId=crypto.randomUUID();
  server=createServer(async(req,res)=>{
   const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString());requests.push({body,authorization:req.headers.authorization,path:req.url});
   if(mode==="error"){res.writeHead(400,{"Content-Type":"application/json"});res.end(JSON.stringify({error:{message:"fixture provider failure",type:"invalid_request_error"}}));return;}
   res.writeHead(200,{"Content-Type":"text/event-stream"});
   const send=(delta:unknown,finish_reason:string|null=null)=>res.write("data: "+JSON.stringify({id:"fixture-completion",object:"chat.completion.chunk",created:1,model:"fixture",choices:[{index:0,delta,finish_reason}]})+"\n\n");
   send({role:"assistant"});
   if(mode==="slow"){send({content:"Partial"});return;}
   const summarizing=body.messages.some((message:any)=>typeof message.content==="string"&&message.content.startsWith("Summarize this agent transcript"));
   const useTool=!summarizing&&(mode==="tool"&&turn++===0 || mode==="compact"&&turn++<5);
   if(useTool){send({tool_calls:[{index:0,id:"call-"+turn,type:"function",function:{name:"fixture_tool",arguments:'{"value":"work"}'}}]});send({},"tool_calls");}
   else{send({content:summarizing?"Earlier work preserved.":"A streamed "});send({content:summarizing?" Continue.":"result."});send({},"stop");}
   res.end("data: [DONE]\n\n");
  });
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));origin=`http://127.0.0.1:${(server.address() as any).port}/v1`;
  await new CredentialRepository(f.db,f.tenantId,f.env.CREDENTIAL_ENCRYPTION_KEY).write({id:accountId,kind:"model",name:"Fixture model",origin:null,description:null,expectedRevision:0,idempotencyKey:crypto.randomUUID(),operation:"upsert",managedModelPayload:JSON.stringify({providerUrl:origin,apiKey:"local-provider-key",contextWindow:1024,maxTokens:100})});
 });
 beforeEach(async()=>{
  requests=[];turn=0;mode="text";
  const id=crypto.randomUUID(),invocationId=crypto.randomUUID(),prompt=await encrypt("Do fixture work",f.env.CREDENTIAL_ENCRYPTION_KEY);
  await f.db.pool.query("INSERT INTO app.invocations(tenant_id,id,trigger_id,source,claim_key,context) VALUES($1,$2,NULL,'direct',$3,'{}')",[f.tenantId,invocationId,id]);
  await f.db.pool.query("INSERT INTO app.trigger_runs(tenant_id,id,invocation_id,trigger_id,state,encrypted_prompt) VALUES($1,$2,$3,NULL,'running',$4)",[f.tenantId,id,invocationId,prompt]);
  const config={agentKind:"pi",executionType:"agent",modelAccountId:accountId,modelAccess:"portable",model:"fixture",runScopes:[]};
  await f.db.pool.query("INSERT INTO app.runs(tenant_id,id,invocation_id,provider,issue_id,agent_name,agent_kind,state,execution_backend_kind,execution_config,execution_handle) VALUES($1,$2,$3,'direct',($2::uuid)::text,'','pi','running','hosted-pi',$4,$5)",[f.tenantId,id,invocationId,config,{backendKind:"hosted-pi",id}]);
  run={tenantId:f.tenantId,id,invocationId,triggerId:null,state:"running",backendKind:"hosted-pi",encryptedPrompt:prompt,executionConfig:config,executionHandle:{backendKind:"hosted-pi",id},capabilities:["recovery","stop"],artifactState:"pending",resultProtocolVersion:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
 });
 afterAll(async()=>{server?.closeAllConnections();await new Promise<void>(resolve=>server?.close(()=>resolve()));await f?.cleanup();});
 const tools=async()=>[{name:"fixture_tool",label:"Fixture",description:"A deterministic tool",parameters:{type:"object",properties:{value:{type:"string"}},required:["value"]},execute:async()=>({content:[{type:"text" as const,text:mode==="compact"?"Evidence "+"x".repeat(3000):"Tool done"}],details:{}})}];
 it("runs a real Pi streaming turn, authenticates the provider and persists encrypted session events and results",async()=>{
  const pi=new HostedPi(f.db,f.env);await pi.initialize(run);await pi.advance(run);
  expect(requests).toHaveLength(1);expect(requests[0]).toMatchObject({authorization:"Bearer local-provider-key",path:"/v1/chat/completions"});
  const session=await new PiSessionRepository(f.db,f.env.CREDENTIAL_ENCRYPTION_KEY).read(f.tenantId,run.id);expect(session!.status).toBe("complete");expect(session!.framework_version).toBe("1.5.2");
  const saved=(await f.db.pool.query("SELECT state,trigger_result FROM app.runs WHERE tenant_id=$1 AND id=$2",[f.tenantId,run.id])).rows[0];expect(saved).toMatchObject({state:"succeeded",trigger_result:{summary:"A streamed result."}});
  const events=(await f.db.pool.query("SELECT event_type,encrypted_event FROM app.pi_session_events WHERE tenant_id=$1 AND run_id=$2 ORDER BY sequence",[f.tenantId,run.id])).rows;
  expect((await f.db.pool.query("SELECT preview_text FROM app.run_trace_events WHERE tenant_id=$1 AND run_id=$2 AND event_type='assistant_message'",[f.tenantId,run.id])).rows.at(-1)?.preview_text).toBe("A streamed result.");
  const update=JSON.parse(await decrypt(events.find(event=>event.event_type==="message_update").encrypted_event,f.env.CREDENTIAL_ENCRYPTION_KEY));expect(update).not.toHaveProperty("message");expect(update.delta).not.toHaveProperty("partial");
  expect(events.filter(event=>event.event_type==="message_update").length).toBeGreaterThan(1);expect(events.some(event=>event.encrypted_event.includes("streamed"))).toBe(false);
  expect(JSON.parse(await decrypt(events.find(event=>event.event_type==="message_end").encrypted_event,f.env.CREDENTIAL_ENCRYPTION_KEY)).message.role).toBe("assistant");
 });
 it("recovers a tool turn using a fresh harness instance and the PostgreSQL checkpoint",async()=>{
  mode="tool";const first=new HostedPi(f.db,f.env,tools);await first.initialize(run);await first.advance(run);
  const sessions=new PiSessionRepository(f.db,f.env.CREDENTIAL_ENCRYPTION_KEY);expect((await sessions.read(f.tenantId,run.id))!.status).toBe("ready");
  await new HostedPi(f.db,f.env,tools).advance(run);
  expect(requests).toHaveLength(2);expect(requests[1].body.messages.some((message:any)=>message.role==="tool"&&message.content==="Tool done")).toBe(true);
  expect((await sessions.read(f.tenantId,run.id))!.status).toBe("complete");
 });
 it("uses framework model calls for durable context compaction and retains original events",async()=>{
  mode="compact";const pi=new HostedPi(f.db,f.env,tools);await pi.initialize(run);for(let i=0;i<6;i++)await new HostedPi(f.db,f.env,tools).advance(run);
  const session=await new PiSessionRepository(f.db,f.env.CREDENTIAL_ENCRYPTION_KEY).read(f.tenantId,run.id);expect(session!.status).toBe("complete");expect(session!.compaction_count).toBeGreaterThan(0);
  expect(session!.messages.some((message:any)=>message.role==="user"&&String(message.content).includes("Earlier context summary"))).toBe(true);
  expect((await f.db.pool.query("SELECT count(*)::int n FROM app.pi_session_events WHERE tenant_id=$1 AND run_id=$2 AND event_type='compaction'",[f.tenantId,run.id])).rows[0].n).toBeGreaterThan(0);
 });
 it("surfaces provider failures as failed runs with retained session state",async()=>{
  mode="error";const pi=new HostedPi(f.db,f.env);await pi.initialize(run);await pi.advance(run);
  expect((await new PiSessionRepository(f.db,f.env.CREDENTIAL_ENCRYPTION_KEY).read(f.tenantId,run.id))!.status).toBe("failed");
  expect((await f.db.pool.query("SELECT state,failure_reason FROM app.runs WHERE tenant_id=$1 AND id=$2",[f.tenantId,run.id])).rows[0]).toMatchObject({state:"failed"});
 });
 it("aborts an active streamed response after cancellation and retains the interruption",async()=>{
  mode="slow";const pi=new HostedPi(f.db,f.env);await pi.initialize(run);const pending=pi.advance(run);
  await vi.waitFor(()=>expect(requests.length).toBe(1));
  await f.db.pool.query("UPDATE app.runs SET state='stopping' WHERE tenant_id=$1 AND id=$2",[f.tenantId,run.id]);
  await f.db.pool.query("UPDATE app.trigger_runs SET state='stopping' WHERE tenant_id=$1 AND id=$2",[f.tenantId,run.id]);
  await pending;
  await new HostedPi(f.db,f.env).advance({...run,state:"stopping"});
  expect((await new PiSessionRepository(f.db,f.env.CREDENTIAL_ENCRYPTION_KEY).read(f.tenantId,run.id))!.status).toBe("stopped");
  expect(requests).toHaveLength(1);
 },15000);
 it("streams through a keyless OpenAI-compatible integration without an authorization header",async()=>{
  const credentials=new CredentialRepository(f.db,f.tenantId,f.env.CREDENTIAL_ENCRYPTION_KEY);
  await credentials.write({id:accountId,kind:"model",name:"Keyless",origin:null,description:null,expectedRevision:await credentials.revision(),idempotencyKey:crypto.randomUUID(),operation:"upsert",managedModelPayload:JSON.stringify({providerUrl:origin,contextWindow:1024,maxTokens:100})});
  const pi=new HostedPi(f.db,f.env);await pi.initialize(run);await pi.advance(run);expect(requests).toHaveLength(1);expect(requests[0].authorization).toBeUndefined();
  expect((await f.db.pool.query("SELECT state FROM app.runs WHERE tenant_id=$1 AND id=$2",[f.tenantId,run.id])).rows[0].state).toBe("succeeded");
 });
 it("launches managed agents without constructing a guest backend or relying on a guest CLI",async()=>{
  await f.db.pool.query("UPDATE app.runs SET state='reserved' WHERE tenant_id=$1 AND id=$2",[f.tenantId,run.id]);
  await f.db.pool.query("UPDATE app.trigger_runs SET state='reserved' WHERE tenant_id=$1 AND id=$2",[f.tenantId,run.id]);
  const guest=vi.fn(()=>{throw new Error("Managed Pi must not launch a guest harness");});
  await new RunScheduler(f.db,f.env,guest).process();
  expect(guest).not.toHaveBeenCalled();
  expect((await f.db.pool.query("SELECT state,execution_backend_kind,trace_sources FROM app.runs WHERE tenant_id=$1 AND id=$2",[f.tenantId,run.id])).rows[0]).toMatchObject({state:"running",execution_backend_kind:"hosted-pi",trace_sources:null});
  expect((await new PiSessionRepository(f.db,f.env.CREDENTIAL_ENCRYPTION_KEY).read(f.tenantId,run.id))!.messages.some(message=>message.role==="user")).toBe(true);
 });
 it("fences competing workers, recovers an expired lease and cancels without reopening access",async()=>{
  const pi=new HostedPi(f.db,f.env);await pi.initialize(run);const sessions=new PiSessionRepository(f.db,f.env.CREDENTIAL_ENCRYPTION_KEY);
  const first=await sessions.claim(f.tenantId,run.id);expect(first).not.toBeNull();expect(await sessions.claim(f.tenantId,run.id)).toBeNull();
  await f.db.pool.query("UPDATE app.pi_sessions SET lease_expires_at=now()-interval '1 second' WHERE tenant_id=$1 AND run_id=$2",[f.tenantId,run.id]);
  const next=await sessions.claim(f.tenantId,run.id);expect(next!.epoch).toBeGreaterThan(first!.epoch);await expect(sessions.checkpoint(first!,[])).rejects.toThrow(/lease/);
  await f.db.pool.query("UPDATE app.runs SET state='stopping' WHERE tenant_id=$1 AND id=$2",[f.tenantId,run.id]);await pi.advance({...run,state:"stopping"});
  expect(await sessions.claim(f.tenantId,run.id)).toBeNull();await expect(sessions.event(next!,"late",{})).rejects.toThrow(/lease/);
  expect((await f.db.pool.query("SELECT state FROM app.runs WHERE tenant_id=$1 AND id=$2",[f.tenantId,run.id])).rows[0].state).toBe("stopped");
 });
});
