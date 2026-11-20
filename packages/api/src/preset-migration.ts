import { databaseFor, type DatabaseClient } from "./postgres/database";
import { SkillLibrary } from "./skill-library";
import { SkillContent } from "./skill-content";
import { decrypt, encrypt } from "./crypto";
import { readSkillDefinition, writeSkillDefinition,skillDefinitionIndex } from "./skill-definition";
import { markdown, type SkillVersion } from "./skill-files";
import type { Env } from "./types";

/** Restart-safe: preset creation is committed first; the file and its migration
 * marker commit together. Git writes use the library's existing recovery gate. */
export async function migratePresetSkills(env:Env,tenant:string){
 const db=databaseFor(env);
 const state=(await db.pool.query(`SELECT
  EXISTS(SELECT 1 FROM app.skills WHERE tenant_id=$1 AND (definition IS NULL OR preset_migration_pending)) pending,
  (SELECT count(*)::int FROM app.presets WHERE tenant_id=$1 AND is_default) defaults,
  EXISTS(SELECT 1 FROM app.vm_presets v WHERE v.tenant_id=$1 AND NOT EXISTS(SELECT 1 FROM app.presets p WHERE p.tenant_id=v.tenant_id AND p.id=v.id)) old_presets,
  EXISTS(SELECT 1 FROM app.triggers WHERE tenant_id=$1 AND enabled AND execution_config->>'executionType'='code') scripts`,[tenant])).rows[0];
 if(!state.pending&&state.defaults===3&&!state.old_presets&&!state.scripts)return;
 const plans=await db.transaction(async client=>{
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,1))",[tenant]);
  await client.query("UPDATE app.triggers SET enabled=false WHERE tenant_id=$1 AND execution_config->>'executionType'='code' AND enabled",[tenant]);
  const team=(await client.query("SELECT run_defaults FROM app.team_settings WHERE tenant_id=$1",[tenant])).rows[0]?.run_defaults??{};
  async function selection(raw:Record<string,any>,teamDefault=false){
   const references:Record<string,string>={};
   for(const kind of ["vm","permission","model"] as const){
    let settings:Record<string,any>={};
    if(kind==="vm"){
     if(raw.requiresVm===false||(!raw.requiresVm&&!raw.executionConfigId))settings={provider:"none"};
     else {
      const config=raw.executionConfigId?(await client.query("SELECT * FROM app.fly_execution_configurations WHERE tenant_id=$1 AND id::text=$2",[tenant,raw.executionConfigId])).rows[0]:null;
      settings=config?{provider:"fly",image:raw.vmImage||config.image,region:config.region,size:config.size,executionConfigId:config.id}:{provider:"exe",connectionId:raw.executionConfigId??"local",executionConfigId:raw.executionConfigId??"local",image:raw.vmImage??"",tags:raw.tags??[]};
     }
    }else for(const field of kind==="model"?["modelAccountId","model","effort"]:["runScopes","portableIntegrationIds","githubInstallationIds","linearConnectionId","xConnectionIds","allowedTriggerIds"]){if(raw[field]!==undefined)settings[field]=raw[field];}
    const existing=(await client.query("SELECT id,slug FROM app.presets WHERE tenant_id=$1 AND kind=$2 AND settings=$3 AND NOT deleted ORDER BY is_default DESC,slug LIMIT 1",[tenant,kind,settings])).rows[0];
    let preset=existing;
    if(!preset){
     const base=teamDefault?"team-default":"migrated";let suffix=1,slug=base;
     while((await client.query("SELECT 1 FROM app.presets WHERE tenant_id=$1 AND kind=$2 AND slug=$3",[tenant,kind,slug])).rowCount)slug=`${base}-${++suffix}`;
     preset={id:crypto.randomUUID(),slug};
     await client.query("INSERT INTO app.presets(tenant_id,id,kind,slug,name,settings) VALUES($1,$2,$3,$4,$5,$6)",[tenant,preset.id,kind,slug,teamDefault?"Team default":`Migrated ${kind} ${suffix}`,settings]);
    }
    if(teamDefault)await client.query("UPDATE app.presets SET is_default=true WHERE tenant_id=$1 AND id=$2 AND NOT EXISTS(SELECT 1 FROM app.presets WHERE tenant_id=$1 AND kind=$3 AND is_default)",[tenant,preset.id,kind]);
    references[`${kind}-preset`]=preset.slug;
   }
   return references;
  }
  const legacyPresets=(await client.query("SELECT * FROM app.vm_presets WHERE tenant_id=$1 ORDER BY name,id",[tenant])).rows;
  for(const old of legacyPresets){
   if((await client.query("SELECT 1 FROM app.presets WHERE tenant_id=$1 AND id=$2",[tenant,old.id])).rowCount)continue;
   const base=old.name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,100)||"vm";let slug=base,n=1;
   while((await client.query("SELECT 1 FROM app.presets WHERE tenant_id=$1 AND kind='vm' AND slug=$2",[tenant,slug])).rowCount)slug=`${base}-${++n}`;
   await client.query("INSERT INTO app.presets(tenant_id,id,kind,slug,name,settings) VALUES($1,$2,'vm',$3,$4,$5)",[tenant,old.id,slug,old.name,{...old.settings,executionConfigId:old.execution_config_id}]);
  }
  await selection(team,true);
  const rows=(await client.query("SELECT * FROM app.skills WHERE tenant_id=$1 AND (definition IS NULL OR preset_migration_pending) ORDER BY key",[tenant])).rows;
  const plans=[];
  const content=new SkillContent(env.SKILL_ARTIFACTS);
  for(const row of rows){
   const loaded=await content.read(row,value=>decrypt(value,env.CREDENTIAL_ENCRYPTION_KEY));
   const definition=readSkillDefinition(loaded.body,row.key);
   const refs=await selection(row.run_defaults??team);
   const prompt=row.encrypted_prompt?await decrypt(row.encrypted_prompt,env.CREDENTIAL_ENCRYPTION_KEY):"";
   const isScript=row.run_defaults?.executionType==="code"||Boolean(row.encrypted_script);
   let body=writeSkillDefinition(loaded.body,{...definition,markdown:[definition.markdown,prompt].filter(Boolean).join("\n\n"),factorize:{...refs,...definition.factorize,concurrency:row.run_defaults?.concurrencyLimit??0,disabled:definition.factorize.disabled||isScript}});
   const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(loaded.body))),n=>n.toString(16).padStart(2,"0")).join("");
   if(row.encrypted_preset_migration_body){
    const prepared=await decrypt(row.encrypted_preset_migration_body,env.CREDENTIAL_ENCRYPTION_KEY);
    if(loaded.body!==prepared&&hash!==row.preset_migration_source_hash)throw new Error("Skill changed during preset migration. Sync and review its content before retrying.");
    body=prepared;
   }
   await client.query("UPDATE app.skills SET preset_migration_pending=true,encrypted_preset_migration_body=COALESCE(encrypted_preset_migration_body,$3),preset_migration_source_hash=COALESCE(preset_migration_source_hash,$4) WHERE tenant_id=$1 AND id=$2",[tenant,row.id,await encrypt(body,env.CREDENTIAL_ENCRYPTION_KEY),hash]);
   plans.push({row,loaded,body});
   if(isScript)await client.query("UPDATE app.triggers SET enabled=false WHERE tenant_id=$1 AND id IN(SELECT trigger_id FROM app.trigger_skills WHERE tenant_id=$1 AND skill_id=$2)",[tenant,row.id]);
  }
  return plans;
 });
 if(!plans.length)return;
 if(env.SKILL_ARTIFACTS){
  await new SkillLibrary(env,tenant).edit(async store=>{
   for(const plan of plans){const current=await store.get(plan.row.id);if(!current)continue;
    if(current.body===plan.body)continue;
    if(current.revision!==plan.row.revision)throw new Error("Skill changed during preset migration; retry after refreshing.");
    await store.update(plan.row.id,{expectedRevision:current.revision,body:plan.body});
   }
   return true;
  });
 }else await db.transaction(async client=>{
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,1))",[tenant]);
  for(const {row,loaded,body} of plans){
   if(row.artifact_version)throw new Error("Skill Artifacts binding required to migrate published skills.");
   const version:SkillVersion|undefined=loaded.version?{...loaded.version,files:loaded.version.files.map(file=>file.path==="SKILL.md"?{...markdown(body),executable:file.executable}:file)}:undefined;
   await client.query("UPDATE app.skills SET encrypted_body=$3,encrypted_directory=$4,definition=$5,preset_migration_pending=false,encrypted_preset_migration_body=NULL,preset_migration_source_hash=NULL,revision=revision+1 WHERE tenant_id=$1 AND id=$2 AND (definition IS NULL OR preset_migration_pending) AND revision=$6",[tenant,row.id,await encrypt(body,env.CREDENTIAL_ENCRYPTION_KEY),version?await encrypt(JSON.stringify(version),env.CREDENTIAL_ENCRYPTION_KEY):null,skillDefinitionIndex(readSkillDefinition(body,row.key)),row.revision]);
  }
 });
}
