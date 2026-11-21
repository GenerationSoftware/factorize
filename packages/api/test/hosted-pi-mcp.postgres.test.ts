import {beforeAll,afterAll,beforeEach,describe,it,expect,vi} from "vitest";
import {readFile} from "node:fs/promises";
import {createServer,type Server} from "node:http";
import {Agent} from "@earendil-works/pi-agent-core";
import {HostedPi} from "../src/hosted-pi";
import {PiMcpClient,createPiMcpTools} from "../src/pi-mcp-client";
import {piProvider} from "../src/pi-provider";
import {PiSessionRepository,type PiLease} from "../src/postgres/pi-session-repository";
import {snapshotRunAuthorization} from "../src/run-authorizations";
import {CredentialRepository} from "../src/postgres/credential-repository";
import {issueHostedRunCredential,authenticateHostedRunRequest} from "../src/hosted-run-auth";
import {decrypt,encrypt} from "../src/crypto";
import {markdown} from "../src/skill-files";
import {snapshotSkillUri,skillUri} from "../src/mcp-skills";
import type {PersistedRun} from "../src/postgres/run-repository";
import {protectedApiFetch} from "../src/protected-api";
import worker from "../src/worker";
import {loadingFixture} from "./helpers/loading-fixture";
vi.mock("cloudflare:workers",()=>({WorkerEntrypoint:class{},WorkflowEntrypoint:class{},DurableObject:class{}}));
vi.mock("@cloudflare/workers-oauth-provider",()=>({OAuthProvider:class{},AuthorizationError:class extends Error{},getOAuthApi:vi.fn()}));

describe.skipIf(!process.env.AUTH_TEST_DATABASE_URL)("hosted Pi through the public MCP boundary",()=>{
 let f:Awaited<ReturnType<typeof loadingFixture>>,server:Server,providerUrl:string,modelId:string,bearerId:string,integrationId:string,skillId:string,run:PersistedRun,requests:any[],upstream:any[];
 const skillBody="Call get_api_reflection, request the selected API status, then discover and read the built-in environment workflow through MCP. Finish with the result.";
 const nativeFetch=globalThis.fetch;
 beforeAll(async()=>{
  f=await loadingFixture(process.env.AUTH_TEST_DATABASE_URL!);modelId=crypto.randomUUID();bearerId=crypto.randomUUID();skillId=crypto.randomUUID();
  server=createServer(async(req,res)=>{
   const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString());requests.push(body);
   const results=body.messages.filter((m:any)=>m.role==="tool");let name:string|undefined,args:Record<string,unknown>={};
   if(!results.some((m:any)=>m.tool_call_id==="reflection"))name="get_api_reflection";
   else if(!results.some((m:any)=>m.tool_call_id==="api")){name="request_api";args={integration:integrationId,method:"GET",path:"/status",execution:"sync"};}
   else if(!results.some((m:any)=>m.tool_call_id==="skills"))name="mcp_list_skills";
   else if(!results.some((m:any)=>m.tool_call_id==="resource")){name="mcp_read_resource";const list=JSON.parse(results.find((m:any)=>m.tool_call_id==="skills").content);args={uri:list.skills.find((s:any)=>s.frontmatter.name==="manage-environments").uri};}
   const id=name==="get_api_reflection"?"reflection":name==="request_api"?"api":name==="mcp_list_skills"?"skills":"resource";
   const chunk=(delta:unknown,finish_reason:string|null=null)=>"data: "+JSON.stringify({id:"mcp-fixture",object:"chat.completion.chunk",created:1,model:"fixture",choices:[{index:0,delta,finish_reason}]})+"\n\n";
   res.writeHead(200,{"Content-Type":"text/event-stream"});res.end(chunk({role:"assistant"})+chunk(name?{tool_calls:[{index:0,id,type:"function",function:{name,arguments:JSON.stringify(args)}}]}:{content:"Skill completed."})+chunk({},name?"tool_calls":"stop")+"data: "+JSON.stringify({id:"usage",choices:[],usage:{prompt_tokens:100,completion_tokens:20,prompt_tokens_details:{cached_tokens:30},completion_tokens_details:{reasoning_tokens:5}}})+"\n\ndata: [DONE]\n\n");
  });await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));providerUrl=`http://127.0.0.1:${(server.address() as any).port}/v1`;
  const creds=new CredentialRepository(f.db,f.tenantId,f.env.CREDENTIAL_ENCRYPTION_KEY);
  await creds.write({id:modelId,kind:"model",name:"Model",origin:null,description:null,expectedRevision:0,idempotencyKey:crypto.randomUUID(),operation:"upsert",managedModelPayload:JSON.stringify({providerUrl})});
  await creds.write({id:bearerId,kind:"bearer",name:"Status API",origin:"https://api.example.com",description:null,expectedRevision:1,idempotencyKey:crypto.randomUUID(),operation:"upsert",managedSecret:"private-api-token"});
  await f.db.pool.query("UPDATE app.agent_integrations SET policy='baseline' WHERE tenant_id=$1 AND credential_id=$2",[f.tenantId,bearerId]);integrationId=(await f.db.pool.query("SELECT id FROM app.agent_integrations WHERE tenant_id=$1 AND kind='bearer' AND credential_id=$2",[f.tenantId,bearerId])).rows[0].id;
  await f.db.pool.query("INSERT INTO app.skills(tenant_id,id,key,encrypted_body) VALUES($1,$2,'shared-guide',$3)",[f.tenantId,skillId,await encrypt(skillBody,f.env.CREDENTIAL_ENCRYPTION_KEY)]);
 });
 beforeEach(async()=>{
  requests=[];upstream=[];vi.stubGlobal("fetch",async(input:any,init?:RequestInit)=>{
   if(String(input).startsWith("https://api.example.com")){upstream.push({url:String(input),authorization:new Headers(init?.headers).get("Authorization")});return Response.json({status:"ok"});}
   return nativeFetch(input,init);
  });
  const id=crypto.randomUUID(),invocation=crypto.randomUUID(),prompt=await encrypt(skillBody,f.env.CREDENTIAL_ENCRYPTION_KEY),snapshot=await encrypt(JSON.stringify([{id:skillId,key:"shared-guide",revision:1,body:skillBody,version:{commit:"pinned",files:[markdown(skillBody),{path:"references/input.txt",content:btoa("Pinned support"),executable:false}]}}]),f.env.CREDENTIAL_ENCRYPTION_KEY);
  await f.db.pool.query("INSERT INTO app.invocations(tenant_id,id,trigger_id,source,claim_key,context) VALUES($1,$2,NULL,'direct',$3,'{}')",[f.tenantId,invocation,id]);await f.db.pool.query("INSERT INTO app.trigger_runs(tenant_id,id,invocation_id,state,encrypted_prompt,encrypted_skill_snapshot) VALUES($1,$2,$3,'running',$4,$5)",[f.tenantId,id,invocation,prompt,snapshot]);
  const config={agentKind:"pi",executionType:"agent",model:"fixture",modelAccountId:modelId,modelAccess:"portable",portableIntegrationIds:[bearerId],runScopes:[]};
  await f.db.pool.query("INSERT INTO app.runs(tenant_id,id,invocation_id,provider,issue_id,agent_name,agent_kind,state,execution_backend_kind,execution_config,execution_handle) VALUES($1,$2,$3,'direct',($2::uuid)::text,'','pi','running','hosted-pi',$4,$5)",[f.tenantId,id,invocation,config,{backendKind:"hosted-pi",id}]);
  run={tenantId:f.tenantId,id,triggerId:null,invocationId:invocation,state:"running",encryptedPrompt:prompt,encryptedSkillSnapshot:snapshot,executionConfig:config,executionHandle:{backendKind:"hosted-pi",id},backendKind:"hosted-pi",capabilities:[],artifactState:"pending",resultProtocolVersion:1,createdAt:"now",updatedAt:"now"};
  await snapshotRunAuthorization(f.db,{tenantId:f.tenantId,runId:id,scopes:[]});await new HostedPi(f.db,f.env).initialize(run);
 });
 afterAll(async()=>{vi.unstubAllGlobals();server?.closeAllConnections();await new Promise<void>(resolve=>server?.close(()=>resolve()));await f?.cleanup();});
 const sessions=()=>new PiSessionRepository(f.db,f.env.CREDENTIAL_ENCRYPTION_KEY);
 const fetchWorker=(request:Request)=>worker.fetch!(request,f.env,{waitUntil(){}} as any) as Promise<Response>;
 const client=(lease:PiLease)=>new PiMcpClient(f.env.APP_ORIGIN,fetchWorker,()=>issueHostedRunCredential(lease,f.env.SESSION_SIGNING_SECRET));
 it("executes one unchanged skill through hosted Pi and an external MCP client",async()=>{
  for(let i=0;i<5;i++)await new HostedPi(f.db,f.env,(run,lease)=>createPiMcpTools(f.env,run,lease)).advance(run);
  expect((await sessions().read(f.tenantId,run.id))?.status).toBe("complete");expect(upstream,JSON.stringify(requests.map(request=>request.messages))).toHaveLength(1);expect(upstream[0].authorization).toBe("Bearer private-api-token");
  expect(requests[0].messages.some((m:any)=>m.role==="user"&&m.content===skillBody)).toBe(true);
  const spans=(await f.db.pool.query("SELECT * FROM app.run_telemetry_spans WHERE tenant_id=$1 AND run_id=$2",[f.tenantId,run.id])).rows;
  expect(spans.filter(s=>s.kind==="model")).toHaveLength(5);expect(spans.filter(s=>s.kind==="tool")).toHaveLength(4);expect(spans.find(s=>s.kind==="run").status).toBe("ok");
  for(const model of spans.filter(s=>s.kind==="model")){expect(Number(model.input_tokens)).toBe(70);expect(Number(model.cache_read_tokens)).toBe(30);expect(Number(model.output_tokens)).toBe(20);expect(Number(model.reasoning_tokens)).toBe(5);const exported=JSON.parse(await decrypt(model.encrypted_otel,f.env.CREDENTIAL_ENCRYPTION_KEY));expect(exported.traceId).toHaveLength(32);expect(exported.parentSpanId).toHaveLength(16);expect(exported.attributes).toContainEqual({key:"llm.token_count.total",value:{intValue:"120"}});}
  const page=await (await protectedApiFetch(new Request(f.env.APP_ORIGIN+`/api/v1/runs/${run.id}/telemetry?limit=50`),f.env,f.auth,{} as any)).json() as any;
  expect(page.summary.usage).toMatchObject({input:500,output:100,total:600});expect(page.items.find((span:any)=>span.kind==="run").usage).toMatchObject({input:500,output:100,total:600});expect(page.items.filter((span:any)=>span.kind==="turn")).toHaveLength(5);for(const turn of page.items.filter((span:any)=>span.kind==="turn"))expect(turn.usage).toMatchObject({input:100,output:20,total:120});
  const externalAuth={...f.auth,authMethod:"oauth" as const,scopes:["proxy:use","skills:read"],oauthGrantId:"external-fixture",oauthClientId:"external-client",oauthExpiresAt:Math.floor(Date.now()/1000)+3600};
  const external=new PiMcpClient(f.env.APP_ORIGIN,request=>protectedApiFetch(request,f.env,externalAuth,{} as any),async()=>"external-fixture-token");
  const resource=await external.request("resources/read",{uri:skillUri(f.tenantId,"shared-guide")});expect(resource.contents[0].text).toContain(skillBody);
  const provider=piProvider({providerUrl,contextWindow:32000,maxTokens:1000},"fixture");const agent=new Agent({initialState:{model:provider.model,tools:await external.tools()},streamFn:(model,context,options)=>provider.models.streamSimple(model,context,options)});
  await agent.prompt(resource.contents[0].text);expect(agent.state.messages.at(-1)).toMatchObject({role:"assistant",content:[{type:"text",text:"Skill completed."}]});expect(upstream).toHaveLength(2);
 });
 it("discovers only built-ins while reading pinned inputs without broad library permission",async()=>{
  const lease=(await sessions().claim(f.tenantId,run.id))!,mcp=client(lease),uri=snapshotSkillUri(f.tenantId,run.id,"shared-guide");
  const list=await mcp.request("skills/list");expect(list.skills).toHaveLength(5);expect(list.skills.every((skill:any)=>skill.uri.startsWith("skill://factorize/"))).toBe(true);
  await expect(mcp.request("skills/get",{uri})).rejects.toThrow("Unknown built-in");
  const builtin=await mcp.request("resources/read",{uri:list.skills[0].uri});expect(builtin.contents[0].text).toContain("Manage presets");
  const file=await mcp.request("resources/read",{uri:snapshotSkillUri(f.tenantId,run.id,"shared-guide","references/input.txt")});expect(file.contents[0].text).toBe("Pinned support");
  await expect(mcp.request("resources/read",{uri:skillUri(f.tenantId,"shared-guide")})).rejects.toThrow("insufficient_scope");
  await expect(mcp.request("resources/read",{uri:snapshotSkillUri(f.otherTenant,run.id,"shared-guide")})).rejects.toThrow("Unknown skill");
  const denied=await mcp.request("tools/call",{name:"list_runs",arguments:{}});expect(denied.isError).toBe(true);expect(denied.content[0].text).toContain("insufficient_scope");
 });
 it("rejects forged, expired, stale-epoch and canceled run credentials",async()=>{
  const lease=(await sessions().claim(f.tenantId,run.id))!,token=await issueHostedRunCredential(lease,f.env.SESSION_SIGNING_SECRET);
  const req=(token:string)=>new Request(f.env.APP_ORIGIN+"/mcp",{headers:{Authorization:"Bearer "+token}});
  expect((await authenticateHostedRunRequest(req(token),f.env))?.runId).toBe(run.id);expect(await authenticateHostedRunRequest(req(token+"forged"),f.env)).toBeNull();
  const now=Date.now(),clock=vi.spyOn(Date,"now").mockReturnValue(now+61000);expect(await authenticateHostedRunRequest(req(token),f.env)).toBeNull();clock.mockRestore();
  await sessions().release(lease);await sessions().claim(f.tenantId,run.id);expect(await authenticateHostedRunRequest(req(token),f.env)).toBeNull();
  await f.db.pool.query("UPDATE app.runs SET state='stopping' WHERE tenant_id=$1 AND id=$2",[f.tenantId,run.id]);expect(await authenticateHostedRunRequest(req(token),f.env)).toBeNull();
 });
 it("enforces integration disconnection and permanent run revocation after reconnect",async()=>{
  const lease=(await sessions().claim(f.tenantId,run.id))!,mcp=client(lease),args={integration:integrationId,method:"GET",path:"/status",execution:"sync"};
  const first=await mcp.request("tools/call",{name:"request_api",arguments:args});expect(first.isError,JSON.stringify(first)).not.toBe(true);
  const creds=new CredentialRepository(f.db,f.tenantId,f.env.CREDENTIAL_ENCRYPTION_KEY);
  await creds.write({id:bearerId,kind:"bearer",name:"Status API",origin:"https://api.example.com",description:null,expectedRevision:await creds.revision(),idempotencyKey:crypto.randomUUID(),operation:"delete"});
  expect((await mcp.request("tools/call",{name:"request_api",arguments:args})).isError).toBe(true);
  await creds.write({id:bearerId,kind:"bearer",name:"Status API",origin:"https://api.example.com",description:null,expectedRevision:await creds.revision(),idempotencyKey:crypto.randomUUID(),operation:"upsert",managedSecret:"replacement"});
  expect((await mcp.request("tools/call",{name:"request_api",arguments:args})).isError).toBe(true);expect(upstream).toHaveLength(1);
 });
 it("keeps accepted skill files stable across library edits and deletion",async()=>{
  const lease=(await sessions().claim(f.tenantId,run.id))!,mcp=client(lease),uri=snapshotSkillUri(f.tenantId,run.id,"shared-guide");
  const before=await mcp.request("resources/read",{uri});
  await f.db.pool.query("UPDATE app.skills SET key='edited-guide',encrypted_body=$3 WHERE tenant_id=$1 AND id=$2",[f.tenantId,skillId,await encrypt("Changed library instructions",f.env.CREDENTIAL_ENCRYPTION_KEY)]);
  await f.db.pool.query("DELETE FROM app.skills WHERE tenant_id=$1 AND id=$2",[f.tenantId,skillId]);
  expect((await mcp.request("resources/read",{uri})).contents[0].text).toContain(skillBody);
  expect(await mcp.request("resources/read",{uri})).toEqual(before);
  expect((await mcp.request("resources/read",{uri:snapshotSkillUri(f.tenantId,run.id,"shared-guide","references/input.txt")})).contents[0].text).toBe("Pinned support");
 });

 it("bounds hosted invocation destinations and preserves run provenance without permission escalation",async()=>{
  const destination=f.triggerIds[2];
  await f.db.pool.query("UPDATE app.run_authorizations SET scopes='[\"runs:invoke\",\"triggers:write\"]'::jsonb WHERE tenant_id=$1 AND run_id=$2",[f.tenantId,run.id]);
  await f.db.pool.query("UPDATE app.runs SET execution_config=execution_config||$3::jsonb WHERE tenant_id=$1 AND id=$2",[f.tenantId,run.id,JSON.stringify({allowedTriggerIds:[destination]})]);
  const lease=(await sessions().claim(f.tenantId,run.id))!,mcp=client(lease);
  const denied=await mcp.request("tools/call",{name:"invoke_trigger",arguments:{triggerId:f.triggerIds[3],idempotencyKey:"denied-destination"}});expect(denied.isError).toBe(true);expect(denied.content[0].text).toContain("forbidden");
  const args={triggerId:destination,idempotencyKey:"hosted-invoke"};
  const accepted=await mcp.request("tools/call",{name:"invoke_trigger",arguments:args});expect(accepted.isError,JSON.stringify(accepted)).not.toBe(true);
  expect((await f.db.pool.query("SELECT source_run_id,source_trigger_id FROM app.invocations WHERE tenant_id=$1 AND id=$2",[f.tenantId,accepted.structuredContent.invocationId])).rows[0]).toEqual({source_run_id:run.id,source_trigger_id:null});
  expect((await mcp.request("tools/call",{name:"invoke_trigger",arguments:args})).structuredContent.duplicate).toBe(true);
  const escalation=await mcp.request("tools/call",{name:"set_trigger_invocation_permissions",arguments:{triggerId:destination,destinationTriggerIds:[f.triggerIds[3]]}});expect(escalation.isError).toBe(true);
  await f.db.pool.query("UPDATE app.runs SET execution_config=execution_config||'{\"allowedTriggerIds\":[]}'::jsonb WHERE tenant_id=$1 AND id=$2",[f.tenantId,run.id]);
  expect((await mcp.request("tools/call",{name:"invoke_trigger",arguments:args})).isError).toBe(true);
 });
 it("backfills known historical direct-run disconnections idempotently without revoking newer snapshots",async()=>{
  const lease=(await sessions().claim(f.tenantId,run.id))!,mcp=client(lease),args={integration:integrationId,method:"GET",path:"/status",execution:"sync"};
  await f.db.pool.query("UPDATE app.runs SET created_at=now()-interval '1 day' WHERE tenant_id=$1 AND id=$2",[f.tenantId,run.id]);
  expect((await mcp.request("tools/call",{name:"request_api",arguments:args})).isError).not.toBe(true);
  await f.db.pool.query("INSERT INTO app.integration_changes(tenant_id,revision,id,idempotency_key,operation,record_id,kind,name,origin,description,encrypted_payload,created_at) VALUES($1,9999,$2,$3,'delete',$4,'bearer','Old disconnect','https://api.example.com',NULL,NULL,now()-interval '1 hour')",[f.tenantId,crypto.randomUUID(),crypto.randomUUID(),bearerId]);
  const futureId=crypto.randomUUID(),invocation=crypto.randomUUID();
  await f.db.pool.query("INSERT INTO app.invocations(tenant_id,id,source,claim_key,context) VALUES($1,$2,'direct',$3,'{}')",[f.tenantId,invocation,futureId]);
  await f.db.pool.query("INSERT INTO app.trigger_runs(tenant_id,id,invocation_id,state,encrypted_prompt) VALUES($1,$2,$3,'queued',$4)",[f.tenantId,futureId,invocation,run.encryptedPrompt]);
  await f.db.pool.query("INSERT INTO app.runs(tenant_id,id,invocation_id,provider,issue_id,agent_kind,agent_name,state,execution_config) VALUES($1,$2,$3,'direct',($2::uuid)::text,'pi','','queued',$4)",[f.tenantId,futureId,invocation,run.executionConfig]);
  const migration=await readFile(new URL("../migrations/0074_direct_run_credential_revocations.sql",import.meta.url),"utf8");
  await f.db.pool.query(migration);await f.db.pool.query(migration);
  expect((await mcp.request("tools/call",{name:"request_api",arguments:args})).isError).toBe(true);
  expect((await f.db.pool.query("SELECT count(*)::int n FROM app.run_credential_revocations WHERE tenant_id=$1 AND run_id=$2 AND kind='bearer' AND credential_id=$3",[f.tenantId,run.id,bearerId])).rows[0].n).toBe(1);
  expect((await f.db.pool.query("SELECT count(*)::int n FROM app.run_credential_revocations WHERE tenant_id=$1 AND run_id=$2",[f.tenantId,futureId])).rows[0].n).toBe(0);
 });

});
