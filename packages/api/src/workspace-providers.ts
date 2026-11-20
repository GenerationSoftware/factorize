import {assertExeVmIsolation} from "./exe-vm-isolation";
import {Buffer} from "node:buffer";
import {shellAtom} from "./exe";
import {vmNameFor,inventoryHasOwnedVm} from "./exe-vm-backend";
import {createFlyMachinesClient} from "./fly-machines-client";
import {flyTriggerMachineConfig} from "./fly-job-machine";
import {createFlyHttpGuestTransport} from "./fly-http-guest-transport";

export type WorkspaceHandle={id:string;app?:string;machine?:string};
export type WorkspaceCommand={output:string;exitCode:number};
export interface WorkspaceProvider {
 reserve():WorkspaceHandle;
 provision(handle:WorkspaceHandle,save:(handle:WorkspaceHandle)=>Promise<void>):Promise<void>;
 verify(handle:WorkspaceHandle):Promise<void>;
 execute(handle:WorkspaceHandle,command:string,signal?:AbortSignal):Promise<WorkspaceCommand>;
 remove(handle:WorkspaceHandle):Promise<void>;
}
export function workspaceProof(runId:string,proof:string,create=false) {
 const file=`/home/exedev/.factorize-workspaces/${runId}`;
 return `set -eu; ${create?`umask 077; mkdir -p /home/exedev/.factorize-workspaces /home/exedev/workspace; if [ ! -e ${shellAtom(file)} ]; then printf %s ${shellAtom(proof)} > ${shellAtom(file)}; fi; `:""}test "$(cat ${shellAtom(file)})" = ${shellAtom(proof)}; printf FACTORIZE_WORKSPACE_READY`;
}
export function exeWorkspace(input:{runId:string;token:string;backendOrigin:string;image?:string;tags?:string[];fetcher?:typeof fetch}):WorkspaceProvider {
 const fetcher=input.fetcher??fetch;
 async function api(command:string,signal?:AbortSignal) {
  const response=await fetcher("https://exe.dev/exec",{method:"POST",headers:{Authorization:`Bearer ${input.token}`,"Content-Type":"text/plain"},body:command,signal:signal??AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error(`exe.dev workspace control failed (${response.status}).`);
  const body=await response.text();const exit=response.headers.get("X-Exe-Exit");
  if(exit && exit!=="0")throw new Error("exe.dev workspace control failed.");
  return body;
 }
 async function isolated(handle:WorkspaceHandle){await assertExeVmIsolation({vm:handle.id,backendOrigin:new URL(input.backendOrigin).origin,tags:input.tags??[],execute:async command=>({body:await api(command),ok:true,status:200,exitCode:0,requestBody:command})});}
 async function owned(handle:WorkspaceHandle) {
  if(handle.id!==vmNameFor(input.runId))throw new Error("Workspace/run identity mismatch.");
  const body=await api("ls --json");
  const inventory=JSON.parse(body);if(!Array.isArray(inventory) && !Array.isArray(inventory?.vms))throw new Error("exe.dev inventory could not confirm workspace ownership or absence.");
  const entries=Array.isArray(inventory)?inventory:inventory.vms;if(entries.some((entry:any)=>!entry || typeof(entry.name??entry.vm_name)!=="string"))throw new Error("exe.dev inventory contains invalid VM identities.");
  const result=inventoryHasOwnedVm(body,handle.id);if(result===null)throw new Error("Invalid exe.dev inventory.");
  const contains=(value:any):boolean=>Array.isArray(value)?value.some(contains):Boolean(value&&typeof value==="object"&&((value.name===handle.id||value.vm_name===handle.id)||Object.values(value).some(contains)));
  if(!result && contains(JSON.parse(body)))throw new Error("VM ownership mismatch.");
  return result;
 }
 return {
  reserve:()=>({id:vmNameFor(input.runId)}),
  async provision(handle) {
   await isolated(handle);
   if(!await owned(handle))await api(`new --name=${shellAtom(handle.id)} --no-email --comment=${shellAtom(`Factorize VM ${handle.id}`)}${input.image?` --image=${shellAtom(input.image)}`:""}${(input.tags??[]).map(tag=>` --tag=${shellAtom(tag)}`).join("")}`);
   if(!await owned(handle))throw new Error("exe.dev did not confirm the workspace VM.");
  },
  async verify(handle){if(!await owned(handle))throw new Error("The bound workspace VM is unavailable.");await isolated(handle);},
  async execute(handle,command,signal) {
   if(handle.id!==vmNameFor(input.runId))throw new Error("Workspace/run identity mismatch.");
   const response=await fetcher("https://exe.dev/exec",{method:"POST",headers:{Authorization:`Bearer ${input.token}`,"Content-Type":"text/plain",Accept:"application/x-ndjson"},body:`ssh ${shellAtom(handle.id)} ${shellAtom(command)}`,signal:signal??AbortSignal.timeout(30000)});
   if(!response.ok)throw new Error(`exe.dev workspace command failed (${response.status}).`);
   const reader=response.body?.getReader();if(!reader)throw new Error("Missing workspace response.");
   let bytes=0,text="";const decoder=new TextDecoder();
   for(;;){const next=await reader.read();if(next.done)break;bytes+=next.value.length;if(bytes>2*1024*1024){await reader.cancel();throw new Error("Workspace output exceeded its limit; command outcome may be uncertain.");}text+=decoder.decode(next.value,{stream:true});}text+=decoder.decode();
   const output:Buffer[]=[];let exitCode:number|undefined;
   for(const line of text.trim().split("\n")) {const block=JSON.parse(line);if(exitCode!==undefined)throw new Error("Workspace output followed its terminal exit status; outcome is uncertain.");if(block.error)throw new Error("Workspace command outcome is uncertain.");if(block.stdout)output.push(Buffer.from(block.stdout,"base64"));if(block.stderr)output.push(Buffer.from(block.stderr,"base64"));if(Number.isInteger(block.exit_code)&&block.exit_code>=0&&block.exit_code<=255)exitCode=block.exit_code;}
   if(exitCode===undefined)throw new Error("Workspace command ended without an exit status; outcome is uncertain.");
   return {output:Buffer.concat(output).toString("utf8"),exitCode};
  },
  async remove(handle){if(await owned(handle))await api(`rm ${shellAtom(handle.id)}`);if(await owned(handle))throw new Error("exe.dev workspace deletion is pending.");},
 };
}
export function flyWorkspace(input:{runId:string;tenantId:string;token:string;organization:string;image:string;region:string;size:string;fetcher?:typeof fetch}):WorkspaceProvider {
 const app=`factorize-run-${input.tenantId.replaceAll("-","")}`,machines=createFlyMachinesClient({token:input.token,fetch:input.fetcher});
 async function inspect(handle:WorkspaceHandle) {
  if(handle.app!==app || handle.id!==input.runId)throw new Error("Workspace/run identity mismatch.");
  if(!handle.machine)return null;
  const machine=await machines.inspectMachine(app,handle.machine);if(machine.state==="destroyed")return null;
  if(machine.config?.metadata?.factorize_run_id!==input.runId || machine.config?.metadata?.factorize_operation_id!==input.runId)throw new Error("Fly workspace ownership mismatch.");
  return machine;
 }
 return {
  reserve:()=>({id:input.runId,app}),
  async provision(handle,save) {
   await machines.ensureRunApp(app,input.organization);
   const machine=await machines.createMachine(app,flyTriggerMachineConfig(app,{runId:input.runId,operationId:input.runId,image:input.image,region:input.region,size:input.size}),input.runId);
   handle.machine=machine.id;await save(handle);await machines.startMachine(app,machine.id);
   if(!await inspect(handle))throw new Error("Fly workspace is unavailable.");
  },
  async verify(handle){const machine=await inspect(handle);if(machine?.state!=="started")throw new Error("The bound Fly workspace is unavailable.");},
  async execute(handle,command,signal){if(!handle.machine)throw new Error("Fly workspace has no machine.");const fetcher:typeof fetch=(url,init)=> (input.fetcher??fetch)(url,{...init,signal:signal?AbortSignal.any([signal,init?.signal??AbortSignal.timeout(30000)]):init?.signal});const result=await createFlyHttpGuestTransport({app,machine:handle.machine,token:input.token,fetcher}).run(["runuser","-u","exedev","--","/bin/sh","-c",command]);return {output:result.stdout+result.stderr,exitCode:result.exitCode??(result.ok?0:1)};},
  async remove(handle){
   // Reconcile an ambiguous create using its durable operation ID before deletion.
   if(!handle.machine){const machine=await machines.findByOperationId(app,input.runId);if(!machine)return;handle.machine=machine.id;}
   const machine=await inspect(handle);if(!machine)return;
   if(machine.state!=="stopped")await machines.stopMachine(app,handle.machine!);
   await machines.destroyMachine(app,handle.machine!);if(await inspect(handle))throw new Error("Fly workspace deletion is pending.");
  },
 };
}
