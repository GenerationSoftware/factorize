import {phoenixRunStatus} from "./phoenix-contracts";
import {z} from "zod";
import {decrypt} from "./crypto";
import {AgentApiError} from "./agent-api-error";
import type {Database} from "./postgres/database";
import type {TelemetryRow} from "./pi-telemetry";
export const telemetryPageQuery=z.object({cursor:z.coerce.number().int().min(0).max(1000000).default(0),limit:z.coerce.number().int().min(1).max(50).default(25)});
export const telemetryContentQuery=z.object({field:z.enum(["input","output"]).default("output"),chunk:z.coerce.number().int().min(0).default(0),offset:z.coerce.number().int().min(0).max(16384).default(0),limit:z.coerce.number().int().min(1).max(2048).default(2048)});
const number=z.number().nullable();
export const telemetryUsage=z.object({input:number,uncachedInput:number,output:number,cacheRead:number,cacheWrite:number,reasoning:number,total:number});
export const telemetrySpan=z.object({id:z.string(),key:z.string(),traceId:z.string(),parentId:z.string().nullable(),kind:z.string(),name:z.string(),model:z.string().nullable(),status:z.enum(["running","ok","error","canceled","uncertain"]),startedAt:z.string(),endedAt:z.string().nullable(),durationMs:z.number(),usage:telemetryUsage,costUsd:number});
export const telemetryPage=z.object({available:z.boolean(),traceId:z.string().nullable(),items:z.array(telemetrySpan),nextCursor:z.number().int().nullable(),phoenix:phoenixRunStatus.optional(),summary:z.object({durationMs:number,modelCalls:z.number().int(),toolCalls:z.number().int(),unreportedCalls:z.number().int(),unpricedCalls:z.number().int(),usage:telemetryUsage,costUsd:number})});
export const telemetryContent=z.object({text:z.string(),field:z.enum(["input","output"]),next:z.object({chunk:z.number().int(),offset:z.number().int()}).nullable(),pricing:z.unknown()});
const num=(value:unknown)=>value===null||value===undefined?null:Number(value);
export const publicUsage=(row:{input_tokens:unknown;output_tokens:unknown;cache_read_tokens:unknown;cache_write_tokens:unknown;reasoning_tokens:unknown})=>{
 const input=num(row.input_tokens),output=num(row.output_tokens),cacheRead=num(row.cache_read_tokens),cacheWrite=num(row.cache_write_tokens),reasoning=num(row.reasoning_tokens),prompt=input===null?null:input+(cacheRead??0)+(cacheWrite??0);
 return {input:prompt,uncachedInput:input,output,cacheRead,cacheWrite,reasoning,total:prompt===null||output===null?null:prompt+output};
};
export class RunTelemetry {
 constructor(private db:Database,private key:string,private tenantId:string){}
 private async exists(runId:string){if(!(await this.db.pool.query("SELECT 1 FROM app.runs WHERE tenant_id=$1 AND id=$2",[this.tenantId,runId])).rowCount)throw new AgentApiError(404,"not_found","Run not found.");}
 async page(runId:string,query:z.infer<typeof telemetryPageQuery>){
  await this.exists(runId);const rows=(await this.db.pool.query<TelemetryRow>("SELECT * FROM app.run_telemetry_spans WHERE tenant_id=$1 AND run_id=$2 ORDER BY started_at,span_key LIMIT $3 OFFSET $4",[this.tenantId,runId,query.limit+1,query.cursor])).rows;
  const totals=(await this.db.pool.query(`SELECT count(*)::int spans,count(*) FILTER(WHERE kind IN ('model','compaction'))::int model_calls,count(*) FILTER(WHERE kind='tool')::int tool_calls,
   count(*) FILTER(WHERE kind IN ('model','compaction') AND (input_tokens IS NULL OR output_tokens IS NULL))::int unreported_calls,count(*) FILTER(WHERE kind IN ('model','compaction') AND cost_usd IS NULL)::int unpriced_calls,
   sum(input_tokens) FILTER(WHERE kind IN ('model','compaction')) input_tokens,sum(output_tokens) FILTER(WHERE kind IN ('model','compaction')) output_tokens,sum(cache_read_tokens) FILTER(WHERE kind IN ('model','compaction')) cache_read_tokens,sum(cache_write_tokens) FILTER(WHERE kind IN ('model','compaction')) cache_write_tokens,sum(reasoning_tokens) FILTER(WHERE kind IN ('model','compaction')) reasoning_tokens,sum(cost_usd) FILTER(WHERE kind IN ('model','compaction')) cost,
   min(started_at) FILTER(WHERE kind='run') root_start,max(ended_at) FILTER(WHERE kind='run') root_end,min(trace_id) trace_id FROM app.run_telemetry_spans WHERE tenant_id=$1 AND run_id=$2`,[this.tenantId,runId])).rows[0];
  const turnIds=rows.slice(0,query.limit).filter(row=>row.kind==="turn").map(row=>row.span_id);
  const turns=turnIds.length?(await this.db.pool.query(`SELECT parent_span_id,sum(input_tokens) input_tokens,sum(output_tokens) output_tokens,sum(cache_read_tokens) cache_read_tokens,sum(cache_write_tokens) cache_write_tokens,sum(reasoning_tokens) reasoning_tokens,sum(cost_usd) cost,count(*) FILTER(WHERE cost_usd IS NULL)::int unpriced_calls FROM app.run_telemetry_spans WHERE tenant_id=$1 AND run_id=$2 AND parent_span_id=ANY($3::text[]) AND kind IN ('model','compaction') GROUP BY parent_span_id`,[this.tenantId,runId,turnIds])).rows:[];
  const items=rows.slice(0,query.limit).map(row=>{
   // Aggregate only at read time: persisted model/compaction counts remain the
   // single source of billable usage, so parent spans cannot double-count it.
   const aggregate=row.kind==="run"?totals:row.kind==="turn"?turns.find(turn=>turn.parent_span_id===row.span_id):undefined;
   return {id:row.span_id,key:row.span_key,traceId:row.trace_id,parentId:row.parent_span_id,kind:row.kind,name:row.name,model:row.model,status:row.status,startedAt:row.started_at.toISOString(),endedAt:row.ended_at?.toISOString()??null,durationMs:Math.max(0,(row.ended_at?.getTime()??Date.now())-row.started_at.getTime()),usage:publicUsage(aggregate??row),costUsd:aggregate?aggregate.unpriced_calls?null:num(aggregate.cost):num(row.cost_usd)};
  });
  return {available:totals.spans>0,traceId:totals.trace_id??null,items,nextCursor:rows.length>query.limit?query.cursor+query.limit:null,summary:{durationMs:totals.root_start?Math.max(0,(totals.root_end?.getTime()??Date.now())-totals.root_start.getTime()):null,modelCalls:totals.model_calls,toolCalls:totals.tool_calls,unreportedCalls:totals.unreported_calls,unpricedCalls:totals.unpriced_calls,usage:publicUsage(totals),costUsd:totals.unpriced_calls?null:num(totals.cost)}};
 }
 async content(runId:string,spanId:string,query:z.infer<typeof telemetryContentQuery>){
  await this.exists(runId);const span=(await this.db.pool.query<TelemetryRow>("SELECT * FROM app.run_telemetry_spans WHERE tenant_id=$1 AND run_id=$2 AND span_id=$3",[this.tenantId,runId,spanId])).rows[0];if(!span)throw new AgentApiError(404,"not_found","Telemetry span not found.");
  const rows=(await this.db.pool.query("SELECT chunk,encrypted_content FROM app.run_telemetry_content WHERE tenant_id=$1 AND run_id=$2 AND span_key=$3 AND field=$4 AND chunk >= $5 ORDER BY chunk LIMIT 2",[this.tenantId,runId,span.span_key,query.field,query.chunk])).rows;
  const full=rows[0]?.chunk===query.chunk?await decrypt(rows[0].encrypted_content,this.key):"";
  const text=full.slice(query.offset,query.offset+query.limit),next=query.offset+text.length<full.length?{chunk:query.chunk,offset:query.offset+text.length}:rows[1]?{chunk:query.chunk+1,offset:0}:null;
  return {text,field:query.field,next,pricing:span.encrypted_pricing?JSON.parse(await decrypt(span.encrypted_pricing,this.key)):null};
 }
}
