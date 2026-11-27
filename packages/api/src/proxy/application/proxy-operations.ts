import { proxyLimits } from "../../config/limits";
import { appConfig, signingConfig } from "../../config/runtime";
import {proxyRequestBody,cleanupProxyPayloads} from "./proxy-payloads";
import {Buffer} from "node:buffer";
import {z} from "zod";
import {AgentApiService} from "./agent-api";
import {AgentApiError} from "../api/agent-api-error";
import {requestApiInput} from "../api/agent-api-contracts";
import {databaseFor} from "../../postgres/database";
import {encrypt,decrypt} from "../../crypto";
import type {Env,OAuthProps} from "../../types";
export const operationRef=z.object({operationId:z.uuid()}).strict();
export const operationRead=operationRef.extend({offset:z.number().int().nonnegative().default(0),limit:z.number().int().min(1).max(384).default(384)});
export const operationReceipt=z.object({operationId:z.uuid(),state:z.enum(["queued","running","complete","failed","canceled","uncertain"]),status:z.number().int().nullable(),size:z.number().int(),partial:z.boolean(),effectsUncertain:z.boolean(),error:z.object({code:z.string(),message:z.string()}).nullable(),responseHandle:z.uuid().optional(),expiresAt:z.string(),instructions:z.string()});
type Operation={tenant_id:string;id:string;identity_id:string;integration_id:string;integration_epoch:number;encrypted_request:string;encrypted_auth:string;state:z.infer<typeof operationReceipt>["state"];size:number;status:number|null;headers:Record<string,string>;error_code:string|null;error_message:string|null;effects_uncertain:boolean;started_at:Date|null;updated_at:Date;expires_at:Date};
const blockBytes=proxyLimits.artifactBlockBytes;
const keyFor=(row:Pick<Operation,"tenant_id"|"identity_id"|"id">)=>`agent-responses/${row.tenant_id}/${row.identity_id}/${row.id}`;
const receipt=(row:Operation)=>({operationId:row.id,state:row.state,status:row.status,size:row.size,partial:row.state!=="complete"&&row.size>0,effectsUncertain:row.effects_uncertain,error:row.error_code?{code:row.error_code,message:row.error_message!}:null,...(row.state==="complete"?{responseHandle:row.id}:{}),expiresAt:row.expires_at.toISOString(),instructions:row.state==="complete"?"Use query_api_response with responseHandle for selected JSON/text/bytes.":"Use read_api_operation for incremental bytes, get_api_operation to poll, or cancel_api_operation. Do not repeat uncertain writes."});
async function readNext(reader:ReadableStreamDefaultReader<Uint8Array>,signal:AbortSignal){
 if(signal.aborted)throw signal.reason;
 let abort!:()=>void;
 const interrupted=new Promise<never>((_,reject)=>{abort=()=>reject(signal.reason);signal.addEventListener("abort",abort,{once:true});});
 try{return await Promise.race([reader.read(),interrupted]);}finally{signal.removeEventListener("abort",abort);}
}
export class ProxyOperations {
 private db;
 constructor(private env:Env,private auth:OAuthProps){this.db=databaseFor(env);}
 private api(){return new AgentApiService(this.env,this.auth);}
 async start(input:z.infer<typeof requestApiInput>){
  const parsed=requestApiInput.parse(input),api=this.api();
  if(this.auth.authMethod==="oauth"&&!this.auth.scopes.includes("proxy:use"))throw new AgentApiError(403,"insufficient_scope","Renew consent with proxy:use before requesting integrations.","proxy:use");
  const {identity,integration}=await api.authorize(parsed.integration);
  if(!this.env.PROXY_ARTIFACTS || !this.env.SCHEDULER)throw new AgentApiError(503,"proxy_unavailable","Durable proxy storage/scheduling is unavailable.");
  const size=parsed.body===undefined?0:Buffer.byteLength(parsed.body,parsed.encoding==="base64"?"base64":"utf8");
  if(size>proxyLimits.requestBytes)throw new AgentApiError(413,"request_too_large","Request exceeds the fixed 32 MiB limit.");
  if(parsed.encoding==="base64"&&parsed.body&&!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(parsed.body))throw new AgentApiError(400,"invalid_request","Invalid base64 request body.");
  const id=crypto.randomUUID(),idempotency=parsed.idempotencyKey??id;
  const serialized=JSON.stringify({...parsed,idempotencyKey:undefined,execution:undefined});
  const row=await this.db.transaction(async client=>{
   const saved=(await client.query<Operation>(`INSERT INTO app.proxy_operations(tenant_id,id,identity_id,integration_id,integration_epoch,idempotency_key,encrypted_request,encrypted_auth)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(tenant_id,identity_id,idempotency_key) DO UPDATE SET idempotency_key=excluded.idempotency_key RETURNING *`,[this.auth.tenantId,id,identity.id,integration.id,integration.epoch,idempotency,await encrypt(serialized,signingConfig(this.env).credentialKey),await encrypt(JSON.stringify(this.auth),signingConfig(this.env).credentialKey)])).rows[0];
   if(await decrypt(saved.encrypted_request,signingConfig(this.env).credentialKey)!==serialized)throw new AgentApiError(409,"idempotency_conflict","This idempotency key identifies a different request.");
   await client.query(`INSERT INTO app.agent_proxy_responses(tenant_id,id,identity_id,integration_id,integration_epoch,object_key,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,[saved.tenant_id,saved.id,saved.identity_id,saved.integration_id,saved.integration_epoch,keyFor(saved),saved.expires_at]);return saved;
  });
  await dispatchProxyOperation(this.env,row.tenant_id,row.id);
  await this.env.SCHEDULER.get(this.env.SCHEDULER.idFromName("global")).fetch("https://scheduler/wake",{method:"POST"});return receipt(row);
 }
 private async authorized(id:string){
  const identity=await this.api().identity();
  const row=(await this.db.pool.query<Operation>("SELECT * FROM app.proxy_operations WHERE tenant_id=$1 AND id=$2 AND identity_id=$3 AND expires_at>now()",[this.auth.tenantId,id,identity.id])).rows[0];
  if(!row)throw new AgentApiError(404,"not_found","Operation not found or expired.");
  if(this.auth.authMethod==="oauth"&&!this.auth.scopes.includes("proxy:use"))throw new AgentApiError(403,"insufficient_scope","The proxy:use scope is required.","proxy:use");
  const grant=await this.api().authorize(row.integration_id);if(grant.integration.epoch!==row.integration_epoch)throw new AgentApiError(403,"forbidden","Integration access changed.");return row;
 }
 async get(id:string){return receipt(await this.authorized(id));}
 async cancel(id:string){
  await this.authorized(id);await this.db.pool.query("UPDATE app.proxy_operations SET state='canceled',effects_uncertain=state='running',error_code='canceled',error_message='Operation canceled. An upstream write may already have taken effect.',updated_at=now() WHERE tenant_id=$1 AND id=$2 AND state IN ('queued','running')",[this.auth.tenantId,id]);return this.get(id);
 }
 async read(input:z.infer<typeof operationRead>){
  const value=operationRead.parse(input),row=await this.authorized(value.operationId);
  if(value.offset>row.size)throw new AgentApiError(400,"invalid_request","Offset exceeds the bytes retained so far.");
  const length=Math.min(value.limit,row.size-value.offset),bytes=new Uint8Array(length);let copied=0;
  while(copied<length){const offset=value.offset+copied,part=Math.floor(offset/blockBytes),within=offset%blockBytes,count=Math.min(length-copied,blockBytes-within);const object=await this.env.PROXY_ARTIFACTS!.get(`${keyFor(row)}/${part}`,{range:{offset:within,length:count}});if(!object)throw new AgentApiError(503,"response_unavailable","Retained operation bytes are temporarily unavailable.");const chunk=new Uint8Array(await object.arrayBuffer());if(chunk.length!==count)throw new AgentApiError(503,"response_unavailable","Retained operation bytes are incomplete.");bytes.set(chunk,copied);copied+=count;}
  await this.authorized(value.operationId);return {operationId:row.id,offset:value.offset,nextOffset:value.offset+length,body:Buffer.from(bytes).toString("base64"),encoding:"base64",size:row.size,state:row.state,done:row.state!=="queued"&&row.state!=="running"&&value.offset+length>=row.size};
 }
}
export async function dispatchProxyOperation(env:Env,tenantId:string,operationId:string){
 const response=await env.SCHEDULER!.get(env.SCHEDULER!.idFromName(`proxy:${tenantId}:${operationId}`)).fetch("https://scheduler/operation",{method:"POST",body:JSON.stringify({tenantId,operationId})});if(!response.ok)throw new AgentApiError(503,"proxy_scheduling_failed","Request is retained; retry with the same idempotency key to reschedule safely.");
}
/** Alarm retries fail closed after uncertain dispatch; no upstream replay. */
export async function processProxyOperation(env:Env,tenantId:string,id:string){
 const db=databaseFor(env);
 const row=(await db.pool.query<Operation>("UPDATE app.proxy_operations SET state='running',started_at=now(),updated_at=now() WHERE tenant_id=$1 AND id=$2 AND state='queued' AND expires_at>now() RETURNING *",[tenantId,id])).rows[0];
 if(!row){await db.pool.query("UPDATE app.proxy_operations SET state='uncertain',effects_uncertain=true,error_code='interrupted',error_message='Execution was interrupted; the upstream effect is uncertain. This request will not be replayed.',updated_at=now() WHERE tenant_id=$1 AND id=$2 AND state='running' AND updated_at<now()-interval '30 seconds'",[tenantId,id]);return;}
 const controller=new AbortController(),deadline=AbortSignal.timeout(proxyLimits.timeoutMs),signal=AbortSignal.any([controller.signal,deadline]);
 let fault:string|undefined,checking=false,reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
 const auth=JSON.parse(await decrypt(row.encrypted_auth,signingConfig(env).credentialKey)) as OAuthProps;
 const api=new AgentApiService(env,auth);
 const check=async()=>{
  const current=(await db.pool.query("SELECT state,expires_at FROM app.proxy_operations WHERE tenant_id=$1 AND id=$2",[tenantId,id])).rows[0];
  if(current?.expires_at<=new Date())throw new AgentApiError(410,"operation_expired","Operation reached its 30 minute expiry.");
  if(current?.state!=="running")throw new AgentApiError(409,"canceled","Operation is no longer running.");
  const grant=await api.authorize(row.integration_id);if(grant.integration.epoch!==row.integration_epoch)throw new AgentApiError(403,"forbidden","Integration authorization changed.");
  await db.pool.query("UPDATE app.proxy_operations SET updated_at=now() WHERE tenant_id=$1 AND id=$2 AND state='running'",[tenantId,id]);
 };
 const heartbeat=setInterval(()=>{if(checking)return;checking=true;check().catch(error=>{fault=error instanceof AgentApiError?error.code:"authorization_failed";controller.abort();}).finally(()=>{checking=false;});},1000);
 let size=0,status:number|null=null;
 try{
  await check();const request=requestApiInput.parse(JSON.parse(await decrypt(row.encrypted_request,signingConfig(env).credentialKey)));
  const outbound=await proxyRequestBody(env,auth,request);
  const response=await api.forward(request.integration,request.path,new Request(appConfig(env).origin,{method:request.method,headers:outbound.headers,body:outbound.body,signal,duplex:"half"} as RequestInit));status=response.status;
  const headers:Record<string,string>={};response.headers.forEach((value,name)=>{headers[name]=value;});await db.pool.query("UPDATE app.proxy_operations SET status=$3,headers=$4 WHERE tenant_id=$1 AND id=$2 AND state='running'",[tenantId,id,status,headers]);
  reader=response.body?.getReader();const pending=new Uint8Array(blockBytes);let pendingSize=0,part=0;
  if(reader)for(;;){const next=await readNext(reader,signal);if(next.done)break;await check();if(size+next.value.length>proxyLimits.responseBytes)throw new AgentApiError(413,"response_too_large","Response exceeds the fixed 64 MiB limit; earlier bytes remain readable.");
   for(let offset=0;offset<next.value.length;){const count=Math.min(blockBytes-pendingSize,next.value.length-offset);pending.set(next.value.subarray(offset,offset+count),pendingSize);pendingSize+=count;offset+=count;
    await env.PROXY_ARTIFACTS!.put(`${keyFor(row)}/${part}`,pending.slice(0,pendingSize).buffer);size+=count;
    const saved=await db.pool.query("UPDATE app.proxy_operations SET size=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND state='running' RETURNING id",[tenantId,id,size]);if(!saved.rowCount)throw new AgentApiError(409,"canceled","Operation canceled.");
    if(pendingSize===blockBytes){part++;pendingSize=0;}
   }
  }
  await check();await db.transaction(async client=>{const completed=await client.query("UPDATE app.proxy_operations SET state='complete',updated_at=now() WHERE tenant_id=$1 AND id=$2 AND state='running' RETURNING id",[tenantId,id]);if(completed.rowCount)await client.query("UPDATE app.agent_proxy_responses SET size=$3 WHERE tenant_id=$1 AND id=$2",[tenantId,id,size]);});
 }catch(error){
  const code=fault??(deadline.aborted?"upstream_timeout":error instanceof AgentApiError?error.code:error instanceof Error && error.message==="Proxy stream limit exceeded"?"response_too_large":"upstream_disconnected");
  await db.pool.query("UPDATE app.proxy_operations SET state='failed',error_code=$3,error_message=$4,effects_uncertain=true,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND state='running'",[tenantId,id,code,code==="upstream_timeout"?"Upstream exceeded the fixed 15 minute limit; partial bytes may remain readable.":error instanceof AgentApiError?error.message:"Upstream request failed or disconnected; partial bytes may remain readable. An upstream write may already have taken effect."]);
 }finally{clearInterval(heartbeat);controller.abort();void reader?.cancel().catch(()=>{});}
}
export async function maintainProxyOperations(env:Env){
 const db=databaseFor(env);await cleanupProxyPayloads(env);if(!env.SCHEDULER)return;
 const rows=(await db.pool.query<{tenant_id:string;id:string}>("SELECT tenant_id,id FROM app.proxy_operations WHERE expires_at>now() AND (state='queued' OR state='running' AND updated_at<now()-interval '30 seconds') ORDER BY created_at LIMIT 50")).rows;
 for(const row of rows)await dispatchProxyOperation(env,row.tenant_id,row.id);
 await db.pool.query("DELETE FROM app.proxy_operations WHERE expires_at<now()");
}
