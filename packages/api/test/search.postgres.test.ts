import { readFile, readdir } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Database } from "../src/postgres/database";
import { OperationsRepository } from "../src/postgres/operations-repository";

const url = process.env.AUTH_TEST_DATABASE_URL;

describe.skipIf(!url)("global search trigram matching (PostgreSQL)", () => {
  let db: Database, admin: Database;
  const databaseName = `search_test_${crypto.randomUUID().replaceAll("-", "")}`;
  const tenant = crypto.randomUUID(), otherTenant = crypto.randomUUID();
  const job = crypto.randomUUID(), otherJob = crypto.randomUUID();
  const run = crypto.randomUUID(), typoRun = crypto.randomUUID(), privateRun = crypto.randomUUID();
  const invocation = crypto.randomUUID(), typoInvocation = crypto.randomUUID(), privateInvocation = crypto.randomUUID();
  const trigger = crypto.randomUUID(), typoTrigger = crypto.randomUUID(), privateTrigger = crypto.randomUUID();

  beforeAll(async () => {
    admin = new Database({ connectionString: url });
    await admin.pool.query(`CREATE DATABASE ${databaseName}`);
    const address = new URL(url!); address.pathname = `/${databaseName}`;
    db = new Database({ connectionString: address.toString(), maxUses: Infinity });
    const directory = new URL("../migrations/", import.meta.url);
    for (const file of (await readdir(directory)).filter(file => file.endsWith(".sql")).sort()) await db.pool.query(await readFile(new URL(file, directory), "utf8"));

    await db.pool.query("INSERT INTO app.tenants(id) VALUES ($1),($2)", [tenant, otherTenant]);
    await db.pool.query(`INSERT INTO app.jobs(tenant_id,id,name,slug,encrypted_prompt_template,execution_target,concurrency_limit)
      VALUES ($1,$2,'Deployment Automation','deployment-automation','prompt','{}',1),($3,$4,'Private Deployment','private-deployment','prompt','{}',1)`, [tenant, job, otherTenant, otherJob]);
    await db.pool.query(`INSERT INTO app.triggers(tenant_id,id,job_id,kind,slug) VALUES
      ($1,$2,$3,'manual','search'),($1,$4,$3,'manual','search-typo'),($5,$6,$7,'manual','search')`, [tenant, trigger, job, typoTrigger, otherTenant, privateTrigger, otherJob]);
    await db.pool.query(`INSERT INTO app.invocations(tenant_id,id,job_id,source,claim_key,trigger_id,context) VALUES
      ($1,$2,$3,'manual','search',$4,'{}'),($1,$5,$3,'manual','search-typo',$6,'{}'),($7,$8,$9,'manual','search',$10,'{}')`, [tenant, invocation, job, trigger, typoInvocation, typoTrigger, otherTenant, privateInvocation, otherJob, privateTrigger]);
    await db.pool.query(`INSERT INTO app.runs(tenant_id,id,job_id,invocation_id,provider,issue_id,issue_title,run_name,agent_name,state)
      VALUES ($1,$2,$3,$4,'manual','GEN-2157','Fix punctuation in issue identifiers','Deploy GEN-2157','codex','succeeded'),
             ($1,$5,$3,$6,'manual','GEN-2158','A nearby but weaker identifier','Deploy GEN-2158','codex','succeeded'),
             ($7,$8,$9,$10,'manual','GEN-2157','Private issue','Private GEN-2157','codex','succeeded')`, [tenant, run, job, invocation, typoRun, typoInvocation, otherTenant, privateRun, otherJob, privateInvocation]);
    await db.pool.query(`INSERT INTO app.run_trace_events(tenant_id,run_id,sequence,id,event_type,title,preview_text)
      VALUES ($1,$2,1,'trace-search','assistant_message','Rollback summary','The rollback completed successfully')`, [tenant, run]);
  });

  afterAll(async () => {
    await db?.close();
    await admin?.pool.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    await admin?.close();
  });

  it("matches missing punctuation and keeps exact identifiers ahead of weaker trigrams", async () => {
    const items = (await new OperationsRepository(db, tenant).search("GEN2157")).items;
    expect(items.filter(item => item.kind === "run").map(item => item.id)).toContain(run);
    const exact = (await new OperationsRepository(db, tenant).search("GEN-2157")).items.filter(item => item.kind === "run");
    expect(exact[0]?.id).toBe(run);
  });

  it("matches a representative job-name typo without substring filtering", async () => {
    const items = (await new OperationsRepository(db, tenant).search("deplyment")).items;
    expect(items.some(item => item.kind === "job" && item.id === job)).toBe(true);
  });

  it("excludes unrelated rows and preserves tenant isolation", async () => {
    expect((await new OperationsRepository(db, tenant).search("zzzz-unrelated")).items).toEqual([]);
    const items = (await new OperationsRepository(db, tenant).search("GEN2157")).items;
    expect(items.every(item => item.id !== privateRun)).toBe(true);
  });

  it("keeps trace full-text search available", async () => {
    const items = (await new OperationsRepository(db, tenant).search("rollback")).items;
    expect(items).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "trace", id: "trace-search" })]));
  });
});
