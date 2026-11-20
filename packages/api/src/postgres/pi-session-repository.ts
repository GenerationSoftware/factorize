import type {AgentMessage} from "@earendil-works/pi-agent-core";
import type {Database,DatabaseClient} from "./database";
import {encrypt,decrypt} from "../crypto";

export class PiLeaseLost extends Error {constructor(){super("Hosted Pi execution lease is no longer active.");}}
export type PiLease={tenantId:string;runId:string;id:string;epoch:number;messages:AgentMessage[];turnCount:number;compactionCount:number};
export type PiSession={tenant_id:string;run_id:string;framework_version:string;status:"ready"|"running"|"complete"|"failed"|"stopped"|"uncertain";epoch:number;sequence:number;turn_count:number;compaction_count:number;messages:AgentMessage[];lease_id:string|null;lease_expires_at:Date|null;created_at:Date;updated_at:Date};
/** Every durable execution write is fenced by both the lease and the authoritative run state. */
export class PiSessionRepository {
 constructor(private db:Database,private key:string){}
 async create(tenantId:string,runId:string,messages:AgentMessage[]) {
  await this.db.pool.query("INSERT INTO app.pi_sessions(tenant_id,run_id,encrypted_messages) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",[tenantId,runId,await encrypt(JSON.stringify(messages),this.key)]);
 }
 async claim(tenantId:string,runId:string):Promise<PiLease|null> {
  const id=crypto.randomUUID();
  const row=(await this.db.pool.query(`UPDATE app.pi_sessions s SET lease_id=$3,epoch=epoch+1,lease_expires_at=now()+interval '90 seconds',status='running',updated_at=now()
    WHERE tenant_id=$1 AND run_id=$2 AND status IN ('ready','running') AND (lease_id IS NULL OR lease_expires_at<now())
    AND EXISTS(SELECT 1 FROM app.runs r WHERE r.tenant_id=s.tenant_id AND r.id=s.run_id AND r.state IN ('starting','running'))
    RETURNING epoch,encrypted_messages,turn_count,compaction_count`,[tenantId,runId,id])).rows[0];
  return row?{tenantId,runId,id,epoch:Number(row.epoch),messages:JSON.parse(await decrypt(row.encrypted_messages,this.key)),turnCount:row.turn_count,compactionCount:row.compaction_count}:null;
 }
 async fence(lease:PiLease,client:DatabaseClient=this.db.pool) {
  const result=await client.query(`UPDATE app.pi_sessions s SET lease_expires_at=now()+interval '90 seconds',updated_at=now()
    WHERE tenant_id=$1 AND run_id=$2 AND lease_id=$3 AND epoch=$4 AND status='running'
    AND EXISTS(SELECT 1 FROM app.runs r WHERE r.tenant_id=s.tenant_id AND r.id=s.run_id AND r.state IN ('starting','running')) RETURNING run_id`,[lease.tenantId,lease.runId,lease.id,lease.epoch]);
  if(!result.rowCount)throw new PiLeaseLost();
 }
 async checkpoint(lease:PiLease,messages:AgentMessage[],compacted=false) {
  const encrypted=await encrypt(JSON.stringify(messages),this.key);
  await this.db.transaction(async client=>{
   await this.fence(lease,client);
   await client.query("UPDATE app.pi_sessions SET encrypted_messages=$3,compaction_count=compaction_count+$4 WHERE tenant_id=$1 AND run_id=$2",[lease.tenantId,lease.runId,encrypted,compacted?1:0]);
  });
 }
 async event(lease:PiLease,type:string,value:unknown) {
  const encrypted=await encrypt(JSON.stringify(value),this.key);
  return this.db.transaction(async client=>{
   await this.fence(lease,client);
   const row=(await client.query("UPDATE app.pi_sessions SET sequence=sequence+1 WHERE tenant_id=$1 AND run_id=$2 RETURNING sequence",[lease.tenantId,lease.runId])).rows[0];
   await client.query("INSERT INTO app.pi_session_events(tenant_id,run_id,sequence,event_type,encrypted_event) VALUES($1,$2,$3,$4,$5)",[lease.tenantId,lease.runId,row.sequence,type,encrypted]);
   return Number(row.sequence);
  });
 }
 async project(lease:PiLease,sequence:number,type:string,title:string,preview:string,display:Record<string,unknown>={}) {
  await this.db.transaction(async client=>{
   await this.fence(lease,client);
   await client.query(`INSERT INTO app.run_trace_events(tenant_id,run_id,sequence,id,event_type,title,preview_text,display_data,occurred_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()) ON CONFLICT(tenant_id,run_id,sequence) DO UPDATE SET preview_text=excluded.preview_text,display_data=excluded.display_data`,
     [lease.tenantId,lease.runId,sequence,"hosted-pi:"+sequence,type,title,preview.slice(0,32768),display]);
  });
 }
 async release(lease:PiLease,status:"ready"|"complete"|"failed"|"uncertain"="ready") {
  await this.db.transaction(async client=>{
   await this.fence(lease,client);
   await client.query("UPDATE app.pi_sessions SET lease_id=NULL,lease_expires_at=NULL,status=$3,turn_count=turn_count+1 WHERE tenant_id=$1 AND run_id=$2",[lease.tenantId,lease.runId,status]);
  });
 }
 async cancel(tenantId:string,runId:string) {
  await this.db.pool.query("UPDATE app.pi_sessions SET status='stopped',epoch=epoch+1,lease_id=NULL,lease_expires_at=NULL,updated_at=now() WHERE tenant_id=$1 AND run_id=$2 AND status NOT IN ('complete','failed','stopped')",[tenantId,runId]);
 }
 async read(tenantId:string,runId:string):Promise<PiSession|null> {
  const row=(await this.db.pool.query("SELECT * FROM app.pi_sessions WHERE tenant_id=$1 AND run_id=$2",[tenantId,runId])).rows[0];
  return row?{...row,epoch:Number(row.epoch),sequence:Number(row.sequence),messages:JSON.parse(await decrypt(row.encrypted_messages,this.key)) as AgentMessage[]}:null;
 }
}
