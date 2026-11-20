import type {AgentTool,AgentToolResult} from "@earendil-works/pi-agent-core";
import {PiSessionRepository,PiLeaseLost,type PiLease} from "./postgres/pi-session-repository";
import type {Database} from "./postgres/database";
import {encrypt,decrypt} from "./crypto";
export class PiToolRetry extends Error {constructor(public callId:string,public toolName:string){super(`Retrying interrupted ${toolName} (${callId}) with its original durable idempotency key.`);}}
export class PiToolUncertain extends Error {constructor(public callId:string,public toolName:string){super(`Tool ${toolName} (${callId}) may have executed before interruption. Its effect is uncertain; this run is blocked and will not repeat it automatically.`);}}
const sortedJson=(value:any):any=>value&&typeof value==="object"?Array.isArray(value)?value.map(sortedJson):Object.fromEntries(Object.keys(value).filter(key=>value[key]!==undefined).sort().map(key=>[key,sortedJson(value[key])])):value;
export const canonicalToolArguments=(value:any):string=>JSON.stringify(sortedJson(value));
const idempotentTools=new Set(["start_run","invoke_trigger"]);
export function toolCanRetry(name:string,args:any){return idempotentTools.has(name) || new Set(["get_api_reflection","get_runtime_context","get_runtime_integrations","get_run","get_run_diagnostics","get_skill","list_skills","list_runs","list_triggers","preview_trigger_prompt","read_api_response","read_media","fetch_media","mcp_read_resource","mcp_list_skills","mcp_get_skill"]).has(name) || name==="request_api"&&["GET","HEAD","OPTIONS"].includes(args.method);}
/** The result commits before it is returned to Pi. Replay and execution use the
 * same framework tool validation and the same scoped MCP boundary. */
export class PiToolJournal {
 private sessions:PiSessionRepository;
 constructor(private db:Database,private key:string,private lease:PiLease,private transformResult:(result:AgentToolResult<any>)=>Promise<AgentToolResult<any>>=async value=>value){this.sessions=new PiSessionRepository(db,key);}
 uncertain:PiToolUncertain|undefined;
 retryNeeded:PiToolRetry|undefined;
 wrap(tools:AgentTool<any>[]):AgentTool<any>[] {return tools.map(tool=>({...tool,execute:async(id,args,signal,onUpdate)=>{
  if(this.uncertain)throw this.uncertain;if(this.retryNeeded)throw this.retryNeeded;
  const canonical=canonicalToolArguments(args),retry=toolCanRetry(tool.name,args);
  let previous:AgentToolResult<any>|undefined;
  const state=await this.db.transaction(async client=>{
   await this.sessions.fence(this.lease,client);
   const row=(await client.query("SELECT * FROM app.pi_tool_calls WHERE tenant_id=$1 AND run_id=$2 AND call_id=$3 FOR UPDATE",[this.lease.tenantId,this.lease.runId,id])).rows[0];
   if(row){
    if(row.tool_name!==tool.name || await decrypt(row.encrypted_arguments,this.key)!==canonical)throw new Error("A durable tool-call ID was reused with different arguments.");
    if(row.state==="complete"){previous=JSON.parse(await decrypt(row.encrypted_result,this.key));return "complete";}
    if(row.state==="uncertain" || !retry){await client.query("UPDATE app.pi_tool_calls SET state='uncertain',updated_at=now() WHERE tenant_id=$1 AND run_id=$2 AND call_id=$3",[this.lease.tenantId,this.lease.runId,id]);return "uncertain";}
    await client.query("UPDATE app.pi_tool_calls SET epoch=$4,updated_at=now() WHERE tenant_id=$1 AND run_id=$2 AND call_id=$3",[this.lease.tenantId,this.lease.runId,id,this.lease.epoch]);return "execute";
   }
   await client.query("INSERT INTO app.pi_tool_calls(tenant_id,run_id,call_id,tool_name,encrypted_arguments,state,epoch) VALUES($1,$2,$3,$4,$5,'started',$6)",[this.lease.tenantId,this.lease.runId,id,tool.name,await encrypt(canonical,this.key),this.lease.epoch]);return "execute";
  });
  if(state==="complete")return previous!;
  if(state==="uncertain"){this.uncertain=new PiToolUncertain(id,tool.name);throw this.uncertain;}
  const parameters=idempotentTools.has(tool.name)?{...args,idempotencyKey:"pi:"+Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(this.lease.runId+":"+id)))).map(byte=>byte.toString(16).padStart(2,"0")).join("")}:args;
  try{
   const result=await this.transformResult(await tool.execute(id,parameters,signal,onUpdate));
   // A proxy infrastructure failure may follow an upstream write. Do not let
   // an agent interpret that as a safe invitation to duplicate the operation.
   if(!retry && result.isError && JSON.stringify(result).includes("proxy_failed"))throw new Error("Upstream effect could not be confirmed.");
   const encrypted=await encrypt(JSON.stringify(result),this.key);
   await this.db.transaction(async client=>{await this.sessions.fence(this.lease,client);const saved=await client.query("UPDATE app.pi_tool_calls SET state='complete',encrypted_result=$4,updated_at=now() WHERE tenant_id=$1 AND run_id=$2 AND call_id=$3 AND state='started' AND epoch=$5",[this.lease.tenantId,this.lease.runId,id,encrypted,this.lease.epoch]);if(!saved.rowCount)throw new PiLeaseLost();});
   return result;
  }catch(error){
   if(error instanceof PiLeaseLost)throw error;
   if(!retry){this.uncertain=new PiToolUncertain(id,tool.name);await this.db.transaction(async client=>{await this.sessions.fence(this.lease,client);await client.query("UPDATE app.pi_tool_calls SET state='uncertain',updated_at=now() WHERE tenant_id=$1 AND run_id=$2 AND call_id=$3 AND epoch=$4",[this.lease.tenantId,this.lease.runId,id,this.lease.epoch]);});throw this.uncertain;}
   if(idempotentTools.has(tool.name)){this.retryNeeded=new PiToolRetry(id,tool.name);throw this.retryNeeded;}
   throw error;
  }
 }}));}
}
