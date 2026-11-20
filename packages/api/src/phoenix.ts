import {ProtobufTraceSerializer} from "@opentelemetry/otlp-transformer";
import {resourceFromAttributes} from "@opentelemetry/resources";
import type {ReadableSpan} from "@opentelemetry/sdk-trace";
import type {Attributes,SpanContext,SpanKind,SpanStatus} from "@opentelemetry/api";
import {encrypt,decrypt} from "./crypto";
import {databaseFor,type DatabaseClient} from "./postgres/database";
import {AgentApiError} from "./agent-api-error";
import {phoenixInput} from "./phoenix-contracts";
import type {z} from "zod";
import type {Env} from "./types";
type Config={tenant_id:string;endpoint:string;project_name:string;project_id:string|null;encrypted_key:string;enabled:boolean;enabled_since:Date;revision:number;last_test_at:Date|null;last_error:string|null};
const publicConfig=(row?:Config)=>({configured:!!row,endpoint:row?.endpoint??"",projectName:row?.project_name??"factorize",projectId:row?.project_id??null,credentialConfigured:!!row?.encrypted_key,enabled:row?.enabled??false,revision:row?.revision??0,lastTestAt:row?.last_test_at?.toISOString()??null,lastError:row?.last_error??null});
const conflict=()=>new AgentApiError(409,"revision_conflict","Phoenix settings changed; reload before saving.");
export class PhoenixIntegration {
 private db;
 constructor(private env:Env,private tenantId:string){this.db=databaseFor(env);}
 async get(){return publicConfig((await this.db.pool.query<Config>("SELECT * FROM app.phoenix_integrations WHERE tenant_id=$1",[this.tenantId])).rows[0]);}
 async put(input:z.infer<typeof phoenixInput>){
  const value=phoenixInput.parse(input),endpoint=value.endpoint.replace(/\/v1\/traces\/?$/,"").replace(/\/$/,"");if(new URL(endpoint).origin===new URL(this.env.APP_ORIGIN).origin)throw new AgentApiError(400,"invalid_endpoint","Phoenix must be a separate public service.");
  await this.db.transaction(async client=>{
   await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",["phoenix:"+this.tenantId]);const previous=(await client.query<Config>("SELECT * FROM app.phoenix_integrations WHERE tenant_id=$1 FOR UPDATE",[this.tenantId])).rows[0];
   if((previous?.revision??0)!==value.expectedRevision)throw conflict();
   const key=value.apiKey?await encrypt(value.apiKey,this.env.CREDENTIAL_ENCRYPTION_KEY):previous?.encrypted_key;if(!key)throw new AgentApiError(400,"missing_key","Enter a Phoenix API key.");
   const same=previous?.enabled&&value.enabled&&previous.endpoint===endpoint&&previous.project_name===value.projectName;
   await client.query("INSERT INTO app.phoenix_integrations(tenant_id,endpoint,project_name,encrypted_key,enabled,revision,enabled_since,project_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(tenant_id) DO UPDATE SET endpoint=excluded.endpoint,project_name=excluded.project_name,encrypted_key=excluded.encrypted_key,enabled=excluded.enabled,revision=excluded.revision,enabled_since=excluded.enabled_since,project_id=excluded.project_id,last_error=NULL",[this.tenantId,endpoint,value.projectName,key,value.enabled,(previous?.revision??0)+1,same?previous!.enabled_since:new Date(),same?previous!.project_id:null]);
   if(same)await client.query("UPDATE app.phoenix_span_exports SET integration_revision=$2,state='pending',next_attempt_at=now(),lease_id=NULL,lease_expires_at=NULL,attempts=0,last_error=NULL WHERE tenant_id=$1 AND state IN ('pending','sending','failed')",[this.tenantId,previous!.revision+1]);
   else await client.query("UPDATE app.phoenix_span_exports SET state='canceled',lease_id=NULL,lease_expires_at=NULL,last_error='Integration disabled, disconnected, or destination changed.' WHERE tenant_id=$1 AND state IN ('pending','sending','failed')",[this.tenantId]);
  });await wakePhoenix(this.env);return this.get();
 }
 async remove(expectedRevision:number){await this.db.transaction(async client=>{const deleted=await client.query("DELETE FROM app.phoenix_integrations WHERE tenant_id=$1 AND revision=$2 RETURNING tenant_id",[this.tenantId,expectedRevision]);if(!deleted.rowCount)throw conflict();await client.query("UPDATE app.phoenix_span_exports SET state='canceled',lease_id=NULL,last_error='Integration disconnected.' WHERE tenant_id=$1 AND state IN ('pending','sending','failed')",[this.tenantId]);});return this.get();}
 async test(){
  const row=(await this.db.pool.query<Config>("SELECT * FROM app.phoenix_integrations WHERE tenant_id=$1",[this.tenantId])).rows[0];if(!row)throw new AgentApiError(404,"not_found","Configure Phoenix first.");
  let error:string|null=null,projectId:string|null=null;
  try{const key=await decrypt(row.encrypted_key,this.env.CREDENTIAL_ENCRYPTION_KEY);const probe=await fetch(row.endpoint+"/v1/projects?limit=1",{headers:{Authorization:"Bearer "+key},redirect:"manual",signal:AbortSignal.timeout(15000)});if(!probe.ok)throw new Error(`Phoenix returned HTTP ${probe.status}.`);await probe.body?.cancel();projectId=await phoenixProjectId(row,key);}catch(reason){error=reason instanceof Error&&/^Phoenix returned HTTP [0-9]+\.$/.test(reason.message)?reason.message:"Phoenix could not be reached; check the base URL and API key.";}
  await this.db.pool.query("UPDATE app.phoenix_integrations SET last_test_at=now(),last_error=$3,project_id=COALESCE($4,project_id) WHERE tenant_id=$1 AND revision=$2",[this.tenantId,row.revision,error,projectId]);return {connected:error===null,projectFound:projectId!==null,error};
 }
}
async function limitedBody(response:Response,limit:number){const reader=response.body?.getReader(),chunks:Uint8Array[]=[];let size=0;if(reader)try{for(;;){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>limit)throw new Error("Phoenix response exceeds limit");chunks.push(next.value);}}catch(error){void reader.cancel().catch(()=>{});throw error;}const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;}
async function phoenixProjectId(config:Config,key:string){const response=await fetch(config.endpoint+"/v1/projects/"+encodeURIComponent(config.project_name),{headers:{Authorization:"Bearer "+key},redirect:"manual",signal:AbortSignal.timeout(15000)});if(response.status===404){await response.body?.cancel();return null;}if(!response.ok){await response.body?.cancel();throw new Error(`Phoenix returned HTTP ${response.status}.`);}const body=JSON.parse(new TextDecoder().decode(await limitedBody(response,16384)));if(typeof body?.data?.id!=="string"||body.data.id.length>256)throw new Error("Invalid Phoenix project response");return body.data.id;}
export async function wakePhoenix(env:Env){if(env.SCHEDULER)await env.SCHEDULER.get(env.SCHEDULER.idFromName("global")).fetch("https://scheduler/wake",{method:"POST"});}
/** Runs predating enablement are deliberately not backfilled. */
export async function enqueuePhoenixSpan(client:DatabaseClient,tenantId:string,runId:string,spanKey:string){
 const inserted=await client.query("INSERT INTO app.phoenix_span_exports(tenant_id,run_id,span_key,integration_revision) SELECT s.tenant_id,s.run_id,s.span_key,p.revision FROM app.run_telemetry_spans s JOIN app.runs r ON r.tenant_id=s.tenant_id AND r.id=s.run_id JOIN app.phoenix_integrations p ON p.tenant_id=s.tenant_id WHERE s.tenant_id=$1 AND s.run_id=$2 AND s.span_key=$3 AND s.encrypted_otel IS NOT NULL AND p.enabled AND r.created_at>=p.enabled_since ON CONFLICT DO NOTHING RETURNING run_id",[tenantId,runId,spanKey]);return !!inserted.rowCount;
}
const hr=(value:string):[number,number]=>{const n=BigInt(value);return [Number(n/1000000000n),Number(n%1000000000n)];};
/** Rehydrate durable SDK data for the official OTLP protobuf serializer. */
export function readablePhoenixSpan(value:any,projectName:string):ReadableSpan {
 const attributes:Attributes={};for(const item of value.attributes??[]){const v=item.value;attributes[item.key]=v.stringValue??v.boolValue??(v.intValue!==undefined?Number(v.intValue):v.doubleValue);}
 const start=hr(value.startTimeUnixNano),end=hr(value.endTimeUnixNano),duration=BigInt(value.endTimeUnixNano)-BigInt(value.startTimeUnixNano);
 const context:SpanContext={traceId:value.traceId,spanId:value.spanId,traceFlags:1};return {name:value.name,kind:(value.kind-1) as SpanKind,spanContext:()=>context,parentSpanContext:value.parentSpanId?{traceId:value.traceId,spanId:value.parentSpanId,traceFlags:1}:undefined,startTime:start,endTime:end,duration:hr(duration.toString()),status:value.status as SpanStatus,attributes,resource:resourceFromAttributes({"service.name":"factorize","openinference.project.name":projectName}),instrumentationScope:{name:"factorize.pi",version:"1.5.2"},links:[],events:[],ended:true,droppedAttributesCount:0,droppedEventsCount:0,droppedLinksCount:0};
}
export async function processPhoenixExports(env:Env){
 const db=databaseFor(env),lease=crypto.randomUUID();
 const claimed=await db.transaction(async client=>{
  const config=(await client.query<Config>("SELECT p.* FROM app.phoenix_integrations p WHERE p.enabled AND EXISTS(SELECT 1 FROM app.phoenix_span_exports e WHERE e.tenant_id=p.tenant_id AND e.integration_revision=p.revision AND (e.state='pending' AND e.next_attempt_at<=now() OR e.state='sending' AND e.lease_expires_at<now())) ORDER BY p.tenant_id LIMIT 1 FOR UPDATE SKIP LOCKED")).rows[0];if(!config)return null;
  const rows=(await client.query("WITH chosen AS(SELECT e.tenant_id,e.run_id,e.span_key FROM app.phoenix_span_exports e WHERE e.tenant_id=$1 AND e.integration_revision=$2 AND (state='pending' AND next_attempt_at<=now() OR state='sending' AND lease_expires_at<now()) ORDER BY next_attempt_at,run_id,span_key LIMIT 20 FOR UPDATE SKIP LOCKED) UPDATE app.phoenix_span_exports e SET state='sending',lease_id=$3,lease_expires_at=now()+interval '2 minutes',attempts=attempts+1 FROM chosen c WHERE e.tenant_id=c.tenant_id AND e.run_id=c.run_id AND e.span_key=c.span_key RETURNING e.*",[config.tenant_id,config.revision,lease])).rows;
  return {config,rows};
 });if(!claimed){await repairPhoenixLinks(env);return;}
 const {config,rows}=claimed;let transient=true,message="Phoenix could not be reached; export will retry.",sent=false,projectId=config.project_id;
 try{
  const current=(await db.pool.query("SELECT revision,enabled FROM app.phoenix_integrations WHERE tenant_id=$1",[config.tenant_id])).rows[0];if(!current?.enabled||current.revision!==config.revision)return;
  const spans:ReadableSpan[]=[],spanByKey=new Map<string,ReadableSpan>();let payload:Uint8Array|undefined;
  for(let index=0;index<rows.length;index++){const row=rows[index],data=(await db.pool.query("SELECT encrypted_otel FROM app.run_telemetry_spans WHERE tenant_id=$1 AND run_id=$2 AND span_key=$3",[row.tenant_id,row.run_id,row.span_key])).rows[0];if(!data?.encrypted_otel)continue;const span=readablePhoenixSpan(JSON.parse(await decrypt(data.encrypted_otel,env.CREDENTIAL_ENCRYPTION_KEY)),config.project_name),candidate=ProtobufTraceSerializer.serializeRequest([...spans,span]);
   if(!candidate||candidate.length>2*1024*1024){if(!spans.length){transient=false;throw new Error("Export batch exceeds the fixed 2 MiB limit; local telemetry is retained.");}for(const unused of rows.slice(index))await db.pool.query("UPDATE app.phoenix_span_exports SET state='pending',attempts=GREATEST(0,attempts-1),lease_id=NULL,lease_expires_at=NULL WHERE tenant_id=$1 AND run_id=$2 AND span_key=$3 AND lease_id=$4",[unused.tenant_id,unused.run_id,unused.span_key,lease]);break;}
   spans.push(span);spanByKey.set(`${row.run_id}:${row.span_key}`,span);payload=candidate;
  }
  if(!payload){transient=false;throw new Error("Export batch exceeds the fixed 2 MiB limit; local telemetry is retained.");}
  const key=await decrypt(config.encrypted_key,env.CREDENTIAL_ENCRYPTION_KEY),response=await fetch(config.endpoint+"/v1/traces",{method:"POST",headers:{Authorization:"Bearer "+key,"Content-Type":"application/x-protobuf"},body:payload as Uint8Array<ArrayBuffer>,redirect:"manual",signal:AbortSignal.timeout(15000)});
  if(!response.ok){transient=response.status===429||response.status===408||response.status>=500;await response.body?.cancel();message=`Phoenix returned HTTP ${response.status}.`;throw new Error(message);}
  const body=await limitedBody(response,65536);const acknowledged=ProtobufTraceSerializer.deserializeResponse(body);
  if(Number(acknowledged.partialSuccess?.rejectedSpans??0)>0){transient=false;message="Phoenix rejected some spans; local telemetry is retained.";throw new Error(message);}
  sent=true;try{projectId=projectId??await phoenixProjectId(config,key);}catch{/* Successful ingestion remains successful if link discovery is temporarily unavailable. */}
  await db.transaction(async client=>{
   const current=(await client.query("SELECT revision,enabled FROM app.phoenix_integrations WHERE tenant_id=$1 FOR UPDATE",[config.tenant_id])).rows[0];if(!current?.enabled||current.revision!==config.revision)return;
   await client.query("UPDATE app.phoenix_span_exports SET state='sent',lease_id=NULL,lease_expires_at=NULL,last_error=NULL WHERE tenant_id=$1 AND lease_id=$2 AND state='sending'",[config.tenant_id,lease]);
   await client.query("UPDATE app.phoenix_integrations SET project_id=COALESCE($2,project_id),last_error=NULL WHERE tenant_id=$1",[config.tenant_id,projectId]);
   for(const row of rows){const span=spanByKey.get(`${row.run_id}:${row.span_key}`);if(span)await client.query("INSERT INTO app.phoenix_run_links(tenant_id,run_id,endpoint,project_name,project_id,trace_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,run_id) DO UPDATE SET project_id=COALESCE(excluded.project_id,app.phoenix_run_links.project_id)",[row.tenant_id,row.run_id,config.endpoint,config.project_name,projectId,span.spanContext().traceId]);}
  });
 }catch(error){
  if(error instanceof Error&&error.message.startsWith("Export batch exceeds"))message=error.message;
  await db.pool.query("UPDATE app.phoenix_span_exports SET state=CASE WHEN $3 AND attempts<8 THEN 'pending' ELSE 'failed' END,next_attempt_at=now()+LEAST(3600,POWER(2,attempts)*5)*interval '1 second',lease_id=NULL,lease_expires_at=NULL,last_error=$4 WHERE tenant_id=$1 AND lease_id=$2 AND state='sending'",[config.tenant_id,lease,transient,message]);
  await db.pool.query("UPDATE app.phoenix_integrations SET last_error=$3 WHERE tenant_id=$1 AND revision=$2",[config.tenant_id,config.revision,message]);
 }finally{if(!sent)await db.pool.query("UPDATE app.phoenix_span_exports SET state='canceled',lease_id=NULL,last_error='Integration changed during export.' WHERE tenant_id=$1 AND lease_id=$2 AND state='sending' AND NOT EXISTS(SELECT 1 FROM app.phoenix_integrations WHERE tenant_id=$1 AND revision=$3 AND enabled)",[config.tenant_id,lease,config.revision]);}
}
async function repairPhoenixLinks(env:Env){
 const db=databaseFor(env),config=(await db.pool.query<Config>("SELECT p.* FROM app.phoenix_integrations p WHERE p.enabled AND EXISTS(SELECT 1 FROM app.phoenix_run_links l WHERE l.tenant_id=p.tenant_id AND l.endpoint=p.endpoint AND l.project_name=p.project_name AND l.project_id IS NULL) LIMIT 1")).rows[0];if(!config)return;
 try{const id=config.project_id??await phoenixProjectId(config,await decrypt(config.encrypted_key,env.CREDENTIAL_ENCRYPTION_KEY));if(id)await db.pool.query("UPDATE app.phoenix_run_links SET project_id=$4 WHERE tenant_id=$1 AND endpoint=$2 AND project_name=$3 AND project_id IS NULL",[config.tenant_id,config.endpoint,config.project_name,id]);}catch{/* retry link lookup on maintenance without retransmitting spans */}
}
export async function nextPhoenixWake(env:Env){return (await databaseFor(env).pool.query<{wake:Date|null}>("SELECT min(CASE WHEN e.state='sending' THEN e.lease_expires_at ELSE e.next_attempt_at END) wake FROM app.phoenix_span_exports e JOIN app.phoenix_integrations p ON p.tenant_id=e.tenant_id AND p.enabled AND p.revision=e.integration_revision WHERE e.state IN ('pending','sending')")).rows[0]?.wake??null;}
export async function runPhoenixStatus(env:Env,tenantId:string,runId:string){
 const db=databaseFor(env),row=(await db.pool.query("SELECT count(*) FILTER(WHERE state IN ('pending','sending'))::int pending,count(*) FILTER(WHERE state='sent')::int sent,count(*) FILTER(WHERE state='failed')::int failed,count(*) FILTER(WHERE state='canceled')::int canceled,max(last_error) last_error FROM app.phoenix_span_exports WHERE tenant_id=$1 AND run_id=$2",[tenantId,runId])).rows[0],link=(await db.pool.query("SELECT * FROM app.phoenix_run_links WHERE tenant_id=$1 AND run_id=$2",[tenantId,runId])).rows[0];
 return {url:link?.project_id?`${link.endpoint}/projects/${encodeURIComponent(link.project_id)}/traces/${link.trace_id}`:null,pending:row.pending,sent:row.sent,failed:row.failed,canceled:row.canceled,lastError:row.last_error};
}
