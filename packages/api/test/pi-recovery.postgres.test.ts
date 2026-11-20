import {beforeAll,afterAll,beforeEach,describe,it,expect,vi} from "vitest";
import {createServer,type Server} from "node:http";
import {loadingFixture} from "./helpers/loading-fixture";
import {ApiService} from "../src/flow-service";
import {HostedPi} from "../src/hosted-pi";
import {PiSessionRepository,PiLeaseLost,type PiLease} from "../src/postgres/pi-session-repository";
import {PiToolJournal,PiToolUncertain,canonicalToolArguments} from "../src/pi-tools";
import {RunRepository,type PersistedRun} from "../src/postgres/run-repository";
import {RunScheduler} from "../src/postgres/run-scheduler";
import {CredentialRepository} from "../src/postgres/credential-repository";
import {startRunInput} from "../src/flow-schemas";
import {encrypt} from "../src/crypto";
import type {AgentTool,AgentMessage} from "@earendil-works/pi-agent-core";
vi.mock("cloudflare:workers",()=>({WorkerEntrypoint:class{},WorkflowEntrypoint:class{},DurableObject:class{}}));
vi.mock("@cloudflare/workers-oauth-provider",()=>({OAuthProvider:class{},AuthorizationError:class extends Error{},getOAuthApi:vi.fn()}));
const assistant=(calls:{id:string;name:string;arguments:any}[])=>({role:"assistant" as const,content:calls.map(call=>({type:"toolCall" as const,...call})),api:"openai-completions",provider:"openai",model:"fixture",usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:"toolUse",timestamp:Date.now()});
describe.skipIf(!process.env.AUTH_TEST_DATABASE_URL)("durable hosted Pi recovery",()=>{
 let f:Awaited<ReturnType<typeof loadingFixture>>,api:ApiService,server:Server,account:string,run:PersistedRun,sessions:PiSessionRepository,requests:any[],mode:"final"|"slow",slowResponses:any[]=[];
 beforeAll(async()=>{
  f=await loadingFixture(process.env.AUTH_TEST_DATABASE_URL!);f.auth.scopes.push("runs:start");api=new ApiService(f.env,f.auth);account=crypto.randomUUID();
  server=createServer(async(req,res)=>{const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(chunk);requests.push(JSON.parse(Buffer.concat(chunks).toString()));res.writeHead(200,{"Content-Type":"text/event-stream"});res.write("data: "+JSON.stringify({id:"local",object:"chat.completion.chunk",model:"fixture",choices:[{index:0,delta:{role:"assistant",content:mode==="slow"?"Partial":"Recovered."},finish_reason:mode==="slow"?null:"stop"}]})+"\n\n");if(mode!=="slow")res.end("data: [DONE]\n\n");else slowResponses.push(res);});
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  await new CredentialRepository(f.db,f.tenantId,f.env.CREDENTIAL_ENCRYPTION_KEY).write({id:account,kind:"model",name:"Local",origin:null,description:null,expectedRevision:0,idempotencyKey:crypto.randomUUID(),operation:"upsert",managedModelPayload:JSON.stringify({providerUrl:`http://127.0.0.1:${(server.address() as any).port}/v1`})});
  await api.setTeamRunDefaults({modelAccountId:account,model:"fixture",requiresVm:false,capacity:50,runScopes:[]});sessions=new PiSessionRepository(f.db,f.env.CREDENTIAL_ENCRYPTION_KEY);
 });
 beforeEach(async()=>{
  requests=[];mode="final";const receipt=await api.startRun(startRunInput.parse({prompt:"Recover work"}));
  await f.db.pool.query("UPDATE app.runs SET state='running',execution_handle=$3 WHERE tenant_id=$1 AND id=$2",[f.tenantId,receipt.runId,{backendKind:"hosted-pi",id:receipt.runId}]);
  await f.db.pool.query("UPDATE app.trigger_runs SET state='running' WHERE tenant_id=$1 AND id=$2",[f.tenantId,receipt.runId]);run=(await new RunRepository(f.db).find(f.tenantId,receipt.runId))!;await new HostedPi(f.db,f.env).initialize(run);
 });
 afterAll(async()=>{server?.closeAllConnections();await new Promise<void>(resolve=>server?.close(()=>resolve()));await f?.cleanup();});
 function tool(name:string,execute:AgentTool<any>["execute"]):AgentTool<any>{return {name,label:name,description:"Local recovery tool",parameters:{type:"object",additionalProperties:true},execute};}
 async function checkpointCalls(calls:{id:string;name:string;arguments:any}[]){const lease=(await sessions.claim(f.tenantId,run.id))!;await sessions.checkpoint(lease,[...lease.messages,assistant(calls)] as AgentMessage[]);return lease;}
 async function expire(){await f.db.pool.query("UPDATE app.pi_sessions SET lease_expires_at=now()-interval '1 second' WHERE tenant_id=$1 AND run_id=$2",[f.tenantId,run.id]);}
 it("replays committed tool results after a crash without repeating effects and executes only missing calls",async()=>{
  let first=0,second=0;const tools=[tool("write_first",async()=>{first++;return {content:[{type:"text",text:"First receipt"}],details:{receipt:"one"}};}),tool("write_second",async()=>{second++;return {content:[{type:"text",text:"Second receipt"}],details:{receipt:"two"}};})];
  const lease=await checkpointCalls([{id:"first",name:"write_first",arguments:{value:1}},{id:"second",name:"write_second",arguments:{value:2}}]);
  await new PiToolJournal(f.db,f.env.CREDENTIAL_ENCRYPTION_KEY,lease).wrap(tools)[0].execute("first",{value:1});await expire();
  await new HostedPi(f.db,f.env,async()=>tools).advance(run);
  expect(first).toBe(1);expect(second).toBe(1);expect(requests).toHaveLength(1);expect(requests[0].messages.filter((message:any)=>message.role==="tool").map((message:any)=>message.content)).toEqual(["First receipt","Second receipt"]);expect((await sessions.read(f.tenantId,run.id))!.status).toBe("complete");
 });
 it("blocks uncertain mutating effects and prevents remaining batch effects or a subsequent model request",async()=>{
  let effects=0;const tools=[tool("write_remote",async()=>{effects++;throw new Error("Connection lost after write");}),tool("write_after",async()=>{effects++;return {content:[],details:{}};})];
  const lease=await checkpointCalls([{id:"uncertain",name:"write_remote",arguments:{}},{id:"after",name:"write_after",arguments:{}}]);
  const journal=new PiToolJournal(f.db,f.env.CREDENTIAL_ENCRYPTION_KEY,lease);await expect(journal.wrap(tools)[0].execute("uncertain",{})).rejects.toBeInstanceOf(PiToolUncertain);await expire();
  await new HostedPi(f.db,f.env,async()=>tools).advance(run);await new HostedPi(f.db,f.env,async()=>tools).advance(run);
  expect(effects).toBe(1);expect(requests).toHaveLength(0);expect((await sessions.read(f.tenantId,run.id))!.status).toBe("uncertain");expect((await new RunRepository(f.db).find(f.tenantId,run.id))).toMatchObject({state:"blocked",failureCode:"pi_tool_uncertain"});
 });
 it("retries an interrupted start_run with a stable server idempotency key and one child receipt",async()=>{
  const receipts:string[]=[],keys:string[]=[];const tools=[tool("start_run",async(_id,args)=>{keys.push(args.idempotencyKey);const child=await api.startRun(startRunInput.parse({prompt:"Child",idempotencyKey:args.idempotencyKey}));receipts.push(child.runId);return {content:[{type:"text",text:child.runId}],details:child};})];
  const lease=await checkpointCalls([{id:"child",name:"start_run",arguments:{prompt:"Child"}}]);await new PiToolJournal(f.db,f.env.CREDENTIAL_ENCRYPTION_KEY,lease).wrap(tools)[0].execute("child",{prompt:"Child"});
  // Simulate interruption after the downstream receipt but before journal commit.
  await f.db.pool.query("UPDATE app.pi_tool_calls SET state='started',encrypted_result=NULL WHERE tenant_id=$1 AND run_id=$2",[f.tenantId,run.id]);await expire();
  await new HostedPi(f.db,f.env,async()=>tools).advance(run);expect(keys).toHaveLength(2);expect(keys[0]).toBe(keys[1]);expect(receipts[0]).toBe(receipts[1]);
 });
 it("keeps an interrupted idempotent response on its original call instead of asking the model to repeat it",async()=>{
  let attempts=0;const receipts:string[]=[],keys:string[]=[];
  const tools=[tool("start_run",async(_id,args)=>{keys.push(args.idempotencyKey);const receipt=await api.startRun(startRunInput.parse({prompt:"Retry response",idempotencyKey:args.idempotencyKey}));receipts.push(receipt.runId);if(++attempts===1)throw new Error("Response disconnected after admission");return {content:[{type:"text",text:receipt.runId}],details:receipt};})];
  const lease=await checkpointCalls([{id:"retry-response",name:"start_run",arguments:{prompt:"Retry response"}}]);await sessions.release(lease);
  await new HostedPi(f.db,f.env,async()=>tools).advance(run);expect(requests).toHaveLength(0);expect((await sessions.read(f.tenantId,run.id))!.status).toBe("ready");
  await new HostedPi(f.db,f.env,async()=>tools).advance(run);expect(receipts).toHaveLength(2);expect(receipts[0]).toBe(receipts[1]);expect(keys[0]).toBe(keys[1]);expect(requests).toHaveLength(1);expect((await sessions.read(f.tenantId,run.id))!.status).toBe("complete");
 });
 it("fences a late tool completion after another worker claims the expired lease",async()=>{
  let complete!:()=>void,entered!:()=>void;const gate=new Promise<void>(resolve=>complete=resolve),started=new Promise<void>(resolve=>entered=resolve);
  const tools=[tool("vm_exec",async()=>{entered();await gate;return {content:[{type:"text",text:"Effect"}],details:{}};})];
  const lease=await checkpointCalls([{id:"late",name:"vm_exec",arguments:{command:"work"}}]);const pending=new PiToolJournal(f.db,f.env.CREDENTIAL_ENCRYPTION_KEY,lease).wrap(tools)[0].execute("late",{command:"work"});await started;await expire();const next=(await sessions.claim(f.tenantId,run.id))!;expect(next.epoch).toBeGreaterThan(lease.epoch);complete();await expect(pending).rejects.toBeInstanceOf(PiLeaseLost);
  const journal=new PiToolJournal(f.db,f.env.CREDENTIAL_ENCRYPTION_KEY,next);await expect(journal.wrap(tools)[0].execute("late",{command:"work"})).rejects.toBeInstanceOf(PiToolUncertain);
 });
 it("recovers an interrupted stream under a new lease while the old worker is fenced",async()=>{
  mode="slow";const old=new HostedPi(f.db,f.env).advance(run);await vi.waitFor(()=>expect(requests).toHaveLength(1));await f.db.pool.query("UPDATE app.pi_sessions SET epoch=epoch+1,lease_id=NULL,lease_expires_at=NULL WHERE tenant_id=$1 AND run_id=$2",[f.tenantId,run.id]);mode="final";
  await new HostedPi(f.db,f.env).advance(run);for(const response of slowResponses)response.end("data: [DONE]\n\n");slowResponses=[];await old;
  expect(requests).toHaveLength(2);expect((await sessions.read(f.tenantId,run.id))!.status).toBe("complete");expect((await new RunRepository(f.db).find(f.tenantId,run.id))!.state).toBe("succeeded");
 },15000);
 it("commits an async receipt before any VM/provider call and dispatches hosted work to its independent alarm",async()=>{
  const receipt=await api.startRun(startRunInput.parse({prompt:"Asynchronous",idempotencyKey:"async-receipt"}));expect(requests).toHaveLength(0);expect(await api.startRun(startRunInput.parse({prompt:"Asynchronous",idempotencyKey:"async-receipt"}))).toMatchObject({runId:receipt.runId,duplicate:true});
  await f.db.pool.query("UPDATE app.runs SET vm_cleanup_complete=true WHERE state IN ('succeeded','failed','stopped')");
  // Existing seeded VM runs are unrelated to this dedicated scheduling fixture.
  await f.db.pool.query("UPDATE app.trigger_runs SET next_poll_at=now()+interval '1 day' WHERE id<>$1",[receipt.runId]);
  const wakes:any[]=[],binding={idFromName:(name:string)=>name,get:(name:string)=>({fetch:async(_url:string,init:RequestInit)=>{wakes.push({name,body:JSON.parse(String(init.body))});return Response.json({scheduled:true});}})} as any;
  await new RunScheduler(f.db,{...f.env,SCHEDULER:binding}).process();expect(wakes.some(wake=>wake.body.runId===receipt.runId&&wake.name.includes(receipt.runId))).toBe(true);expect(requests).toHaveLength(0);
 });
});
