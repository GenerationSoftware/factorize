import type {Database} from "./postgres/database";
import type {PersistedRun} from "./postgres/run-repository";
import type {Env} from "./types";
import {encrypt,decrypt} from "./crypto";
import {ConnectionRepository} from "./postgres/connection-repository";
import {FlyConnectionRepository} from "./postgres/fly-connection-repository";
import {FlyExecutionConfigurationRepository} from "./postgres/fly-execution-configuration-repository";
import {exeWorkspace,flyWorkspace,workspaceProof,type WorkspaceProvider,type WorkspaceHandle} from "./workspace-providers";
import {shellAtom} from "./exe";
export class WorkspaceLeaseLost extends Error {constructor(){super("Workspace provisioning lease is no longer active.");}}
export type WorkspaceRow={tenant_id:string;run_id:string;provider:"exe"|"fly";connection_id:string;integration_id:string;integration_epoch:number;configuration:Record<string,any>;handle:WorkspaceHandle;encrypted_proof:string;status:string;lease_id:string|null;lease_expires_at:Date|null;verified_at:Date|null};
export type WorkspaceFactory=(row:WorkspaceRow,cleanup?:boolean)=>Promise<WorkspaceProvider>;
export const needsWorkspace=(run:Pick<PersistedRun,"executionConfig">)=>run.executionConfig.requiresVm ?? Boolean(run.executionConfig.connectionId);
/** A workspace is a server-bound remote environment. It never hosts Pi. Its
 * independent receipt survives cancellation and aggregate retention. */
export class WorkspaceVm {
 constructor(private db:Database,private env:Env,private factory?:WorkspaceFactory){}
 async row(tenant:string,run:string):Promise<WorkspaceRow|null>{return (await this.db.pool.query("SELECT * FROM app.run_workspaces WHERE tenant_id=$1 AND run_id=$2",[tenant,run])).rows[0]??null;}
 private async provider(row:WorkspaceRow,cleanup=false):Promise<WorkspaceProvider>{
  if(this.factory)return this.factory(row,cleanup);
  const integration=(await this.db.pool.query("SELECT * FROM app.agent_integrations WHERE tenant_id=$1 AND id=$2",[row.tenant_id,row.integration_id])).rows[0];
  if(!integration?.available || (!cleanup && (integration.epoch!==row.integration_epoch || integration.policy==="disabled")))throw new Error("The selected workspace integration is unavailable or revoked.");
  if(row.provider==="exe"){
   const config=await new ConnectionRepository(this.db,row.tenant_id,this.env.CREDENTIAL_ENCRYPTION_KEY).get<{apiToken:string}>(`exe:${row.connection_id}`);
   if(!config)throw new Error("The selected exe.dev workspace integration is unavailable.");
   return exeWorkspace({runId:row.run_id,backendOrigin:this.env.APP_ORIGIN,token:config.apiToken,image:row.configuration.image,tags:row.configuration.tags});
  }
  const repo=new FlyConnectionRepository(this.db,row.tenant_id,this.env.CREDENTIAL_ENCRYPTION_KEY),connection=await repo.get(),token=await repo.token();
  if(!connection || !token || connection.organizationSlug!==row.configuration.organization)throw new Error("The selected Fly workspace integration is unavailable or changed organization.");
  return flyWorkspace({runId:row.run_id,tenantId:row.tenant_id,token,organization:connection.organizationSlug,image:row.configuration.image,region:row.configuration.region,size:row.configuration.size});
 }
 async ensure(run:PersistedRun){
  if(!needsWorkspace(run))return;
  let row=await this.row(run.tenantId,run.id);
  if(!row){
   const provider=run.executionConfig.executionProvider==="fly"?"fly":"exe",id=String(run.executionConfig.connectionId??"");if(!id)throw new Error("A required workspace has no VM configuration.");
   const integration=(await this.db.pool.query("SELECT id,epoch FROM app.agent_integrations WHERE tenant_id=$1 AND kind=$2 AND credential_id=$3 AND available AND policy<>'disabled'",[run.tenantId,provider,provider==="fly"?"fly":id])).rows[0];
   if(!integration)throw new Error("The selected workspace integration is unavailable.");
   let configuration={...run.executionConfig};
   if(provider==="fly"){
    const saved=await new FlyExecutionConfigurationRepository(this.db,run.tenantId).get(id),connection=await new FlyConnectionRepository(this.db,run.tenantId,this.env.CREDENTIAL_ENCRYPTION_KEY).get();
    if(!saved || !connection)throw new Error("The selected Fly VM configuration is unavailable.");
    configuration={...saved,...configuration,organization:connection.organizationSlug};
   }
   const proof=await encrypt(crypto.randomUUID(),this.env.CREDENTIAL_ENCRYPTION_KEY);
   const handle=provider==="exe"?{id:`factorize-${run.id}`}:{id:run.id,app:`factorize-run-${run.tenantId.replaceAll("-","")}`};
   await this.db.pool.query(`INSERT INTO app.run_workspaces(tenant_id,run_id,provider,connection_id,integration_id,integration_epoch,configuration,handle,encrypted_proof)
    SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9 WHERE EXISTS(SELECT 1 FROM app.runs WHERE tenant_id=$1 AND id=$2 AND state IN ('starting','running','blocked')) ON CONFLICT DO NOTHING`,[run.tenantId,run.id,provider,id,integration.id,integration.epoch,configuration,handle,proof]);
   row=await this.row(run.tenantId,run.id);if(!row)throw new WorkspaceLeaseLost();
  }
  if(row.status==="ready"){await this.verify(row);return;}
  if(["cleaning","deleted"].includes(row.status))throw new Error("Workspace is being removed.");
  const lease=crypto.randomUUID();
  const claimed=await this.db.pool.query(`UPDATE app.run_workspaces SET lease_id=$3,lease_expires_at=now()+interval '4 minutes',status='provisioning',updated_at=now()
   WHERE tenant_id=$1 AND run_id=$2 AND (lease_id IS NULL OR lease_expires_at<now()) RETURNING *`,[run.tenantId,run.id,lease]);
  if(!claimed.rowCount)throw new WorkspaceLeaseLost();row=claimed.rows[0] as WorkspaceRow;
  try{
   const provider=await this.provider(row);
   await provider.provision(row.handle,async handle=>{const saved=await this.db.pool.query("UPDATE app.run_workspaces SET handle=$4,updated_at=now() WHERE tenant_id=$1 AND run_id=$2 AND lease_id=$3 AND lease_expires_at>now()",[run.tenantId,run.id,lease,handle]);if(!saved.rowCount)throw new WorkspaceLeaseLost();});
   const proof=await decrypt(row.encrypted_proof,this.env.CREDENTIAL_ENCRYPTION_KEY);
   let ready=false;
   for(let attempt=0;attempt<6;attempt++){
    if(attempt)await new Promise(resolve=>setTimeout(resolve,Math.min(1000*2**(attempt-1),8000)));
    try{const result=await provider.execute(row.handle,workspaceProof(run.id,proof,true));if(result.exitCode===0 && result.output.trim()==="FACTORIZE_WORKSPACE_READY"){ready=true;break;}}catch(error){if(attempt===5)throw error;}
   }
   if(!ready)throw new Error("Workspace VM started but readiness verification failed.");
   await provider.verify(row.handle);
   const completed=await this.db.pool.query(`UPDATE app.run_workspaces w SET status='ready',verified_at=now(),lease_id=NULL,lease_expires_at=NULL,last_error=NULL,updated_at=now()
    WHERE tenant_id=$1 AND run_id=$2 AND lease_id=$3 AND lease_expires_at>now() AND EXISTS(SELECT 1 FROM app.runs r WHERE r.tenant_id=w.tenant_id AND r.id=w.run_id AND r.state IN ('starting','running','blocked'))`,[run.tenantId,run.id,lease]);
   if(!completed.rowCount)throw new WorkspaceLeaseLost();
  }catch(error){await this.db.pool.query("UPDATE app.run_workspaces SET status='failed',handle=$4,last_error=$5,lease_id=NULL,lease_expires_at=NULL,updated_at=now() WHERE tenant_id=$1 AND run_id=$2 AND lease_id=$3",[run.tenantId,run.id,lease,row.handle,error instanceof Error?error.message:"Workspace provisioning failed"]);throw error;}
 }
 private async verify(row:WorkspaceRow){
  if(row.status!=="ready")throw new Error("The bound workspace is not ready.");
  const provider=await this.provider(row);await provider.verify(row.handle);
  const result=await provider.execute(row.handle,workspaceProof(row.run_id,await decrypt(row.encrypted_proof,this.env.CREDENTIAL_ENCRYPTION_KEY)));
  if(result.exitCode!==0 || result.output.trim()!=="FACTORIZE_WORKSPACE_READY")throw new Error("Workspace identity proof does not match this run.");
  await this.db.pool.query("UPDATE app.run_workspaces SET verified_at=now() WHERE tenant_id=$1 AND run_id=$2 AND status='ready'",[row.tenant_id,row.run_id]);
 }
 async beforeTurn(run:PersistedRun){if(!needsWorkspace(run))return;const row=await this.row(run.tenantId,run.id);if(!row)throw new Error("Required workspace is missing.");await this.verify(row);}
 async current(tenant:string,runId:string){const row=await this.row(tenant,runId);if(!row || row.status!=="ready")return null;await this.verify(row);return {provider:row.provider==="exe"?"exe.dev":"fly.io",id:row.handle.machine??row.handle.id,runId,status:"ready" as const,cwd:"/home/exedev/workspace",verifiedAt:new Date().toISOString(),tool:"vm_exec"};}
 async execute(tenant:string,runId:string,command:string,cwd="/home/exedev/workspace",signal?:AbortSignal,beforeExecute?:()=>Promise<void>){
  const row=await this.row(tenant,runId);if(!row)throw new Error("This run has no current workspace VM.");await this.verify(row);
  const active=await this.db.pool.query("SELECT 1 FROM app.runs WHERE tenant_id=$1 AND id=$2 AND state IN ('starting','running','blocked')",[tenant,runId]);if(!active.rowCount)throw new WorkspaceLeaseLost();
  const provider=await this.provider(row);await beforeExecute?.();if(signal?.aborted)throw signal.reason;
  return provider.execute(row.handle,`cd ${shellAtom(cwd)} && /bin/sh -c ${shellAtom(command)}`,signal);
 }
 async cleanup(tenant:string,runId:string){
  const row=await this.row(tenant,runId);if(!row || row.status==="deleted")return;
  const lease=crypto.randomUUID();const claimed=await this.db.pool.query("UPDATE app.run_workspaces SET status='cleaning',lease_id=$3,lease_expires_at=now()+interval '4 minutes' WHERE tenant_id=$1 AND run_id=$2 AND (lease_id IS NULL OR lease_expires_at<now()) RETURNING *",[tenant,runId,lease]);
  if(!claimed.rowCount)throw new Error("Workspace provisioning or cleanup is still active.");
  try{await (await this.provider(row,true)).remove(row.handle);const done=await this.db.pool.query("UPDATE app.run_workspaces SET status='deleted',lease_id=NULL,lease_expires_at=NULL,updated_at=now() WHERE tenant_id=$1 AND run_id=$2 AND lease_id=$3 AND lease_expires_at>now()",[tenant,runId,lease]);if(!done.rowCount)throw new WorkspaceLeaseLost();}
  catch(error){await this.db.pool.query("UPDATE app.run_workspaces SET lease_id=NULL,lease_expires_at=NULL,last_error=$4 WHERE tenant_id=$1 AND run_id=$2 AND lease_id=$3",[tenant,runId,lease,error instanceof Error?error.message:"Workspace cleanup failed"]);throw error;}
 }
}
