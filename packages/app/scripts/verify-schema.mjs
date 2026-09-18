import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const client = new pg.Client({ connectionString: databaseUrl, ssl: databaseUrl.includes("localhost") ? undefined : { rejectUnauthorized: false } });
const ids = {
  tenantA: "10000000-0000-4000-8000-000000000001", tenantB: "10000000-0000-4000-8000-000000000002",
  jobA: "20000000-0000-4000-8000-000000000001", jobB: "20000000-0000-4000-8000-000000000002",
  triggerA: "30000000-0000-4000-8000-000000000001", invocationA: "40000000-0000-4000-8000-000000000001",
  runA: "50000000-0000-4000-8000-000000000001", executionA: "60000000-0000-4000-8000-000000000001",
};

await client.connect();
try {
  await client.query("BEGIN");
  await client.query("INSERT INTO app.tenants(id) VALUES ($1),($2)", [ids.tenantA, ids.tenantB]);
  await client.query("INSERT INTO app.jobs(tenant_id,id,name,slug,encrypted_prompt_template,execution_target,concurrency_limit) VALUES ($1,$2,'A','same-slug','cipher','{}',1),($3,$4,'B','same-slug','cipher','{}',1)", [ids.tenantA, ids.jobA, ids.tenantB, ids.jobB]);
  await client.query("INSERT INTO app.triggers(tenant_id,id,job_id,kind,slug) VALUES ($1,$2,$3,'manual','manual')", [ids.tenantA, ids.triggerA, ids.jobA]);
  await client.query("INSERT INTO app.invocations(tenant_id,id,job_id,source,claim_key,trigger_id,context) VALUES ($1,$2,$3,'manual','claim:one',$4,'{}')", [ids.tenantA, ids.invocationA, ids.jobA, ids.triggerA]);
  const duplicate = await client.query("INSERT INTO app.invocations(tenant_id,id,job_id,source,claim_key,trigger_id,context) VALUES ($1,gen_random_uuid(),$2,'manual','claim:one',$3,'{}') ON CONFLICT (tenant_id,job_id,claim_key) DO NOTHING", [ids.tenantA, ids.jobA, ids.triggerA]);
  if (duplicate.rowCount !== 0) throw new Error("invocation deduplication constraint failed");
  await client.query("INSERT INTO app.job_runs(tenant_id,id,job_id,invocation_id,state,encrypted_prompt) VALUES ($1,$2,$3,$4,'queued','cipher')", [ids.tenantA, ids.runA, ids.jobA, ids.invocationA]);
  await client.query("INSERT INTO app.runs(tenant_id,id,job_id,invocation_id,provider,issue_id,agent_name,state) VALUES ($1,$2,$3,$4,'linear','GEN-2113','codex','running')", [ids.tenantA, ids.executionA, ids.jobA, ids.invocationA]);
  await client.query("INSERT INTO app.run_artifacts(tenant_id,run_id,id,kind,object_key,provider,format,byte_size,sha256,state) VALUES ($1,$2,gen_random_uuid(),'native_session','tenants/a/runs/one/native/session.jsonl','codex','jsonl',10,$3,'stored')", [ids.tenantA, ids.executionA, "a".repeat(64)]);
  await client.query("INSERT INTO app.run_trace_events(tenant_id,run_id,sequence,id,event_type,title,preview_text) VALUES ($1,$2,1,'event-1','assistant_message','Assistant','postgres durable orchestration')", [ids.tenantA, ids.executionA]);
  const search = await client.query("SELECT run_id FROM app.run_trace_events WHERE tenant_id=$1 AND search_vector @@ plainto_tsquery('english',$2)", [ids.tenantA, "orchestration"]);
  if (search.rowCount !== 1) throw new Error("tenant-scoped full-text search failed");
  let isolated = false;
  await client.query("SAVEPOINT cross_tenant");
  try {
    await client.query("INSERT INTO app.triggers(tenant_id,id,job_id,kind,slug) VALUES ($1,gen_random_uuid(),$2,'manual','invalid')", [ids.tenantA, ids.jobB]);
  } catch (error) {
    if (error.code !== "23503") throw error;
    isolated = true;
    await client.query("ROLLBACK TO SAVEPOINT cross_tenant");
  }
  if (!isolated) throw new Error("cross-tenant foreign key was accepted");
  await client.query("INSERT INTO app.wake_hints(not_before) VALUES (now()) ON CONFLICT (key) DO UPDATE SET not_before=excluded.not_before");
  if (!(await client.query("SELECT app.next_wake_at() wake")).rows[0]?.wake) throw new Error("next wake calculation failed");
  console.log("schema verification passed");
} finally {
  await client.query("ROLLBACK").catch(() => undefined);
  await client.end();
}
