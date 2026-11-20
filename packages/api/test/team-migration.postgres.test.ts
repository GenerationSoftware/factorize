import {RunQueryRepository} from "../src/postgres/run-query-repository";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import { encrypt, decrypt } from "../src/crypto";
import { PostgresTriggerRepository } from "../src/postgres/job-repository";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { Database } from "../src/postgres/database";

describe.skipIf(!process.env.AUTH_TEST_DATABASE_URL)("personal team settings migration", () => {
  const databaseName = `team_migration_${crypto.randomUUID().replaceAll("-", "")}`;
  const team = crypto.randomUUID(), owner = crypto.randomUUID(), member = crypto.randomUUID();
  const emptyTeam = crypto.randomUUID();
  const key = btoa("a".repeat(32)), tokenId = crypto.randomUUID();
  const triggerIds = [crypto.randomUUID(), crypto.randomUUID()];
  const pendingId=crypto.randomUUID();let pendingPrompt:string;
  const runIds = [crypto.randomUUID(), crypto.randomUUID()];
  const renamedSkillId = crypto.randomUUID();
  const multiSkillIds=[crypto.randomUUID(),crypto.randomUUID()];
  let legacySkillSnapshot:string;
  let admin: Database, db: Database;
  let databaseUrl:string;
  const integrationCipherKey=crypto.randomUUID();

  beforeAll(async () => {
    admin = new Database({ connectionString: process.env.AUTH_TEST_DATABASE_URL });
    await admin.pool.query(`CREATE DATABASE ${databaseName}`);
    const url = new URL(process.env.AUTH_TEST_DATABASE_URL!);
    url.pathname = `/${databaseName}`;
    databaseUrl=url.href;db = new Database({ connectionString: url.href });
    const directory = new URL("../migrations/", import.meta.url);
    for (const file of (await readdir(directory)).filter(name => name.endsWith(".sql")).sort()) {
      if (file === "0067_team_settings.sql") {
        await db.pool.query("INSERT INTO app.tenants(id) VALUES ($1),($2)", [team, emptyTeam]);
        await db.pool.query("INSERT INTO app.connections(tenant_id,kind,encrypted_value) VALUES($1,$2,$3)",[team,"exe:"+integrationCipherKey,await encrypt(JSON.stringify({apiToken:"preserved-fixture-token",agentKind:"codex"}),key)]);
        await db.pool.query("INSERT INTO app.auth_users(id,email,email_verified) VALUES ($1,'owner@team.test',true),($2,'member@team.test',true)", [owner, member]);
        await db.pool.query("INSERT INTO app.members(tenant_id,user_id,email,role) VALUES ($1,$2,'owner@team.test','owner'),($1,$3,'member@team.test','member')", [team, owner, member]);
        await db.pool.query(`INSERT INTO app.user_run_defaults(tenant_id,user_id,run_defaults) VALUES
          ($1,$2,'{"executionConfigId":"owner-vm","model":"owner-model","runScopes":[]}'),
          ($1,$3,'{"executionConfigId":"member-vm"}')`, [team, owner, member]);
        await db.pool.query(`INSERT INTO app.projects(tenant_id,id,name,run_defaults,created_at) VALUES
          ($1,gen_random_uuid(),'Older','{"model":"project-model","capacity":7}','2020-01-01'),
          ($1,gen_random_uuid(),'Newer','{"executionConfigId":"newer-vm"}','2021-01-01')`, [team]);
      }
      if (file === "0068_flat_team_ownership.sql") {
        const projects = (await db.pool.query("SELECT id FROM app.projects WHERE tenant_id=$1 ORDER BY created_at,id", [team])).rows;
        for (let index = 0; index < triggerIds.length; index++) {
          const jobId = triggerIds[index], runId = runIds[index], invocationId = crypto.randomUUID(), eventId = crypto.randomUUID();
          await db.pool.query("INSERT INTO app.jobs(tenant_id,id,project_id,name,slug,encrypted_prompt_template,execution_config,concurrency_limit) VALUES ($1,$2,$3,$4,$4,'historic-prompt','{}',1)", [team, jobId, projects[index].id, `job-${index}`]);
          await db.pool.query("INSERT INTO app.triggers(tenant_id,id,job_id,kind,slug) VALUES ($1,$2,$3,'manual','manual')", [team, eventId, jobId]);
          await db.pool.query("INSERT INTO app.invocations(tenant_id,id,job_id,trigger_id,source,claim_key,context) VALUES ($1,$2,$3,$4,'manual','historic','{}')", [team, invocationId, jobId, eventId]);
          await db.pool.query("INSERT INTO app.job_runs(tenant_id,id,job_id,invocation_id,state,encrypted_prompt) VALUES ($1,$2,$3,$4,'succeeded','historic-prompt')", [team, runId, jobId, invocationId]);
          await db.pool.query("INSERT INTO app.runs(tenant_id,id,job_id,invocation_id,provider,issue_id,agent_kind,agent_name,workspace_name,state,execution_config) VALUES ($1,$2,$3,$4,'manual','historic','pi','','','succeeded','{}')", [team, runId, jobId, invocationId]);
        }
        await db.pool.query("INSERT INTO app.manual_invocation_permissions(tenant_id,source_job_id,destination_job_id) VALUES ($1,$2,$2),($1,$2,$3)", [team, triggerIds[0], triggerIds[1]]);
      }
      if (file === "0069_triggers_and_events.sql") {
        await db.pool.query("INSERT INTO app.run_artifacts(tenant_id,run_id,id,kind,object_key,provider,format,byte_size,sha256,state) VALUES ($1,$2,gen_random_uuid(),'job_file','historical/job/blob','code','file',4,repeat('a',64),'stored')", [team, runIds[0]]);
        await db.pool.query("UPDATE app.jobs SET encrypted_prompt_template=$3 WHERE tenant_id=$1 AND id=$2", [team, triggerIds[0], await encrypt("Keep sourceJobId literal. {{trigger-1.sourceJobId}}", key)]);
        await db.pool.query("UPDATE app.triggers SET slug='trigger-1',kind='jobLifecycle',config=$3 WHERE tenant_id=$1 AND job_id=$2", [team, triggerIds[0], { sourceJobIds: [triggerIds[0]], states: ["succeeded"] }]);
        await db.pool.query("INSERT INTO app.access_tokens(tenant_id,id,name,digest,user_id,session_version,scopes,expires_at) VALUES ($1,$2,'legacy fixture','fixture-digest',$3,1,$4,now()+interval '1 hour')", [team, tokenId, owner, JSON.stringify(["jobs:read", "runs:write"])]);
      }
      if (file === "0070_resource_names.sql") {
        await db.pool.query("INSERT INTO app.skills(tenant_id,id,key,encrypted_body) VALUES($1,$2,'review_label','historic-body')", [team,renamedSkillId]);
        await db.pool.query("UPDATE app.triggers SET name='Human Display Name',slug='review-label' WHERE tenant_id=$1 AND id=$2", [team,triggerIds[0]]);
      }
      if (file === "0072_single_skill_event_context.sql") {
        await db.pool.query("UPDATE app.triggers SET encrypted_prompt_template=$3 WHERE tenant_id=$1 AND id=$2",[team,triggerIds[1],await encrypt("Legacy {{manual.prompt}}",key)]);
        for (const [index,id] of multiSkillIds.entries()) {
          await db.pool.query("INSERT INTO app.skills(tenant_id,id,key,encrypted_body) VALUES($1,$2,$3,$4)",[team,id,index===0?"legacy-first":"legacy-second",await encrypt(index===0?"One":"Two",key)]);
          await db.pool.query("INSERT INTO app.trigger_skills(tenant_id,trigger_id,skill_id,position) VALUES($1,$2,$3,$4)",[team,triggerIds[1],id,index]);
        }
        legacySkillSnapshot=await encrypt(JSON.stringify(multiSkillIds.map((id,index)=>({id,body:index===0?"One":"Two"}))),key);
        await db.pool.query("UPDATE app.trigger_runs SET encrypted_skill_snapshot=$3 WHERE tenant_id=$1 AND id=$2",[team,runIds[1],legacySkillSnapshot]);
      }
      if(file==="0079_hosted_pi_pending_cutover.sql"){
        pendingPrompt=await encrypt("Previously accepted queued work",key);const invocation=crypto.randomUUID();
        await db.pool.query("INSERT INTO app.invocations(tenant_id,id,trigger_id,source,claim_key,context) VALUES($1,$2,$3,'manual','pending-cutover','{}')",[team,invocation,triggerIds[0]]);
        await db.pool.query("INSERT INTO app.trigger_runs(tenant_id,id,trigger_id,invocation_id,state,encrypted_prompt,run_name) VALUES($1,$2,$3,$4,'queued',$5,'Accepted pending work')",[team,pendingId,triggerIds[0],invocation,pendingPrompt]);
        await db.pool.query("INSERT INTO app.runs(tenant_id,id,trigger_id,invocation_id,provider,issue_id,agent_name,agent_kind,state,execution_backend_kind,execution_config) VALUES($1,$2,$3,$4,'manual','pending-cutover','','codex','queued','exe-vm',$5)",[team,pendingId,triggerIds[0],invocation,{agentKind:"codex",connectionId:"old-vm",model:"old-model"}]);
      }
      const sql=await readFile(new URL(file,directory),"utf8");
      if(file>="0067_team_settings.sql"){
        const interruption=new Error("Simulated process interruption before commit");
        try{await db.transaction(async client=>{await client.query(sql);throw interruption;});}catch(error){if(error!==interruption)throw error;}
        expect((await db.pool.query("SELECT 1 FROM app.schema_migrations WHERE version=$1",[file.replace(/\.sql$/,"")])).rowCount).toBe(0);
      }
      await db.pool.query(sql);
      await db.pool.query("INSERT INTO app.schema_migrations(version) VALUES($1) ON CONFLICT DO NOTHING",[file.replace(/\.sql$/,"")]);
    }
  });

  it("retries the actual migration runner after transactional interruptions without replay or history loss",async()=>{
    const result=await promisify(execFile)(process.execPath,[new URL("../scripts/migrate.mjs",import.meta.url).pathname],{env:{...process.env,DATABASE_URL:databaseUrl}});
    expect(result.stdout).not.toContain("applied ");
    expect((await db.pool.query("SELECT count(*)::int n FROM app.runs WHERE tenant_id=$1 AND id=ANY($2::uuid[])",[team,runIds])).rows[0].n).toBe(runIds.length);
    const connection=(await db.pool.query("SELECT encrypted_value FROM app.connections WHERE tenant_id=$1 AND kind=$2",[team,"exe:"+integrationCipherKey])).rows[0];expect(JSON.parse(await decrypt(connection.encrypted_value,key))).toEqual({apiToken:"preserved-fixture-token",agentKind:"codex"});
    expect((await db.pool.query("SELECT kind,object_key FROM app.run_artifacts WHERE tenant_id=$1 AND run_id=$2",[team,runIds[0]])).rows[0]).toEqual({kind:"trigger_file",object_key:"historical/job/blob"});
    expect((await db.pool.query("SELECT run_defaults->'requiresVm' flag FROM app.team_settings WHERE tenant_id=$1",[team])).rows[0].flag).toBe(true);
  });

  it("preserves an unstarted guest admission as an actionable cancellable block without reinterpretation",async()=>{
    const run=(await db.pool.query("SELECT r.state,r.failure_code,r.execution_config,r.execution_handle,j.encrypted_prompt FROM app.runs r JOIN app.trigger_runs j USING(tenant_id,id) WHERE r.tenant_id=$1 AND r.id=$2",[team,pendingId])).rows[0];
    expect(run).toMatchObject({state:"blocked",failure_code:"managed_agent_cutover_required",execution_config:{agentKind:"codex",connectionId:"old-vm",model:"old-model"},execution_handle:null,encrypted_prompt:pendingPrompt});
    expect(await new RunQueryRepository(db,team).stop(pendingId)).toBeTruthy();expect((await db.pool.query("SELECT encrypted_prompt FROM app.trigger_runs WHERE tenant_id=$1 AND id=$2",[team,pendingId])).rows[0].encrypted_prompt).toBe(pendingPrompt);
  });

  afterAll(async () => {
    await db?.close();
    if (admin) {
      await admin.pool.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
      await admin.close();
    }
  });

  it("migrates deterministic owner/project defaults and preserves their source records", async () => {
    const settings = await db.pool.query("SELECT run_defaults FROM app.team_settings WHERE tenant_id=$1", [team]);
    expect(settings.rows[0].run_defaults).toMatchObject({ executionConfigId: "owner-vm", model: "project-model", capacity: 7, runScopes: [] });
    expect((await db.pool.query("SELECT count(*)::int count FROM app.projects WHERE tenant_id=$1", [team])).rows[0].count).toBe(2);
    expect((await db.pool.query("SELECT count(*)::int count FROM app.user_run_defaults WHERE tenant_id=$1", [team])).rows[0].count).toBe(2);
    expect((await db.pool.query("SELECT run_defaults FROM app.team_settings WHERE tenant_id=$1", [emptyTeam])).rows[0].run_defaults).toMatchObject({capacity:4,concurrencyLimit:1,portableIntegrationIds:[]});
  });

  it("preserves resource identities and history while removing project requirements and ineffective grants", async () => {
    const triggers = await db.pool.query("SELECT id FROM app.triggers WHERE tenant_id=$1 ORDER BY id", [team]);
    expect(triggers.rows.map(row => row.id)).toEqual([...triggerIds].sort());
    const runs = await db.pool.query("SELECT id,state FROM app.runs WHERE tenant_id=$1 AND id=ANY($2::uuid[]) ORDER BY id", [team,runIds]);
    expect(runs.rows).toEqual([...runIds].sort().map(id => ({ id, state: "succeeded" })));
    expect((await db.pool.query("SELECT destination_trigger_id FROM app.manual_invocation_permissions WHERE tenant_id=$1", [team])).rows).toEqual([{ destination_trigger_id: triggerIds[0] }]);
    const id = crypto.randomUUID();
    await db.pool.query("INSERT INTO app.triggers(tenant_id,id,name,slug,encrypted_prompt_template,execution_config,concurrency_limit) VALUES ($1,$2,'flat','flat','prompt','{}',1)", [team, id]);
    expect((await db.pool.query("SELECT project_id,run_scopes FROM app.triggers WHERE tenant_id=$1 AND id=$2", [team, id])).rows[0]).toMatchObject({ project_id: null, run_scopes: expect.arrayContaining(["team:read"]) });
    expect((await db.pool.query("SELECT count(*)::int count FROM app.runs WHERE tenant_id=$1", [emptyTeam])).rows[0].count).toBe(0);
  });

  it("migrates Trigger/Event identities, template references, and effective scopes", async () => {
    const repository = new PostgresTriggerRepository(db, team, value => encrypt(value, key), value => decrypt(value, key));
    const trigger = await repository.getTrigger(triggerIds[0]);
    expect(trigger?.id).toBe(triggerIds[0]);
    expect((await db.pool.query("SELECT kind,object_key FROM app.run_artifacts WHERE tenant_id=$1 AND run_id=$2", [team,runIds[0]])).rows).toEqual([{kind:"trigger_file",object_key:"historical/job/blob"}]);
    expect(trigger?.prompt).toBe("");
    expect(trigger?.events[0].template).toBe("Keep sourceJobId literal. {{event-1.sourceTriggerId}}");
    expect(trigger?.events[0]).toMatchObject({ slug: "event-1", kind: "triggerLifecycle", config: { sourceTriggerIds: [triggerIds[0]] } });
    expect((await db.pool.query("SELECT scopes FROM app.access_tokens WHERE tenant_id=$1 AND id=$2", [team, tokenId])).rows[0].scopes).toEqual(["triggers:read", "runs:read", "runs:invoke", "runs:cancel", "runs:write"]);
    expect((await db.pool.query("SELECT to_regclass('app.jobs') jobs,to_regclass('app.triggers') triggers,to_regclass('app.events') events")).rows[0]).toEqual({ jobs: null, triggers: "app.triggers", events: "app.events" });
  });

  it("creates settings for future teams and cascades only the removed team's settings", async () => {
    const id = crypto.randomUUID();
    await db.pool.query("INSERT INTO app.tenants(id) VALUES ($1)", [id]);
    expect((await db.pool.query("SELECT run_defaults FROM app.team_settings WHERE tenant_id=$1", [id])).rows[0].run_defaults).toMatchObject({capacity:4,concurrencyLimit:1,portableIntegrationIds:[]});
    await db.pool.query("DELETE FROM app.tenants WHERE id=$1", [id]);
    expect((await db.pool.query("SELECT 1 FROM app.team_settings WHERE tenant_id=$1", [id])).rows).toEqual([]);
    expect((await db.pool.query("SELECT 1 FROM app.team_settings WHERE tenant_id=$1", [team])).rows).toHaveLength(1);
  });

  it("preserves legacy resources while resolving invalid names and cross-resource collisions", async () => {
    expect((await db.pool.query("SELECT key,encrypted_body FROM app.skills WHERE tenant_id=$1 AND id=$2",[team,renamedSkillId])).rows[0]).toEqual({key:"review-label",encrypted_body:"historic-body"});
    const row=(await db.pool.query("SELECT name,slug FROM app.triggers WHERE tenant_id=$1 AND id=$2",[team,triggerIds[0]])).rows[0];
    expect(row.name).toBe("review-label-"+triggerIds[0].replaceAll("-",""));
    expect(row.slug).toBe(row.name);
    expect((await db.pool.query("SELECT details FROM app.configuration_diagnostics WHERE tenant_id=$1 AND resource_id=$2 AND code='name_migrated'",[team,triggerIds[0]])).rows[0].details).toEqual({previousName:"Human Display Name",name:row.name});
    expect((await db.pool.query("SELECT count(*)::int count FROM app.runs WHERE tenant_id=$1 AND id=ANY($2::uuid[])",[team,runIds])).rows[0].count).toBe(2);
  });
  it("preserves multi-skill provenance and accepted snapshots while requiring one explicit skill before re-enabling",async()=>{
    const repository=new PostgresTriggerRepository(db,team,value=>encrypt(value,key),value=>decrypt(value,key));
    const trigger=(await repository.getTrigger(triggerIds[1]))!;
    expect(trigger).toMatchObject({enabled:false,contextReviewRequired:true,prompt:""});
    expect(trigger.events[0].template).toBe("Legacy {{manual.prompt}}");
    expect((await db.pool.query("SELECT skill_id FROM app.legacy_trigger_skill_links WHERE tenant_id=$1 AND trigger_id=$2 ORDER BY position",[team,trigger.id])).rows.map(row=>row.skill_id)).toEqual(multiSkillIds);
    expect((await db.pool.query("SELECT encrypted_skill_snapshot FROM app.trigger_runs WHERE tenant_id=$1 AND id=$2",[team,runIds[1]])).rows[0].encrypted_skill_snapshot).toBe(legacySkillSnapshot);
    await expect(repository.setEnabled(trigger.id,true,new Date().toISOString())).rejects.toThrow("Select one skill");
    await repository.update({...trigger,contextReviewRequired:false,prompt:"Resolved",skill:{id:multiSkillIds[1],key:"legacy-second",revision:1,position:0,body:"Two"},executionConfig:{...trigger.executionConfig,skillId:multiSkillIds[1]}});
    expect(await repository.setEnabled(trigger.id,true,new Date().toISOString())).toBe(true);
    expect((await db.pool.query("SELECT skill_id FROM app.trigger_skills WHERE tenant_id=$1 AND trigger_id=$2",[team,trigger.id])).rows.map(row=>row.skill_id)).toEqual([multiSkillIds[1]]);
    expect((await db.pool.query("SELECT count(*)::int n FROM app.skills WHERE tenant_id=$1 AND id=ANY($2::uuid[])",[team,multiSkillIds])).rows[0].n).toBe(2);
  });

});
