import {describe,it,expect,vi} from "vitest";
import {PiTelemetry,redactTelemetry,reconcileTerminalTelemetry} from "../src/pi-telemetry";
import {loadingFixture} from "./helpers/loading-fixture";
import {encrypt,decrypt} from "../src/crypto";
vi.mock("cloudflare:workers",()=>({WorkerEntrypoint:class{},WorkflowEntrypoint:class{},DurableObject:class{}}));
vi.mock("@cloudflare/workers-oauth-provider",()=>({OAuthProvider:class{},AuthorizationError:class extends Error{},getOAuthApi:vi.fn()}));
it("redacts credentials and temporary file URL secrets in nested telemetry",()=>{const value=redactTelemetry({headers:{Authorization:"Bearer hidden"},file:{download_url:"https://files.oaiusercontent.com/file?sig=hidden"},content:"provider-private https://files.oaiusercontent.com/file?sig=hidden Bearer raw-token"},"provider-private");expect(JSON.stringify(value)).not.toMatch(/provider-private|sig=hidden|raw-token|Bearer hidden/);});
describe.skipIf(!process.env.AUTH_TEST_DATABASE_URL)("durable OpenTelemetry capture",()=>{
 it("keeps stable IDs, completes once after recovery, bounds encrypted content reads and cascades retention",async()=>{
  const f=await loadingFixture(process.env.AUTH_TEST_DATABASE_URL!);
  try{
   const telemetry=new PiTelemetry(f.db,f.env.CREDENTIAL_ENCRYPTION_KEY,f.tenantId,f.runId,"private-key");
   await telemetry.begin("run","run","Pi run",{prompt:"private-key"});await telemetry.begin("turn:0","turn","Turn 1");await telemetry.begin("model:0","model","Model",{messages:[{text:"😀".repeat(10000)}]},"turn:0",{"llm.model_name":"fixture"});
   const recovered=new PiTelemetry(f.db,f.env.CREDENTIAL_ENCRYPTION_KEY,f.tenantId,f.runId,"private-key");await recovered.begin("model:0","model","Model",{different:"ignored"},"turn:0");
   const usage={input:70,output:20,cacheRead:30,cacheWrite:0,reasoning:5,totalTokens:120};await recovered.end("model:0",{text:"done",apiKey:"private-key"},"ok",{},usage);await recovered.end("model:0",{text:"duplicate"},"error",{},usage);
   await recovered.begin("tool:1","tool","Fixture tool",{key:"private-key"},"turn:0");await recovered.end("tool:1",{error:"failed"},"error");await recovered.begin("retry:1","retry","Retry",{},"turn:0");await recovered.end("retry:1",undefined,"error");await recovered.begin("compact:1","compaction","Compaction",{},"turn:0",{"llm.model_name":"fixture"});await recovered.end("compact:1",{text:"summary"},"ok",{},usage);await recovered.finish("canceled");
   const rows=(await f.db.pool.query("SELECT * FROM app.run_telemetry_spans WHERE tenant_id=$1 AND run_id=$2",[f.tenantId,f.runId])).rows;expect(rows).toHaveLength(6);expect(new Set(rows.map(r=>r.trace_id))).toEqual(new Set([telemetry.traceId]));expect(new Set(rows.map(r=>r.span_id)).size).toBe(6);expect(rows.find(r=>r.span_key==="model:0")).toMatchObject({status:"ok",input_tokens:"70",output_tokens:"20",cache_read_tokens:"30",reasoning_tokens:"5"});expect(rows.find(r=>r.span_key==="turn:0").status).toBe("canceled");
   for(const row of rows){expect(row.encrypted_attributes).not.toContain("private-key");const exported=JSON.parse(await decrypt(row.encrypted_otel,f.env.CREDENTIAL_ENCRYPTION_KEY));expect(exported.traceId).toBe(telemetry.traceId);expect(exported.attributes.some((a:any)=>a.key==="openinference.span.kind")).toBe(true);}
   let full="";for(let chunk=0;;chunk++){const text=await recovered.content("model:0","input",chunk);if(text===null)break;expect(text.length).toBeLessThanOrEqual(16384);full+=text;}expect(JSON.parse(full)).toEqual({messages:[{text:"😀".repeat(10000)}]});expect(await new PiTelemetry(f.db,f.env.CREDENTIAL_ENCRYPTION_KEY,f.otherTenant,f.runId).content("model:0","input")).toBeNull();
   await f.db.pool.query("DELETE FROM app.runs WHERE tenant_id=$1 AND id=$2",[f.tenantId,f.runId]);expect((await f.db.pool.query("SELECT * FROM app.run_telemetry_spans WHERE tenant_id=$1 AND run_id=$2",[f.tenantId,f.runId])).rowCount).toBe(0);expect((await f.db.pool.query("SELECT * FROM app.run_telemetry_content WHERE tenant_id=$1 AND run_id=$2",[f.tenantId,f.runId])).rowCount).toBe(0);
  }finally{await f.cleanup();}
 });
 it("does not interpret Pi's initialized zero usage as reported tokens",async()=>{const f=await loadingFixture(process.env.AUTH_TEST_DATABASE_URL!);try{const telemetry=new PiTelemetry(f.db,f.env.CREDENTIAL_ENCRYPTION_KEY,f.tenantId,f.runId);await telemetry.begin("model","model","No usage");await telemetry.end("model",{},"ok",{},{input:0,output:0,cacheRead:0,cacheWrite:0});expect((await f.db.pool.query("SELECT input_tokens,output_tokens,cache_read_tokens FROM app.run_telemetry_spans WHERE tenant_id=$1 AND run_id=$2",[f.tenantId,f.runId])).rows[0]).toEqual({input_tokens:null,output_tokens:null,cache_read_tokens:null});}finally{await f.cleanup();}});
 it("replays a committed model/tool/compaction journal after capture interruption and reconciles terminal roots",async()=>{
  const f=await loadingFixture(process.env.AUTH_TEST_DATABASE_URL!);
  try{
   const key=f.env.CREDENTIAL_ENCRYPTION_KEY,telemetry=new PiTelemetry(f.db,key,f.tenantId,f.runId);await telemetry.begin("run","run","Pi run");await telemetry.begin("model:interrupted","model","Interrupted capture",{},"run",{"llm.model_name":"gpt-4o-mini"});await telemetry.begin("compaction:interrupted","compaction","Interrupted compaction",{},"run",{"llm.model_name":"gpt-4o-mini"});
   await f.db.pool.query("INSERT INTO app.pi_sessions(tenant_id,run_id,encrypted_messages) VALUES($1,$2,$3)",[f.tenantId,f.runId,await encrypt("[]",key)]);
   const message={role:"assistant",content:[{type:"text",text:"durably saved"}],stopReason:"stop",usage:{input:60,output:30,cacheRead:10,cacheWrite:0,reasoning:5}};
   const events=[{type:"message_end",message,telemetry:{modelKey:"model:interrupted",turnKey:"run"}},{type:"tool_execution_start",toolCallId:"recovered",toolName:"lookup",args:{apiKey:"never-export"},telemetry:{modelKey:"model:interrupted",turnKey:"run"}},{type:"tool_execution_end",toolCallId:"recovered",toolName:"lookup",result:{content:[{type:"text",text:"result"}]},isError:false,telemetry:{modelKey:"model:interrupted",turnKey:"run"}},{type:"compaction_model",message,telemetry:{modelKey:"compaction:interrupted",turnKey:"run"}}];
   for(const [index,event] of events.entries())await f.db.pool.query("INSERT INTO app.pi_session_events(tenant_id,run_id,sequence,event_type,encrypted_event) VALUES($1,$2,$3,$4,$5)",[f.tenantId,f.runId,index+1,event.type,await encrypt(JSON.stringify(event),key)]);
   await f.db.pool.query("UPDATE app.runs SET state='succeeded' WHERE tenant_id=$1 AND id=$2",[f.tenantId,f.runId]);await reconcileTerminalTelemetry(f.db,key);await reconcileTerminalTelemetry(f.db,key);await telemetry.recoverJournal();
   const rows=(await f.db.pool.query("SELECT * FROM app.run_telemetry_spans WHERE tenant_id=$1 AND run_id=$2",[f.tenantId,f.runId])).rows;expect(rows).toHaveLength(4);expect(rows.every(row=>row.ended_at&&row.status==="ok")).toBe(true);expect(rows.filter(row=>row.input_tokens!==null).map(row=>row.input_tokens)).toEqual(["60","60"]);expect(await telemetry.content("tool:recovered","input")).not.toContain("never-export");expect((await f.db.pool.query("SELECT telemetry_sequence FROM app.pi_sessions WHERE tenant_id=$1 AND run_id=$2",[f.tenantId,f.runId])).rows[0].telemetry_sequence).toBe("4");
  }finally{await f.cleanup();}
 });

});
