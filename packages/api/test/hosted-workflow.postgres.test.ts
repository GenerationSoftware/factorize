import {beforeAll,afterAll,describe,it,expect,vi} from "vitest";
import {createServer,type Server} from "node:http";
import {Miniflare,convertV4MiniflareOptions} from "miniflare";
import {loadingFixture} from "./helpers/loading-fixture";
import {protectedApiFetch} from "../src/protected-api";
import {readSession} from "../src/session";
import {ACCESS_SCOPES} from "../src/access-tokens";
import {encrypt} from "../src/crypto";
import {RunRepository} from "../src/postgres/run-repository";
import {RunScheduler} from "../src/postgres/run-scheduler";
import {HostedPi} from "../src/hosted-pi";
import {createPiMcpTools} from "../src/pi-mcp-client";
import {snapshotSkillUri} from "../src/mcp-skills";
import {MediaCleanup} from "../src/postgres/media-cleanup";
import {RunRetentionRepository} from "../src/postgres/run-retention-repository";
import type {OAuthProps} from "../src/types";
vi.mock("cloudflare:workers",()=>({WorkerEntrypoint:class{},WorkflowEntrypoint:class{},DurableObject:class{}}));
vi.mock("@cloudflare/workers-oauth-provider",()=>({OAuthProvider:class{},AuthorizationError:class extends Error{},getOAuthApi:vi.fn()}));
describe.skipIf(!process.env.AUTH_TEST_DATABASE_URL)("complete local hosted workflow",()=>{
 let f:Awaited<ReturnType<typeof loadingFixture>>,storage:Miniflare,server:Server;
 const originalFetch=globalThis.fetch,image=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9WQAAAAASUVORK5CYII=","base64");
 beforeAll(async()=>{
  f=await loadingFixture(process.env.AUTH_TEST_DATABASE_URL!);await f.db.pool.query("UPDATE app.triggers SET enabled=false");await f.db.pool.query("UPDATE app.trigger_runs SET state='succeeded'");await f.db.pool.query("UPDATE app.runs SET state='succeeded',vm_cleanup_complete=true");
  storage=new Miniflare(convertV4MiniflareOptions({name:"workflow",modules:true,script:"export default {fetch(){return new Response('ok')}}",compatibilityDate:"2026-09-10",r2Buckets:["RUN_ARTIFACTS"]}));const bucket=await storage.getR2Bucket("RUN_ARTIFACTS");f.env.RUN_ARTIFACTS=new Proxy(bucket,{get(target,key){if(key==="put")return async(key:string,body:any,options:any)=>target.put(key,body instanceof ReadableStream?await new Response(body).arrayBuffer():body,options);const value=(target as any)[key];return typeof value==="function"?value.bind(target):value;}}) as any;
  Object.assign(f.env,{POSTMARK_SERVER_TOKEN:"fixture-postmark",POSTMARK_FROM_EMAIL:"fixture@example.test",POSTMARK_MESSAGE_STREAM:"outbound"});
 });
 afterAll(async()=>{vi.unstubAllGlobals();server?.closeAllConnections();if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));await storage?.dispose();await f?.cleanup();});
 it("signs up, configures a team, fires a templated Trigger, reads its MCP skill, uses a ready VM and image, restarts, retains the result and cleans up",async()=>{
  let mail:any,vm:string|undefined,ready=false,owner:OAuthProps|null=null,runId="",integration="",artifactId="",turn=0;const calls:string[]=[],modelRequests:any[]=[];
  vi.stubGlobal("fetch",async(input:any,init?:RequestInit)=>{
   const url=typeof input==="string"?input:input instanceof URL?input.href:input.url;
   if(url==="https://api.postmarkapp.com/email"){mail=JSON.parse(String(init?.body));return Response.json({ErrorCode:0});}
   if(url==="https://images.fixture/image"){expect(new Headers(input.headers??init?.headers).get("Authorization")).toBe("Bearer image-fixture");return new Response(image,{headers:{"Content-Type":"image/png"}});}
   if(url==="https://exe.dev/exec"){
    const command=String(init?.body);calls.push(command);
    if(command==="integrations list --json")return Response.json([]);
    if(command.startsWith("ls"))return Response.json(vm?[{name:vm,comment:`Factorize VM ${vm}`}]:[]);
    if(command.startsWith("new --name="))vm=command.match(/--name='([^']+)'/)![1];
    if(command.startsWith("rm "))vm=undefined;
    if(command.startsWith("ssh ")){const proof=command.includes("FACTORIZE_WORKSPACE_READY");if(proof)ready=true;return new Response(JSON.stringify({stdout:Buffer.from(proof?"FACTORIZE_WORKSPACE_READY":"Workspace command complete").toString("base64")})+'\n{"exit_code":0}\n');}
    return new Response("{}",{headers:{"X-Exe-Exit":"0"}});
   }
   return originalFetch(input,init);
  });
  const request=async(method:string,path:string,body?:unknown)=>protectedApiFetch(new Request(f.env.APP_ORIGIN+path,{method,headers:{Origin:f.env.APP_ORIGIN,"Content-Type":"application/json"},...(body!==undefined?{body:JSON.stringify(body)}:{})}),f.env,owner,{waitUntil(){}} as any);
  const json=async(method:string,path:string,body?:unknown,status=200)=>{const response=await request(method,path,body),data=await response.json();expect(response.status,JSON.stringify(data)).toBe(status);return data as any;};
  const email="workflow-"+crypto.randomUUID()+"@example.test",password="local workflow password only";
  await json("POST","/api/v1/auth/signup",{email,username:email.split("@")[0].replaceAll("_","-").slice(0,39),password},202);const token=new URL(mail.TextBody.match(/https:\/\/\S+/)[0]).searchParams.get("token");
  const verified=await request("POST","/api/v1/auth/email-verification/complete",{token});expect(verified.status).toBe(200);const session=await readSession(decodeURIComponent(verified.headers.get("Set-Cookie")!.match(/factorize_session=([^;]+)/)![1]),f.env.SESSION_SIGNING_SECRET);expect(session).not.toBeNull();owner={...session!,authMethod:"session",scopes:[...ACCESS_SCOPES]};
  expect((await json("GET","/api/v1/team")).runDefaults.requiresVm).toBe(false);
  server=createServer(async(req,res)=>{
   const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString());modelRequests.push(body);expect(ready).toBe(true);expect(req.headers.authorization).toBeUndefined();
   const skill=snapshotSkillUri(owner!.tenantId,runId,"workflow-guide");let tools:any[]=[];
   if(turn===0)tools=[{name:"get_api_reflection",args:{}},{name:"mcp_get_skill",args:{uri:skill}},{name:"mcp_read_resource",args:{uri:skill}}];
   if(turn===1)tools=[{name:"vm_exec",args:{command:"printf workflow-check"}},{name:"fetch_media",args:{integration,path:"/image",idempotencyKey:"workflow-image"}}];
   if(turn===2){const receipt=JSON.parse(body.messages.filter((message:any)=>message.role==="tool").at(-1).content);artifactId=receipt.artifactId;tools=[{name:"read_media",args:{artifactId}}];}
   const delta=tools.length?{tool_calls:tools.map((tool,index)=>({index,id:`turn-${turn}-${index}`,type:"function",function:{name:tool.name,arguments:JSON.stringify(tool.args)}}))}:{content:JSON.stringify({status:"succeeded",summary:"Workflow completed",outputs:{image:{artifactId}}})};turn++;
   res.writeHead(200,{"Content-Type":"text/event-stream"});res.end("data: "+JSON.stringify({id:"workflow",object:"chat.completion.chunk",model:"fixture",choices:[{index:0,delta,finish_reason:tools.length?"tool_calls":"stop"}]})+"\n\ndata: [DONE]\n\n");
  });await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const model=crypto.randomUUID(),credential=crypto.randomUUID();
  await json("POST","/api/v1/model-accounts",{id:model,name:"Local model",description:null,providerUrl:`http://127.0.0.1:${(server.address() as any).port}/v1`,expectedRevision:0,idempotencyKey:crypto.randomUUID()},201);
  await json("POST","/api/v1/integrations/bearer",{id:credential,name:"Images",description:null,origin:"https://images.fixture",token:"image-fixture",expectedRevision:1,idempotencyKey:crypto.randomUUID()},201);integration=(await f.db.pool.query("SELECT id FROM app.agent_integrations WHERE tenant_id=$1 AND credential_id=$2",[owner.tenantId,credential])).rows[0].id;
  await json("PUT","/api/v1/integrations/exe",{connectionId:"workflow-vm",apiToken:"exe-fixture-token"});
  await json("PUT","/api/v1/team/run-defaults",{modelAccountId:model,model:"fixture",requiresVm:true,executionConfigId:"workflow-vm",portableIntegrationIds:[credential],runScopes:[]});
  // This package is a local pre-published fixture; the public MCP extension,
  // pinning and real Pi resource reads below exercise its execution boundary.
  const skillId=crypto.randomUUID();await f.db.pool.query("INSERT INTO app.skills(tenant_id,id,key,encrypted_body) VALUES($1,$2,'workflow-guide',$3)",[owner.tenantId,skillId,await encrypt("Reflect on the environment, use vm_exec for workspace work and inspect original image bytes with MCP.",f.env.CREDENTIAL_ENCRYPTION_KEY)]);
  const trigger=await json("POST","/api/v1/triggers",{name:"workflow-trigger",skillId,prompt:"Complete the workflow",events:[{kind:"manual",template:"Selected {{data.detail}}",config:{}}]},201);
  const receipt=await json("POST",`/api/v1/triggers/${trigger.id}/invocations`,{data:{detail:"event data"},idempotencyKey:"workflow-event"},202);runId=receipt.runId;expect(modelRequests).toHaveLength(0);
  expect((await json("POST",`/api/v1/triggers/${trigger.id}/invocations`,{data:{detail:"event data"},idempotencyKey:"workflow-event"},202)).runId).toBe(runId);
  const runs=new RunRepository(f.db);expect((await runs.claimNext())!.id).toBe(runId);await new RunScheduler(f.db,f.env).processHosted(owner.tenantId,runId);expect(modelRequests).toHaveLength(0);
  expect((await runs.find(owner.tenantId,runId))?.state,JSON.stringify((await json("GET","/api/v1/runs/"+runId)).failure)).toBe("running");
  for(let index=0;index<4;index++){const run=(await runs.find(owner.tenantId,runId))!;await new HostedPi(f.db,f.env,(run,lease)=>createPiMcpTools(f.env,run,lease)).advance(run);}
  const detail=await json("GET","/api/v1/runs/"+runId);expect(detail).toMatchObject({state:"succeeded",source:"workflow-trigger",context_prompt:"Complete the workflow\n\nSelected event data",trigger_result:{summary:"Workflow completed"}});
  expect(JSON.stringify(modelRequests[1])).toContain('factorize');expect(JSON.stringify(modelRequests[1])).toContain('exe.dev');expect(JSON.stringify(modelRequests[1])).toContain('workflow-guide');
  expect(JSON.stringify(modelRequests[3])).toContain(image.toString("base64"));expect(calls.some(command=>command.includes("codex --")||command.includes("pi --"))).toBe(false);
  await new RunScheduler(f.db,f.env).process();expect(vm).toBeUndefined();expect((await json("GET","/api/v1/runs/"+runId)).vm_cleanup_complete).toBe(true);
  const media=(await f.db.pool.query("SELECT m.object_key,l.role FROM app.run_media m JOIN app.run_media_links l ON l.tenant_id=m.tenant_id AND l.media_id=m.id WHERE m.tenant_id=$1 AND m.id=$2",[owner.tenantId,artifactId])).rows[0];expect(media.role).toBe("result");await new MediaCleanup(f.db,f.env.RUN_ARTIFACTS).sweep(new Date(Date.now()+7200000));expect(await f.env.RUN_ARTIFACTS!.head(media.object_key)).not.toBeNull();
  await new RunScheduler(f.db,f.env).process();await new RunRetentionRepository(f.db).sweep(new Date(Date.now()+15*86400000));expect(await runs.find(owner.tenantId,runId)).toBeNull();await new MediaCleanup(f.db,f.env.RUN_ARTIFACTS).sweep(new Date(Date.now()+16*86400000));expect(await f.env.RUN_ARTIFACTS!.head(media.object_key)).toBeNull();
 });
});
