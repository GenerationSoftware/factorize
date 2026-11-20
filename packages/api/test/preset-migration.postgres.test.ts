import { SkillContent } from "../src/skill-content";
import { expect,it,vi } from "vitest";
import { loadingFixture } from "./helpers/loading-fixture";
import { migratePresetSkills } from "../src/preset-migration";
import { encrypt,decrypt } from "../src/crypto";
import { readSkillDefinition } from "../src/skill-definition";
import { installSkillArtifacts } from "./helpers/memory-skill-git";
import { withSkillGit } from "../src/skill-git";
import { SkillLibrary } from "../src/skill-library";
import { markdown } from "../src/skill-files";
vi.mock("../src/skill-git",()=>({withSkillGit:vi.fn()}));
vi.mock("cloudflare:workers",()=>({WorkerEntrypoint:class{},DurableObject:class{}}));
vi.mock("@cloudflare/workers-oauth-provider",()=>({OAuthProvider:class{},AuthorizationError:class extends Error{},getOAuthApi:vi.fn()}));
it.skipIf(!process.env.AUTH_TEST_DATABASE_URL)("migrates distinct settings once, preserves prompts/files/history and disables script skills",async()=>{
 const f=await loadingFixture(process.env.AUTH_TEST_DATABASE_URL!);
 try{
  const ids=[];
  for(const [i,model] of ["one","one","two"].entries()){
   const id=crypto.randomUUID();ids.push(id);
   const body="# Instructions\n";
   await f.db.pool.query("INSERT INTO app.skills(tenant_id,id,key,encrypted_body,encrypted_directory,encrypted_prompt,run_defaults) VALUES($1,$2,$3,$4,$5,$6,$7)",[f.tenantId,id,`legacy-${i}`,await encrypt(body,f.env.CREDENTIAL_ENCRYPTION_KEY),await encrypt(JSON.stringify({commit:"legacy",files:[markdown(body),{path:"helper.txt",content:btoa("preserved"),executable:false}]}),f.env.CREDENTIAL_ENCRYPTION_KEY),await encrypt("Extra prompt",f.env.CREDENTIAL_ENCRYPTION_KEY),{requiresVm:false,model,concurrencyLimit:2,...(i===2?{executionType:"code"}:{})}]);
  }
  await f.db.pool.query("INSERT INTO app.trigger_skills(tenant_id,trigger_id,skill_id,position) VALUES($1,$2,$3,0)",[f.tenantId,f.triggerIds[0],ids[2]]);
  await migratePresetSkills(f.env,f.tenantId);
  const rows=(await f.db.pool.query("SELECT * FROM app.skills WHERE tenant_id=$1 ORDER BY key",[f.tenantId])).rows;
  const first=readSkillDefinition(await decrypt(rows[0].encrypted_body,f.env.CREDENTIAL_ENCRYPTION_KEY),rows[0].key);
  const second=rows[1].definition,third=rows[2].definition;
  expect(first.factorize["model-preset"]).toBe(second.factorize["model-preset"]);
  expect(third.factorize["model-preset"]).not.toBe(first.factorize["model-preset"]);
  expect(first.factorize.concurrency).toBe(2);expect(third.factorize.disabled).toBe(true);
  expect(first.markdown).toBe("# Instructions\n\n\nExtra prompt");
  expect(JSON.parse(await decrypt(rows[0].encrypted_directory,f.env.CREDENTIAL_ENCRYPTION_KEY)).files[1].content).toBe(btoa("preserved"));
  expect((await f.db.pool.query("SELECT enabled FROM app.triggers WHERE tenant_id=$1 AND id=$2",[f.tenantId,f.triggerIds[0]])).rows[0].enabled).toBe(false);
  const count=(await f.db.pool.query("SELECT count(*) n FROM app.presets WHERE tenant_id=$1",[f.tenantId])).rows[0].n;
  await migratePresetSkills(f.env,f.tenantId);
  expect((await f.db.pool.query("SELECT count(*) n FROM app.presets WHERE tenant_id=$1",[f.tenantId])).rows[0].n).toBe(count);
  expect((await f.db.pool.query("SELECT revision FROM app.skills WHERE tenant_id=$1 ORDER BY key",[f.tenantId])).rows).toEqual(rows.map(row=>({revision:row.revision})));
  expect((await f.db.pool.query("SELECT count(*) n FROM app.presets WHERE tenant_id=$1 AND is_default",[f.tenantId])).rows[0].n).toBe("3");
  expect((await f.db.pool.query("SELECT count(*) n FROM app.runs WHERE tenant_id=$1",[f.tenantId])).rows[0].n).toBe("3");
 }finally{await f.cleanup();}
});

it.skipIf(!process.env.AUTH_TEST_DATABASE_URL)("resumes after a failed Git publication without duplicating migrated instructions",async()=>{
 const f=await loadingFixture(process.env.AUTH_TEST_DATABASE_URL!);
 try{
  installSkillArtifacts(f.env);
  const id=crypto.randomUUID();
  await f.db.pool.query("INSERT INTO app.skills(tenant_id,id,key,encrypted_body,encrypted_prompt) VALUES($1,$2,'recovery',$3,$4)",[f.tenantId,id,await encrypt("Body",f.env.CREDENTIAL_ENCRYPTION_KEY),await encrypt("Extra",f.env.CREDENTIAL_ENCRYPTION_KEY)]);
  await new SkillLibrary(f.env,f.tenantId).configure({kind:"managed"});
  await f.db.pool.query("UPDATE app.skills SET definition=NULL WHERE tenant_id=$1 AND id=$2",[f.tenantId,id]);
  const original=vi.mocked(withSkillGit).getMockImplementation()!;
  vi.mocked(withSkillGit).mockImplementation((remote,work)=>original(remote,repo=>work({...repo,write:async()=>{throw new Error("fixture publication failure");}} as any)));
  await expect(migratePresetSkills(f.env,f.tenantId)).rejects.toThrow();
  expect((await f.db.pool.query("SELECT preset_migration_pending FROM app.skills WHERE tenant_id=$1 AND id=$2",[f.tenantId,id])).rows[0].preset_migration_pending).toBe(true);
  vi.mocked(withSkillGit).mockImplementation(original);
  await migratePresetSkills(f.env,f.tenantId);
  // A write accepted by Git but whose response is lost must not append again.
  const before=(await f.db.pool.query("SELECT artifact_version FROM app.skills WHERE tenant_id=$1 AND id=$2",[f.tenantId,id])).rows[0];
  await f.db.pool.query("UPDATE app.skills SET preset_migration_pending=true,encrypted_prompt=$3 WHERE tenant_id=$1 AND id=$2",[f.tenantId,id,await encrypt("Second prompt",f.env.CREDENTIAL_ENCRYPTION_KEY)]);
  vi.mocked(withSkillGit).mockImplementation((remote,work)=>original(remote,repo=>work({...repo,write:async(...args:any[])=>{await (repo.write as any)(...args);throw new Error("lost Git acknowledgement");}} as any)));
  await expect(migratePresetSkills(f.env,f.tenantId)).rejects.toThrow();
  vi.mocked(withSkillGit).mockImplementation(original);
  await new SkillLibrary(f.env,f.tenantId).sync();
  await migratePresetSkills(f.env,f.tenantId);
  const row=(await f.db.pool.query("SELECT definition,artifact_version FROM app.skills WHERE tenant_id=$1 AND id=$2",[f.tenantId,id])).rows[0];
  expect(row.definition).not.toHaveProperty("markdown");
  const loaded=await new SkillContent(f.env.SKILL_ARTIFACTS).read(row,value=>decrypt(value,f.env.CREDENTIAL_ENCRYPTION_KEY));
  expect(readSkillDefinition(loaded.body,"recovery").markdown).toBe("Body\n\nExtra\n\nSecond prompt");
  expect(row.artifact_version.commit).toBeTruthy();
  await migratePresetSkills(f.env,f.tenantId);
  expect((await f.db.pool.query("SELECT definition FROM app.skills WHERE tenant_id=$1 AND id=$2",[f.tenantId,id])).rows[0].definition).toEqual(row.definition);
 }finally{await f.cleanup();}
});
