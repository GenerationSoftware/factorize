import {describe,it,expect,vi} from "vitest";
import {loadingFixture} from "./helpers/loading-fixture";
import {otlpFixture} from "./helpers/otlp-fixture";
import {PhoenixIntegration,processPhoenixExports,runPhoenixStatus} from "../src/phoenix";
import {phoenixInput} from "../src/phoenix-contracts";
import {PiTelemetry} from "../src/pi-telemetry";
import {protectedApiFetch} from "../src/protected-api";
vi.mock("cloudflare:workers",()=>({WorkerEntrypoint:class{},WorkflowEntrypoint:class{},DurableObject:class{}}));
vi.mock("@cloudflare/workers-oauth-provider",()=>({OAuthProvider:class{},AuthorizationError:class extends Error{},getOAuthApi:vi.fn()}));
describe.skipIf(!process.env.AUTH_TEST_DATABASE_URL)("durable Phoenix Cloud export",()=>{
 it("validates team configuration, sends real protobuf, retries persisted spans and survives disable/disconnect",async()=>{
  const f=await loadingFixture(process.env.AUTH_TEST_DATABASE_URL!),receiver=await otlpFixture(),nativeFetch=globalThis.fetch,config=new PhoenixIntegration(f.env,f.tenantId),endpoint="https://phoenix.example.com/s/fixture";
  vi.stubGlobal("fetch",async(input:any,init:any)=>{const url=new URL(String(input));if(url.origin!=="https://phoenix.example.com")throw new Error("Unexpected external request");return nativeFetch(receiver.origin+url.pathname+url.search,init);});
  try{
   await processPhoenixExports(f.env);expect(receiver.requests).toHaveLength(0);
   const value=phoenixInput.parse({endpoint,projectName:"fixture",apiKey:"phoenix-private-key",enabled:true,expectedRevision:0});expect(await config.put(value)).toMatchObject({configured:true,credentialConfigured:true,revision:1});expect(JSON.stringify(await config.get())).not.toContain("phoenix-private-key");expect((await f.db.pool.query("SELECT encrypted_key FROM app.phoenix_integrations WHERE tenant_id=$1",[f.tenantId])).rows[0].encrypted_key).not.toContain("phoenix-private-key");
   await expect(config.put(value)).rejects.toMatchObject({code:"revision_conflict"});expect(await config.test()).toEqual({connected:true,projectFound:true,error:null});
   await f.db.pool.query("UPDATE app.runs SET created_at=now()+interval '1 second',state='succeeded' WHERE tenant_id=$1 AND id=$2",[f.tenantId,f.runId]);
   const telemetry=new PiTelemetry(f.db,f.env.CREDENTIAL_ENCRYPTION_KEY,f.tenantId,f.runId);
   await telemetry.begin("run","run","Pi run",{prompt:"hello"});
   for(let i=0;i<2;i++){await telemetry.begin(`turn:${i}`,"turn",`Turn ${i+1}`);await telemetry.begin(`model:${i}`,"model",`Model ${i+1}`,{messages:[{role:"user",content:"hello"}]},`turn:${i}`,{"llm.model_name":"gpt-4o-mini"});await telemetry.end(`model:${i}`,{text:"answer"},"ok",{},{input:10,output:5,cacheRead:0,cacheWrite:0});if(!i){await telemetry.begin("tool:1","tool","lookup",{query:"fixture"},`turn:${i}`,{"tool.name":"lookup"});await telemetry.end("tool:1",{result:"ok"});}await telemetry.end(`turn:${i}`);}await telemetry.finish("ok",{summary:"complete"});
   expect((await runPhoenixStatus(f.env,f.tenantId,f.runId)).pending).toBe(6);
   receiver.setStatus(503);await processPhoenixExports(f.env);expect((await runPhoenixStatus(f.env,f.tenantId,f.runId)).pending).toBe(6);expect((await config.get()).lastError).toBe("Phoenix returned HTTP 503.");
   const ids=receiver.received.map(span=>span.spanId).sort();expect(ids).toHaveLength(6);expect(receiver.requests.find(request=>request.contentType)?.contentType).toBe("application/x-protobuf");expect(receiver.requests.every(request=>request.authorization==="Bearer phoenix-private-key")).toBe(true);
   for(const span of receiver.received){expect(span.traceId).toBe(telemetry.traceId);expect(span.resource["openinference.project.name"]).toBe("fixture");expect(span.attributes["openinference.span.kind"]).toBeTruthy();if(span.name.startsWith("Model"))expect(span.attributes["llm.token_count.total"]).toBe(15);}
   await f.db.pool.query("UPDATE app.phoenix_span_exports SET next_attempt_at=now(),state='sending',lease_expires_at=now()-interval '1 second' WHERE tenant_id=$1",[f.tenantId]);await f.db.pool.query("UPDATE app.phoenix_integrations SET project_id=NULL WHERE tenant_id=$1",[f.tenantId]);receiver.setProjectStatus(503);receiver.setStatus(200);await processPhoenixExports(f.env);expect((await runPhoenixStatus(f.env,f.tenantId,f.runId)).url).toBeNull();receiver.setProjectStatus(200);await processPhoenixExports(f.env);expect(receiver.received.slice(6).map(span=>span.spanId).sort()).toEqual(ids);
   const done=await runPhoenixStatus(f.env,f.tenantId,f.runId);expect(done).toMatchObject({pending:0,sent:6,failed:0,url:`${endpoint}/projects/UHJvamVjdDox/traces/${telemetry.traceId}`});expect((await f.db.pool.query("SELECT state FROM app.runs WHERE tenant_id=$1 AND id=$2",[f.tenantId,f.runId])).rows[0].state).toBe("succeeded");
   await telemetry.begin("model:failed","model","Failed export",{},"run",{"llm.model_name":"custom"});await telemetry.end("model:failed",{text:"retained"});receiver.setStatus(401);await processPhoenixExports(f.env);expect((await runPhoenixStatus(f.env,f.tenantId,f.runId)).failed).toBe(1);expect(JSON.stringify(await config.get())).not.toContain("private-key-echo");
   await f.db.pool.query("UPDATE app.phoenix_span_exports SET state='pending',attempts=7,next_attempt_at=now() WHERE tenant_id=$1 AND span_key='model:failed'",[f.tenantId]);receiver.setStatus(503);await processPhoenixExports(f.env);expect((await f.db.pool.query("SELECT state,attempts FROM app.phoenix_span_exports WHERE tenant_id=$1 AND span_key='model:failed'",[f.tenantId])).rows[0]).toEqual({state:"failed",attempts:8});const stopped=receiver.requests.length;await processPhoenixExports(f.env);expect(receiver.requests).toHaveLength(stopped);
   await config.put({...value,apiKey:"replacement",expectedRevision:1});receiver.setStatus(200);await processPhoenixExports(f.env);expect((await runPhoenixStatus(f.env,f.tenantId,f.runId)).failed).toBe(0);
   await telemetry.begin("pending","tool","Pending export");await telemetry.end("pending",{});await config.put({...value,apiKey:undefined,enabled:false,expectedRevision:2});const count=receiver.requests.length;await processPhoenixExports(f.env);expect(receiver.requests).toHaveLength(count);expect((await runPhoenixStatus(f.env,f.tenantId,f.runId)).canceled).toBe(1);
   await config.put({...value,expectedRevision:3});
   // The run must predate re-enablement even when CI finishes the earlier work in under a second.
   await f.db.pool.query("UPDATE app.runs r SET created_at=p.enabled_since-interval '1 second' FROM app.phoenix_integrations p WHERE r.tenant_id=$1 AND r.id=$2 AND p.tenant_id=r.tenant_id",[f.tenantId,f.runId]);
   await telemetry.begin("old-run","tool","No historical backfill");await telemetry.end("old-run",{});expect((await runPhoenixStatus(f.env,f.tenantId,f.runId)).pending).toBe(0);
   await f.db.pool.query("UPDATE app.runs SET created_at=now()+interval '1 second' WHERE tenant_id=$1 AND id=$2",[f.tenantId,f.runId]);await telemetry.begin("disconnect","tool","Disconnect");await telemetry.end("disconnect",{});expect((await runPhoenixStatus(f.env,f.tenantId,f.runId)).pending).toBe(1);await config.remove(4);await processPhoenixExports(f.env);expect((await config.get()).credentialConfigured).toBe(false);expect((await runPhoenixStatus(f.env,f.tenantId,f.runId)).pending).toBe(0);
   expect(await new PhoenixIntegration(f.env,f.otherTenant).get()).toMatchObject({configured:false,credentialConfigured:false});
   const denied=await protectedApiFetch(new Request(f.env.APP_ORIGIN+"/api/v1/integrations/phoenix"),f.env,{...f.auth,scopes:[]},{} as any);expect(denied.status).toBe(403);
  }finally{vi.unstubAllGlobals();await receiver.close();await f.cleanup();}
 },60000);
});
