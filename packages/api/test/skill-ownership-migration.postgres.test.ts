import { SkillContent } from "../src/skill-content";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile,readdir } from "node:fs/promises";
import { Database } from "../src/postgres/database";
import { SkillRepository } from "../src/postgres/skill-repository";
import { RunQueryRepository } from "../src/postgres/run-query-repository";
import { encrypt,decrypt } from "../src/crypto";
import { markdown } from "../src/skill-files";
describe.skipIf(!process.env.AUTH_TEST_DATABASE_URL)("trigger-to-skill context migration",()=>{
 const name="skill_migration_"+crypto.randomUUID().replaceAll("-","");
 const tenant=crypto.randomUUID(),oldSkill=crypto.randomUUID(),key=btoa("a".repeat(32)),ids=Array.from({length:4},()=>crypto.randomUUID()),runId=crypto.randomUUID();
 let admin:Database,db:Database,store:SkillRepository;
 beforeAll(async()=>{
  admin=new Database({connectionString:process.env.AUTH_TEST_DATABASE_URL});await admin.pool.query(`CREATE DATABASE ${name}`);
  const url=new URL(process.env.AUTH_TEST_DATABASE_URL!);url.pathname="/"+name;db=new Database({connectionString:url.href});
  const dir=new URL("../migrations/",import.meta.url);
  for(const file of (await readdir(dir)).filter(f=>f.endsWith(".sql")).sort()){
   if(file==="0084_migrate_trigger_skills.sql"){
    await db.pool.query("INSERT INTO app.tenants(id) VALUES($1)",[tenant]);
    await db.pool.query("INSERT INTO app.skills(tenant_id,id,key,encrypted_body,encrypted_directory) VALUES($1,$2,'attached-context',$3,$4)",[tenant,oldSkill,await encrypt("Original instructions",key),await encrypt(JSON.stringify({commit:"old",files:[markdown("Original instructions"),{path:"nested/context.txt",content:btoa("Supporting context"),executable:false}]}),key)]);
    for(const [i,id] of ids.entries()){
     const config=i===3?{executionType:"code",requiresVm:true,connectionId:"local",script:"echo legacy-script"}:{executionType:"agent",requiresVm:false};
     await db.pool.query("INSERT INTO app.triggers(tenant_id,id,name,slug,encrypted_prompt,execution_config,model,concurrency_limit) VALUES($1,$2,$3,$3,$4,$5,'legacy-model',2)",[tenant,id,"legacy-"+i,await encrypt("Original prompt "+i,key),config]);
     await db.pool.query("INSERT INTO app.events(tenant_id,id,trigger_id,kind,slug,encrypted_template) VALUES($1,$2,$3,'manual','manual',$4)",[tenant,crypto.randomUUID(),id,await encrypt("Event context {{manual.prompt}}",key)]);
    }
    await db.pool.query("INSERT INTO app.trigger_skills(tenant_id,trigger_id,skill_id,position,skill_owned) VALUES($1,$2,$3,0,false),($1,$4,$3,0,false)",[tenant,ids[1],oldSkill,ids[2]]);
    await db.pool.query("INSERT INTO app.manual_invocation_permissions(tenant_id,source_trigger_id,destination_trigger_id) VALUES($1,$2,$3)",[tenant,ids[0],ids[1]]);
    await db.pool.query("INSERT INTO app.invocations(tenant_id,id,trigger_id,source,claim_key,context) VALUES($1,$2,$3,'manual','historic','{}')",[tenant,runId,ids[0]]);
    await db.pool.query("INSERT INTO app.trigger_runs(tenant_id,id,trigger_id,invocation_id,state,encrypted_prompt) VALUES($1,$2,$3,$2,'succeeded',$4)",[tenant,runId,ids[0],await encrypt("Historic prompt",key)]);
    await db.pool.query("INSERT INTO app.runs(tenant_id,id,invocation_id,trigger_id,provider,issue_id,agent_name,agent_kind,state,execution_backend_kind,execution_config) VALUES($1,$2,$2,$3,'manual','historic','','pi','succeeded','hosted-pi','{}')",[tenant,runId,ids[0]]);
   }
   await db.pool.query(await readFile(new URL(file,dir),"utf8"));
  }
  store=new SkillRepository(db,tenant,key);
 });
 afterAll(async()=>{await db?.close();if(admin){await admin.pool.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);await admin.close();}});
 it("creates a distinct skill for every old trigger and retains original skills",async()=>{
  const links=(await db.pool.query("SELECT * FROM app.trigger_skills WHERE tenant_id=$1",[tenant])).rows;
  expect(links).toHaveLength(4);expect(new Set(links.map(r=>r.skill_id)).size).toBe(4);
  expect(await store.get(oldSkill)).toMatchObject({body:"Original instructions"});
  for(const [i,id] of ids.entries()){
   const row=(await db.pool.query("SELECT s.*,t.encrypted_prompt trigger_prompt,t.execution_config FROM app.trigger_skills ts JOIN app.skills s ON s.tenant_id=ts.tenant_id AND s.id=ts.skill_id JOIN app.triggers t ON t.tenant_id=ts.tenant_id AND t.id=ts.trigger_id WHERE ts.tenant_id=$1 AND ts.trigger_id=$2",[tenant,id])).rows[0];
   const skill=await store.get(row.id);expect(skill!.body).toContain("Original prompt "+i);expect(row.trigger_prompt).toBe("");expect(row.run_defaults.concurrencyLimit).toBe(2);
   if(i===1||i===2){const edited=await new SkillContent().read(row,value=>decrypt(value,key),"Edited instructions");expect(edited.body).toBe("Edited instructions");expect(edited.version!.files.some(file=>file.path.endsWith("nested/context.txt"))).toBe(true);expect(skill!.body).toContain("Original instructions");expect(skill!.version!.files.some(f=>f.path.endsWith("nested/context.txt")&&f.content===btoa("Supporting context"))).toBe(true);}
   if(i===3)expect(row.execution_config.script).toBe("echo legacy-script");
  }
 });
 it("preserves event templates, workflow links, historical runs, and provenance",async()=>{
  const rows=(await db.pool.query("SELECT encrypted_template FROM app.events WHERE tenant_id=$1",[tenant])).rows;
  for(const row of rows)expect(await decrypt(row.encrypted_template,key)).toBe("Event context {{manual.prompt}}");
  expect((await db.pool.query("SELECT * FROM app.manual_invocation_permissions WHERE tenant_id=$1",[tenant])).rows).toHaveLength(1);
  expect((await new RunQueryRepository(db,tenant).list(new URLSearchParams())).items.some(r=>r.id===runId)).toBe(true);
  expect((await db.pool.query("SELECT * FROM app.configuration_diagnostics WHERE tenant_id=$1 AND code='skill_owned_migration'",[tenant])).rows).toHaveLength(4);
 });
});
