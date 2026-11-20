import type { Database, DatabaseClient } from "./database";
import { presetResponse, type PresetInput, type Preset, type PresetKind } from "../presets";

const columns='id,kind,slug,name,revision,settings,is_default AS "isDefault",settings->>\'executionConfigId\' AS "executionConfigId"';
export class PresetError extends Error { constructor(public status:number,public code:string,message:string){super(message);} }
export class PresetRepository {
 constructor(private db:Database,private tenant:string){}
 async list(client:Pick<DatabaseClient,"query">=this.db.pool as Pick<DatabaseClient,"query">):Promise<Preset[]>{return (await client.query(`SELECT ${columns} FROM app.presets WHERE tenant_id=$1 AND NOT deleted ORDER BY kind,lower(name),slug`,[this.tenant])).rows.map(this.map);}
 private map(row:any):Preset { const {executionConfigId,...settings}=row.settings;return presetResponse.parse({...row,settings,executionConfigId:executionConfigId??null}); }
 async save(input:PresetInput,id?:string,configId?:string){
  try{return await this.db.transaction(async client=>{
   await this.lock(client);
   const old=id?(await client.query("SELECT * FROM app.presets WHERE tenant_id=$1 AND id=$2 AND NOT deleted FOR UPDATE",[this.tenant,id])).rows[0]:undefined;
   if(id&&!old)throw new PresetError(404,"not_found","Preset not found.");
   if(old&&(old.slug!==input.slug||old.kind!==input.kind))throw new PresetError(400,"immutable_slug","Preset slugs and types cannot change.");
   if(old&&input.expectedRevision!==undefined&&old.revision!==input.expectedRevision)throw new PresetError(409,"stale_preset","Preset changed; reload before saving.");
   const settings={...input.settings,...(configId?{executionConfigId:configId}:{})};
   const presetId=id??crypto.randomUUID();
   if(old)await client.query("UPDATE app.presets SET name=$3,settings=$4,revision=revision+1 WHERE tenant_id=$1 AND id=$2",[this.tenant,presetId,input.name,settings]);
   else await client.query("INSERT INTO app.presets(tenant_id,id,kind,slug,name,settings,is_default) VALUES($1,$2,$3,$4,$5,$6,NOT EXISTS(SELECT 1 FROM app.presets WHERE tenant_id=$1 AND kind=$3 AND is_default))",[this.tenant,presetId,input.kind,input.slug,input.name,settings]);
   return (await this.list(client)).find(preset=>preset.id===presetId)!;
  });}catch(error:any){if(error.code==="23505")throw new PresetError(409,"duplicate_slug","A preset of this type already uses this slug, including retained historical presets.");throw error;}
 }
 async makeDefault(id:string){return this.db.transaction(async client=>{await this.lock(client);const preset=(await this.list(client)).find(p=>p.id===id);if(!preset)throw new PresetError(404,"not_found","Preset not found.");await client.query("UPDATE app.presets SET is_default=false WHERE tenant_id=$1 AND kind=$2 AND is_default",[this.tenant,preset.kind]);await client.query("UPDATE app.presets SET is_default=true WHERE tenant_id=$1 AND id=$2",[this.tenant,id]);return {...preset,isDefault:true};});}
 async remove(id:string){return this.db.transaction(async client=>{
  await this.lock(client);const preset=(await this.list(client)).find(p=>p.id===id);if(!preset)throw new PresetError(404,"not_found","Preset not found.");
  if(preset.isDefault)throw new PresetError(409,"default_preset","Choose another team default before deleting this preset.");
  if((await client.query("SELECT 1 FROM app.skills WHERE tenant_id=$1 AND (definition IS NULL OR preset_migration_pending) LIMIT 1",[this.tenant])).rowCount)throw new PresetError(409,"migration_pending","Complete the skill preset migration before deleting presets.");
  const refs=(await client.query("SELECT key FROM app.skills WHERE tenant_id=$1 AND definition->'factorize'->>$2=$3 ORDER BY key",[this.tenant,`${preset.kind}-preset`,preset.slug])).rows;
  if(refs.length)throw new PresetError(409,"preset_referenced",`Used by skills: ${refs.map(row=>row.key).join(", ")}. Change their preset selections before deleting.`);
  await client.query("UPDATE app.presets SET deleted=true WHERE tenant_id=$1 AND id=$2",[this.tenant,id]);return {deleted:true};
 });}
 private async lock(client:DatabaseClient){await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,1))",[this.tenant]);}
}
