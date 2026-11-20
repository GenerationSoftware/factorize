import {enqueuePhoenixSpan} from "./phoenix";
import {priceSpan} from "./model-pricing";
import {createHash} from "node:crypto";
import {ROOT_CONTEXT,trace,SpanKind,SpanStatusCode,type Attributes} from "@opentelemetry/api";
import {TracerProvider,type ReadableSpan,type SpanProcessor} from "@opentelemetry/sdk-trace";
import {SemanticConventions as SC,OpenInferenceSpanKind} from "@arizeai/openinference-semantic-conventions";
import {encrypt,decrypt} from "./crypto";
import type {Database,DatabaseClient} from "./postgres/database";
import type {Usage} from "@earendil-works/pi-ai";
export type TelemetryStatus="running"|"ok"|"error"|"canceled"|"uncertain";
export type TelemetryRow={tenant_id:string;run_id:string;span_key:string;trace_id:string;span_id:string;parent_span_id:string|null;kind:string;name:string;started_at:Date;ended_at:Date|null;status:TelemetryStatus;encrypted_attributes:string;encrypted_otel:string|null;input_tokens:string|null;output_tokens:string|null;cache_read_tokens:string|null;cache_write_tokens:string|null;reasoning_tokens:string|null;model:string|null;cost_usd:string|null;encrypted_pricing:string|null};
export const telemetryId=(value:string,length=16)=>createHash("sha256").update(value).digest("hex").slice(0,length);
export function redactTelemetry(value:unknown,secret?:string):unknown {
 if(typeof value==="string")return (secret?value.split(secret).join("[credential redacted]"):value).replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi,"Bearer [redacted]").replace(/https?:\/\/[^\s<>"']+/g,raw=>{try{const url=new URL(raw);if(/(?:oaiusercontent|openai)\.com$/.test(url.hostname)||[...url.searchParams.keys()].some(key=>/token|sig|key|credential|auth/i.test(key))){url.search="";url.hash="";return url.toString();}}catch{}return raw;});
 if(Array.isArray(value))return value.map(item=>redactTelemetry(item,secret));
 if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,/authorization|api.?key|access.?token|refresh.?token|download_url|password|secret/i.test(key)?"[redacted]":redactTelemetry(item,secret)]));return value;
}
const nano=(time:readonly[number,number])=>(BigInt(time[0])*1000000000n+BigInt(time[1])).toString();
export function otlpSpan(span:ReadableSpan){return {traceId:span.spanContext().traceId,spanId:span.spanContext().spanId,...(span.parentSpanContext?{parentSpanId:span.parentSpanContext.spanId}:{}),name:span.name,kind:span.kind+1,startTimeUnixNano:nano(span.startTime),endTimeUnixNano:nano(span.endTime),attributes:Object.entries(span.attributes).filter(([,value])=>value!==undefined).map(([key,value])=>({key,value:typeof value==="number"?Number.isInteger(value)?{intValue:String(value)}:{doubleValue:value}:typeof value==="boolean"?{boolValue:value}:{stringValue:typeof value==="string"?value:JSON.stringify(value)}})),status:{code:span.status.code,...(span.status.message?{message:span.status.message}:{})}};}
/** Pi input/output remain encrypted, chunked and retained with their parent run.
 * SDK providers are local instances; no global context can mix tenant spans. */
export class PiTelemetry {
 readonly traceId:string;
 constructor(private db:Database,private key:string,readonly tenantId:string,readonly runId:string,private secret?:string,private wake?:()=>Promise<void>){this.traceId=telemetryId(`${tenantId}:${runId}`,32);}
 withSecret(secret?:string){this.secret=secret;return this;}
 private spanId(key:string){return telemetryId(`${this.traceId}:${key}`);}
 private async chunks(client:DatabaseClient,key:string,field:"input"|"output",content:string){
  let chunk=0;for(let offset=0;offset<content.length;){let end=Math.min(content.length,offset+16384);if(end<content.length&&/[\uD800-\uDBFF]/.test(content[end-1]))end--;await client.query("INSERT INTO app.run_telemetry_content(tenant_id,run_id,span_key,field,chunk,encrypted_content) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING",[this.tenantId,this.runId,key,field,chunk++,await encrypt(content.slice(offset,end),this.key)]);offset=end;}
 }
 async begin(key:string,kind:"run"|"turn"|"model"|"tool"|"compaction"|"retry",name:string,input?:unknown,parent="run",attributes:Attributes={}){
  const attrs:Attributes={...attributes,[SC.SESSION_ID]:this.runId,[SC.OPENINFERENCE_SPAN_KIND]:kind==="run"?OpenInferenceSpanKind.AGENT:kind==="model"||kind==="compaction"?OpenInferenceSpanKind.LLM:kind==="tool"?OpenInferenceSpanKind.TOOL:OpenInferenceSpanKind.CHAIN,"factorize.run.id":this.runId,"factorize.span.kind":kind};
  const content=input===undefined?undefined:JSON.stringify(redactTelemetry(input,this.secret));
  if(content!==undefined){attrs[SC.INPUT_MIME_TYPE]="application/json";attrs[SC.INPUT_VALUE]=content.length>65536?JSON.stringify({preview:content.slice(0,4096),contentRef:{runId:this.runId,spanKey:key,field:"input"}}):content;}
  await this.db.transaction(async client=>{
   const inserted=await client.query("INSERT INTO app.run_telemetry_spans(tenant_id,run_id,span_key,trace_id,span_id,parent_span_id,kind,name,encrypted_attributes,model) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING RETURNING span_key",[this.tenantId,this.runId,key,this.traceId,this.spanId(key),key==="run"?null:this.spanId(parent),kind,name,await encrypt(JSON.stringify(redactTelemetry(attrs,this.secret)),this.key),attributes[SC.LLM_MODEL_NAME]??null]);
   if(inserted.rowCount&&content!==undefined)await this.chunks(client,key,"input",content);
  });
 }
 async end(key:string,output?:unknown,status:Exclude<TelemetryStatus,"running">="ok",attributes:Attributes={},usage?:Partial<Usage>){
  const content=output===undefined?undefined:JSON.stringify(redactTelemetry(output,this.secret));let queued=false;
  await this.db.transaction(async client=>{
   const row=(await client.query<TelemetryRow>("SELECT * FROM app.run_telemetry_spans WHERE tenant_id=$1 AND run_id=$2 AND span_key=$3 FOR UPDATE",[this.tenantId,this.runId,key])).rows[0];if(!row||row.ended_at)return;
   const attrs={...JSON.parse(await decrypt(row.encrypted_attributes,this.key)),...attributes};
   if(content!==undefined){attrs[SC.OUTPUT_MIME_TYPE]="application/json";attrs[SC.OUTPUT_VALUE]=content.length>65536?JSON.stringify({preview:content.slice(0,4096),contentRef:{runId:this.runId,spanKey:key,field:"output"}}):content;}
   // Pi initializes usage to zeros before any provider reports it. All-zero
   // defaults cannot establish that usage was reported, so leave those unknown.
   const reported=usage&&[usage.input,usage.output,usage.cacheRead,usage.cacheWrite].some(n=>typeof n==="number"&&n>0);
   const count=(value:unknown)=>reported&&typeof value==="number"&&Number.isSafeInteger(Math.floor(value))&&value>=0?Math.floor(value):null;
   const input=count(usage?.input),out=count(usage?.output),read=count(usage?.cacheRead),write=count(usage?.cacheWrite),reasoning=count(usage?.reasoning);
   if(input!==null){attrs[SC.LLM_TOKEN_COUNT_PROMPT]=input+(read??0)+(write??0);attrs[SC.LLM_TOKEN_COUNT_COMPLETION]=out??0;attrs[SC.LLM_TOKEN_COUNT_TOTAL]=input+(read??0)+(write??0)+(out??0);if(read!==null)attrs[SC.LLM_TOKEN_COUNT_PROMPT_DETAILS_CACHE_READ]=read;if(write!==null)attrs[SC.LLM_TOKEN_COUNT_PROMPT_DETAILS_CACHE_WRITE]=write;if(reasoning!==null)attrs[SC.LLM_TOKEN_COUNT_COMPLETION_DETAILS_REASONING]=reasoning;}
   const price=row.kind==="model"||row.kind==="compaction"?await priceSpan(client,this.tenantId,this.runId,row.model,{input,output:out,cacheRead:read,cacheWrite:write,reasoning}):{cost:null,snapshot:null};
   if(price.cost!==null)attrs[SC.LLM_COST_TOTAL]=price.cost;
   attrs["factorize.status"]=status;const safe=redactTelemetry(attrs,this.secret) as Attributes,ended=new Date();let recorded:ReadableSpan|undefined;
   const processor:SpanProcessor={onStart(){},onEnd(span){recorded=span;},forceFlush:async()=>{},shutdown:async()=>{}};
   const provider=new TracerProvider({idGenerator:{generateTraceId:()=>row.trace_id,generateSpanId:()=>row.span_id},spanProcessors:[processor],spanLimits:{attributeCountLimit:256}});
   const parent=row.parent_span_id?trace.setSpanContext(ROOT_CONTEXT,{traceId:row.trace_id,spanId:row.parent_span_id,traceFlags:1}):ROOT_CONTEXT;
   const span=provider.getTracer("factorize.pi","1.5.2").startSpan(row.name,{kind:SpanKind.INTERNAL,startTime:row.started_at,attributes:safe},parent);span.setStatus({code:status==="ok"?SpanStatusCode.OK:SpanStatusCode.ERROR,message:status==="ok"?undefined:status});span.end(ended);await provider.shutdown();
   if(!recorded)throw new Error("OpenTelemetry did not record the completed span.");
   if(content!==undefined)await this.chunks(client,key,"output",content);
   await client.query("UPDATE app.run_telemetry_spans SET ended_at=$4,status=$5,encrypted_attributes=$6,encrypted_otel=$7,input_tokens=$8,output_tokens=$9,cache_read_tokens=$10,cache_write_tokens=$11,reasoning_tokens=$12,cost_usd=$13,encrypted_pricing=$14 WHERE tenant_id=$1 AND run_id=$2 AND span_key=$3",[this.tenantId,this.runId,key,ended,status,await encrypt(JSON.stringify(safe),this.key),await encrypt(JSON.stringify(otlpSpan(recorded)),this.key),input,out,read,write,reasoning,price.cost,price.snapshot?await encrypt(JSON.stringify(price.snapshot),this.key):null]);
   queued=await enqueuePhoenixSpan(client,this.tenantId,this.runId,key);
  });
  if(queued&&this.wake)await this.wake().catch(()=>{});
 }
 /** Replay committed framework outcomes after an interrupted capture write.
  * Ending a span is idempotent; advancing the cursor can be retried safely. */
 async recoverJournal(){
  let cursor=Number((await this.db.pool.query("SELECT telemetry_sequence FROM app.pi_sessions WHERE tenant_id=$1 AND run_id=$2",[this.tenantId,this.runId])).rows[0]?.telemetry_sequence??0);
  for(;;){const events=(await this.db.pool.query("SELECT sequence,event_type,encrypted_event FROM app.pi_session_events WHERE tenant_id=$1 AND run_id=$2 AND sequence>$3 AND event_type IN ('message_end','tool_execution_start','tool_execution_end','compaction_model') ORDER BY sequence LIMIT 100",[this.tenantId,this.runId,cursor])).rows;
   if(!events.length)break;
   for(const event of events){const value=JSON.parse(await decrypt(event.encrypted_event,this.key)),meta=value.telemetry;
    if(meta){
     if(event.event_type==="tool_execution_start")await this.begin(`tool:${value.toolCallId}`,"tool",value.toolName,value.args,meta.turnKey,{[SC.TOOL_NAME]:value.toolName,[SC.TOOL_CALL_ID]:value.toolCallId});
     else if(event.event_type==="tool_execution_end")await this.end(`tool:${value.toolCallId}`,value.result,value.isError?"error":"ok");
     else if(value.message?.role==="assistant")await this.end(meta.modelKey,value.message,value.message.stopReason==="aborted"?"canceled":["error","length"].includes(value.message.stopReason)?"error":"ok",{[SC.LLM_FINISH_REASON]:value.message.stopReason},value.message.usage);
    }
    cursor=Number(event.sequence);
   }
   await this.db.pool.query("UPDATE app.pi_sessions SET telemetry_sequence=GREATEST(telemetry_sequence,$3) WHERE tenant_id=$1 AND run_id=$2",[this.tenantId,this.runId,cursor]);
  }
 }
 async finish(status:Exclude<TelemetryStatus,"running">,output?:unknown){
  await this.recoverJournal();
  const rows=(await this.db.pool.query<{span_key:string}>("SELECT span_key FROM app.run_telemetry_spans WHERE tenant_id=$1 AND run_id=$2 AND ended_at IS NULL AND span_key<>'run'",[this.tenantId,this.runId])).rows;for(const row of rows)await this.end(row.span_key,undefined,status);await this.end("run",output,status);
 }
 async content(key:string,field:"input"|"output",chunk=0){
  const row=(await this.db.pool.query("SELECT encrypted_content FROM app.run_telemetry_content WHERE tenant_id=$1 AND run_id=$2 AND span_key=$3 AND field=$4 AND chunk=$5",[this.tenantId,this.runId,key,field,chunk])).rows[0];return row?await decrypt(row.encrypted_content,this.key):null;
 }
}

/** Finish telemetry after a terminal state committed but the capturing process died. */
export async function reconcileTerminalTelemetry(db:Database,key:string){
 const rows=(await db.pool.query("SELECT r.tenant_id,r.id,r.state FROM app.runs r JOIN app.run_telemetry_spans s ON s.tenant_id=r.tenant_id AND s.run_id=r.id AND s.span_key='run' WHERE r.state IN ('succeeded','failed','stopped') AND s.ended_at IS NULL ORDER BY r.updated_at LIMIT 50")).rows;
 for(const row of rows)await new PiTelemetry(db,key,row.tenant_id,row.id).finish(row.state==="succeeded"?"ok":row.state==="stopped"?"canceled":"error",{state:row.state,recovered:true});
}
