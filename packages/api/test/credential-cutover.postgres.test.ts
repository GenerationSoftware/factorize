import {describe,it,expect} from "vitest";
import {readFile,readdir} from "node:fs/promises";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {Database} from "../src/postgres/database";
import {encrypt,decrypt} from "../src/crypto";
const url=process.env.AUTH_TEST_DATABASE_URL,exec=promisify(execFile);
describe.skipIf(!url)("breaking credential cutover",{timeout:60_000},()=>{
  it("gates existing data, plans without mutation, preserves managed records and disables jobs without changing selections",async()=>{
    const name="cutover_"+crypto.randomUUID().replaceAll("-",""),admin=new Database({connectionString:url}),address=new URL(url!);address.pathname="/"+name;
    await admin.pool.query(`CREATE DATABASE ${name}`);const db=new Database({connectionString:address.href});
    try{
      const directory=new URL("../migrations/",import.meta.url),files=(await readdir(directory)).filter(f=>f.endsWith(".sql")).sort();
      for(const file of files.filter(f=>f<"0052"))await db.pool.query(await readFile(new URL(file,directory),"utf8"));
      const tenant=crypto.randomUUID(),legacy=crypto.randomUUID(),managed=crypto.randomUUID(),job=crypto.randomUUID(),project=crypto.randomUUID(),key=btoa("a".repeat(32));
      await db.pool.query("INSERT INTO app.tenants(id) VALUES($1)",[tenant]);await db.pool.query("INSERT INTO app.integration_collections(tenant_id) VALUES($1)",[tenant]);
      for(const [id,payload] of [[legacy,"unreadable-inner-user-ciphertext"],[managed,"factorize-managed-bearer-v1:managed-secret"]])await db.pool.query("INSERT INTO app.integration_records(tenant_id,id,kind,name,origin,revision,encrypted_payload) VALUES($1,$2,'bearer','Fixture','https://api.example.com',1,$3)",[tenant,id,await encrypt(payload,key)]);
      await db.pool.query("INSERT INTO app.projects(tenant_id,id,name) VALUES($1,$2,'Fixture')",[tenant,project]);
      const config={connectionId:"existing-exe",portableIntegrationIds:[legacy,managed],modelAccess:"native"};
      await db.pool.query("INSERT INTO app.jobs(tenant_id,id,project_id,name,slug,encrypted_prompt_template,execution_config,concurrency_limit) VALUES($1,$2,$3,'Fixture','fixture','encrypted',$4,1)",[tenant,job,project,config]);
      await db.pool.query("INSERT INTO app.connections(tenant_id,kind,encrypted_value) VALUES($1,'exe:existing-exe','unchanged')",[tenant]);
      await db.pool.query("INSERT INTO app.credential_proxy_states(tenant_id,proxy_identity,boot_epoch) VALUES($1,'fly:old-proxy:machine',$2)",[tenant,crypto.randomUUID()]);
      const migration=await readFile(new URL("0052_retire_credential_proxy.sql",directory),"utf8");
      await db.pool.query("BEGIN");await expect(db.pool.query(migration)).rejects.toThrow(/prepare-credential-cutover/);await db.pool.query("ROLLBACK");
      const run=async(apply=false)=>JSON.parse((await exec(process.execPath,[new URL("../scripts/prepare-credential-cutover.mjs",import.meta.url).pathname,...(apply?["--apply"]:[])],{env:{...process.env,DATABASE_URL:address.href,CREDENTIAL_ENCRYPTION_KEY:key}})).stdout);
      const plan=await run();expect(plan.mode).toBe("plan");expect(plan.jobs[0]).toMatchObject({id:job,requiresRepair:true,enabled:true,portableIntegrationIds:[legacy,managed]});expect(JSON.stringify(plan)).not.toContain("managed-secret");
      expect((await db.pool.query("SELECT enabled FROM app.jobs WHERE tenant_id=$1 AND id=$2",[tenant,job])).rows[0].enabled).toBe(true);
      const applied=await run(true);expect(applied.legacyCredentials).toEqual([{tenantId:tenant,id:legacy,kind:"bearer"}]);
      expect((await db.pool.query("SELECT enabled,execution_config FROM app.jobs WHERE tenant_id=$1 AND id=$2",[tenant,job])).rows[0]).toEqual({enabled:false,execution_config:config});
      expect((await db.pool.query("SELECT encrypted_value FROM app.connections WHERE tenant_id=$1",[tenant])).rows[0].encrypted_value).toBe("unchanged");
      expect((await db.pool.query("SELECT encrypted_payload,deleted_at FROM app.integration_records WHERE tenant_id=$1 AND id=$2",[tenant,legacy])).rows[0]).toEqual({encrypted_payload:null,deleted_at:expect.any(Date)});
      const ciphertext=(await db.pool.query("SELECT encrypted_payload FROM app.integration_records WHERE tenant_id=$1 AND id=$2",[tenant,managed])).rows[0].encrypted_payload;expect(await decrypt(ciphertext,key)).toBe("factorize-managed-bearer-v1:managed-secret");
      await db.pool.query("BEGIN");await db.pool.query(migration);await db.pool.query("COMMIT");
      const retired=(await db.pool.query("SELECT to_regclass('app.run_credentials') AS tokens,to_regclass('app.credential_proxy_states') AS proxy,to_regclass('app.unlock_key_verifications') AS unlock")).rows[0];expect(retired).toEqual({tokens:null,proxy:null,unlock:null});
    }finally{await db.close();await admin.pool.query(`DROP DATABASE ${name} WITH (FORCE)`);await admin.close();}
  });
});
