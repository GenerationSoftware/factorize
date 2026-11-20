import type { DatabaseClient } from "./postgres/database";
import { PresetError } from "./postgres/preset-repository";
import { readSkillDefinition, type SkillDefinition } from "./skill-definition";
import type { teamRunDefaults } from "./flow-schemas";
import type { z } from "zod";
export type ResolvedDefaults=z.infer<typeof teamRunDefaults>;
export type PresetSnapshot={skillCommit:string|null;presets:Record<string,{id:string;slug:string;revision:number;inherited:boolean;settings:Record<string,unknown>}>};
/** Resolve once for admission. The returned settings contain references, never secrets. */
export async function resolveSkillPresets(client:DatabaseClient,tenant:string,definition?:SkillDefinition,commit?:string){
 const rows=(await client.query("SELECT * FROM app.presets WHERE tenant_id=$1 AND NOT deleted",[tenant])).rows;
 const defaults:ResolvedDefaults={};
 const snapshot:PresetSnapshot={skillCommit:commit??null,presets:{}};
 for(const kind of ["vm","permission","model"] as const){
  const slug=definition?.factorize[`${kind}-preset`];
  const preset=rows.find(row=>row.kind===kind&&(slug?row.slug===slug:row.is_default));
  if(!preset)throw new PresetError(409,"preset_unavailable",slug?`The ${kind} preset '${slug}' is unavailable.`:`Select a team default ${kind} preset.`);
  const settings=preset.settings;
  snapshot.presets[kind]={id:preset.id,slug:preset.slug,revision:preset.revision,inherited:!slug,settings:structuredClone(settings)};
  if(kind==="vm")Object.assign(defaults,settings.provider==="none"?{requiresVm:false}:{requiresVm:true,executionConfigId:settings.executionConfigId??settings.connectionId,vmImage:settings.image,tags:settings.tags??[]});
  else Object.assign(defaults,settings);
 }
 return {defaults,snapshot,definition};
}
export function presetExecution(resolved:Awaited<ReturnType<typeof resolveSkillPresets>>){
 const d=resolved.defaults,vm=resolved.snapshot.presets.vm.settings;
 return {agentKind:"pi",executionType:"agent",requiresVm:d.requiresVm??false,connectionId:d.executionConfigId??"",targetId:d.executionConfigId,
  workspace:vm.provider==="exe"?"ephemeral":"",cwd:vm.provider==="exe"?"/home/exedev/workspace":"",executionProvider:vm.provider==="none"?undefined:vm.provider,
  image:d.vmImage,region:vm.region,size:vm.size,tags:d.tags??[],model:d.model??"",effort:d.effort??"",modelAccountId:d.modelAccountId,modelAccess:"portable",
  portableIntegrationIds:d.portableIntegrationIds??[],githubInstallationIds:d.githubInstallationIds??[],linearConnectionId:d.linearConnectionId??undefined,xConnectionIds:d.xConnectionIds??[],runScopes:d.runScopes??[],allowedTriggerIds:d.allowedTriggerIds??[],
  presetSnapshot:resolved.snapshot,skillConcurrencyLimit:resolved.definition?.factorize.concurrency??0,skillDisabled:resolved.definition?.factorize.disabled??false};
}
export async function assertPresetSnapshot(client:DatabaseClient,tenant:string,snapshot:PresetSnapshot){
 for(const [kind,preset] of Object.entries(snapshot.presets)){
  const row=(await client.query("SELECT revision,is_default,deleted FROM app.presets WHERE tenant_id=$1 AND id=$2 FOR SHARE",[tenant,preset.id])).rows[0];
  if(!row||row.deleted||row.revision!==preset.revision||(preset.inherited&&!row.is_default))throw new PresetError(409,"configuration_changed",`${kind} preset changed. Retry this request.`);
 }
}
