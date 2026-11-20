import {z} from "zod";
import {databaseFor,type Database} from "./postgres/database";
import type {Env,OAuthProps} from "./types";
import type {PiLease} from "./postgres/pi-session-repository";
import {normalizeScopes} from "./access-tokens";

const claims=z.object({tenantId:z.uuid(),runId:z.uuid(),leaseId:z.uuid(),epoch:z.number().int().positive(),expiresAt:z.number().int()}).strict();
const encoder=new TextEncoder();
const b64=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replaceAll("+","-").replaceAll("/","_").replaceAll("=","");
const unb64=(value:string)=>Uint8Array.from(atob(value.replaceAll("-","+").replaceAll("_","/")+"===".slice((value.length+3)%4)),c=>c.charCodeAt(0));
async function key(secret:string,usage:KeyUsage){return crypto.subtle.importKey("raw",encoder.encode("factorize-hosted-pi-v1:"+secret),{name:"HMAC",hash:"SHA-256"},false,[usage]);}
/** Tokens never reach the model. Each MCP request gets a short-lived lease-bound credential. */
export async function issueHostedRunCredential(lease:PiLease,secret:string) {
 const body=b64(encoder.encode(JSON.stringify({tenantId:lease.tenantId,runId:lease.runId,leaseId:lease.id,epoch:lease.epoch,expiresAt:Math.floor(Date.now()/1000)+60})));
 const signature=await crypto.subtle.sign("HMAC",await key(secret,"sign"),encoder.encode(body));
 return `fpi_${body}.${b64(new Uint8Array(signature))}`;
}
export async function activeHostedRunIdentity(database:Database,auth:Pick<OAuthProps,"tenantId"|"runId"|"piLeaseId"|"piLeaseEpoch">):Promise<OAuthProps|null> {
 if(!auth.runId||!auth.piLeaseId||!auth.piLeaseEpoch)return null;
 const row=(await database.pool.query(`SELECT a.user_id,a.session_version,a.scopes,r.trigger_id FROM app.pi_sessions s
   JOIN app.runs r ON r.tenant_id=s.tenant_id AND r.id=s.run_id
   JOIN app.trigger_runs j ON j.tenant_id=s.tenant_id AND j.id=s.run_id
   JOIN app.run_authorizations a ON a.tenant_id=s.tenant_id AND a.run_id=s.run_id
   JOIN app.members m ON m.tenant_id=a.tenant_id AND m.user_id=a.user_id AND m.role='owner' AND m.session_version=a.session_version
   WHERE s.tenant_id=$1 AND s.run_id=$2 AND s.lease_id=$3 AND s.epoch=$4 AND s.status='running' AND s.lease_expires_at>now()
   AND r.execution_backend_kind='hosted-pi' AND r.state IN ('starting','running') AND j.state IN ('starting','running')`,[auth.tenantId,auth.runId,auth.piLeaseId,auth.piLeaseEpoch])).rows[0];
 return row?{tenantId:auth.tenantId,userId:row.user_id,sessionVersion:row.session_version,scopes:normalizeScopes(row.scopes),authMethod:"hosted_pi",runId:auth.runId,runTriggerId:row.trigger_id ?? undefined,piLeaseId:auth.piLeaseId,piLeaseEpoch:auth.piLeaseEpoch}:null;
}
export async function authenticateHostedRunRequest(request:Request,env:Env):Promise<OAuthProps|null>{
 const token=request.headers.get("Authorization")?.match(/^Bearer (fpi_[A-Za-z0-9_.-]+)$/)?.[1];
 if(!token||token.length>4096)return null;
 try{
  const parts=token.slice(4).split(".");if(parts.length!==2)return null;
  if(!await crypto.subtle.verify("HMAC",await key(env.SESSION_SIGNING_SECRET,"verify"),unb64(parts[1]),encoder.encode(parts[0])))return null;
  const value=claims.parse(JSON.parse(new TextDecoder().decode(unb64(parts[0]))));
  const now=Math.floor(Date.now()/1000);if(value.expiresAt<=now||value.expiresAt>now+65)return null;
  return activeHostedRunIdentity(databaseFor(env),{tenantId:value.tenantId,runId:value.runId,piLeaseId:value.leaseId,piLeaseEpoch:value.epoch});
 }catch{return null;}
}
