import {AgentApiError} from "./agent-api";
import {ExeVmBackend} from "./exe-vm-backend";
import type {ExeConnection} from "./exe";
import {ConnectionRepository} from "./postgres/connection-repository";
import {FlyConnectionRepository} from "./postgres/fly-connection-repository";
import {databaseFor} from "./postgres/database";
import {createFlyHttpGuestTransport} from "./fly-http-guest-transport";
import {acquireFlyMachineOidcToken} from "./vendor-run-token-sources";
import type {VendorRunBinding} from "./vendor-run-identity";
import type {Env} from "./types";

export type GrantTarget={id:string;tenant_id:string;provider_id:string;vm:string;app:string|null;issuer:string|null;subject:string|null};
export type GrantMachineBinding=Omit<VendorRunBinding,"runId"|"activeRunId">;
export const grantAudience=(id:string)=>"factorize://vm-grants/"+id;
const nameFor=(id:string)=>"fzvm-"+id.replaceAll("-","");
const proofFile=(id:string)=>`.factorize-vm-grants/${id}`;
const unavailable=()=>new AgentApiError(403,"forbidden","The VM grant provider or machine identity is unavailable.");

/** Provider-specific enrollment/inspection share the same machine OIDC verifier.
 * Control-plane credentials and guest identity tokens never enter the receipt. */
export async function vmGrantProvider(env:Env,row:GrantTarget){
 const db=databaseFor(env),integration=(await db.pool.query("SELECT kind,credential_id FROM app.agent_integrations WHERE tenant_id=$1 AND id=$2",[row.tenant_id,row.provider_id])).rows[0];
 const audience=grantAudience(row.id),file=proofFile(row.id);
 if(integration?.kind==="exe" && !row.app){
  const connection=await new ConnectionRepository(db,row.tenant_id,env.CREDENTIAL_ENCRYPTION_KEY).get<ExeConnection>("exe:"+integration.credential_id);
  if(!connection)throw unavailable();
  const exe=new ExeVmBackend(connection),name=nameFor(row.id);
  const inspect=async(create=false):Promise<GrantMachineBinding>=>{
   const attachment=await exe.identityIntegration(row.vm,name,audience,create);
   return {provider:"exe.dev",vmId:row.vm,issuer:attachment.issuer,subject:attachment.subject,audience,
    exeAttachment:{integrationName:name,attachedVmId:row.vm,mode:"vm"}};
  };
  return {
   inspect:()=>inspect(),
   async enroll(){
    const binding=await inspect().catch(()=>inspect(true));
    const guest=await exe.enrollGuest(row.vm,row.id,name);
    return {...guest,binding};
   },
   receipt:{provider:"exe.dev" as const,tokenUrl:`https://${name}.int.exe.xyz/token`,proofFile:file,audience,
    instructions:"From the guest, use tokenUrl's token as a bearer token. Send X-Factorize-VM-Grant: grantId and X-Factorize-VM-Proof: the trimmed contents of proofFile under the enrollment user's home directory."},
   cleanup:()=>exe.removeIdentityIntegration(row.vm,name,audience,row.issuer&&row.subject?{issuer:row.issuer,subject:row.subject}:undefined),
  };
 }
 if(integration?.kind==="fly" && row.app){
  const repo=new FlyConnectionRepository(db,row.tenant_id,env.CREDENTIAL_ENCRYPTION_KEY),connection=await repo.get(),token=await repo.token();
  if(!connection||!token)throw unavailable();
  const app=row.app,issuer=`https://oidc.fly.io/${connection.organizationSlug}`;
  if(row.issuer&&row.issuer!==issuer)throw unavailable();
  const read=async(path:string)=>{
   const response=await fetch(`https://api.machines.dev/v1/apps/${encodeURIComponent(app)}${path}`,{
    headers:{Authorization:`Bearer ${token}`,Accept:"application/json"},redirect:"manual",signal:AbortSignal.timeout(10000)});
   if(!response.ok)throw unavailable();
   return response.json() as Promise<any>;
  };
  const inspect=async():Promise<GrantMachineBinding>=>{
   const account=await read("");
   if(account.name!==app||account.organization?.slug!==connection.organizationSlug)throw unavailable();
   const machine=await read(`/machines/${encodeURIComponent(row.vm)}`);
   if(machine.id!==row.vm||typeof machine.name!=="string"||!machine.name||machine.state!=="started")throw unavailable();
   return {provider:"fly.io",vmId:row.vm,issuer,audience,subject:`${connection.organizationSlug}:${app}:${machine.name}`};
  };
  const guest=createFlyHttpGuestTransport({app,machine:row.vm,token});
  return {
   inspect,
   async enroll(){
    const binding=await inspect();
    // A separate private proof protects enrollment and grants on a recreated VM.
    // Only the hash is returned to Factorize, never the guest-local secret.
    const command=`set -eu; umask 077; cd "$HOME"; mkdir -p .factorize-vm-grants; if [ ! -f ${file} ]; then openssl rand -hex 32 > ${file}; fi; sha256sum ${file}`;
    const result=await guest.run(["/bin/sh","-c",command]),proofHash=result.stdout.trim().split(/\s+/)[0];
    if(!result.ok||!/^[a-f0-9]{64}$/.test(proofHash??""))throw unavailable();
    const identityToken=await acquireFlyMachineOidcToken({guest,audience});
    return {binding,proofHash,token:identityToken};
   },
   receipt:{provider:"fly.io" as const,app,tokenUrl:"http://localhost/v1/tokens/oidc",tokenSocket:"/.fly/api",audience,proofFile:file,
    instructions:'Inside the Machine, POST JSON {"aud": audience} to tokenUrl through the tokenSocket Unix socket (curl --unix-socket /.fly/api). Use the returned short-lived JWT as a bearer token. Send X-Factorize-VM-Grant: grantId and X-Factorize-VM-Proof: the trimmed contents of proofFile under the enrollment user\'s home directory. Acquire a fresh JWT before it expires; this does not extend the grant lease.'},
   // Fly's OIDC capability is platform-owned. Revocation is enforced in Factorize;
   // there is no per-grant provider attachment to remove. Never stop/delete the VM.
   async cleanup(){},
  };
 }
 throw unavailable();
}
