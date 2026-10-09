import { readFile, readdir } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Database } from "../src/postgres/database";
import { JobSummaryRepository } from "../src/postgres/job-summary-repository";
import { PostgresJobRepository, StaleJobEdit } from "../src/postgres/job-repository";
import { jobSummaryPage, jobSelectorPage } from "../src/job-contracts";

const url = process.env.AUTH_TEST_DATABASE_URL;
describe.skipIf(!url)("bounded job reads and conditional editing (PostgreSQL)", () => {
  let db: Database, admin: Database;
  const name = `summaries_test_${crypto.randomUUID().replaceAll("-", "")}`;
  const tenant = crypto.randomUUID(), other = crypto.randomUUID();
  beforeAll(async () => {
    admin = new Database({ connectionString: url });
    await admin.pool.query(`CREATE DATABASE ${name}`);
    const address = new URL(url!); address.pathname = `/${name}`;
    db = new Database({ connectionString: address.toString(), maxUses: Infinity });
    const directory = new URL("../migrations/", import.meta.url);
    for (const file of (await readdir(directory)).filter(f => f.endsWith(".sql")).sort()) await db.pool.query(await readFile(new URL(file, directory), "utf8"));
    await db.pool.query("INSERT INTO app.tenants(id) VALUES ($1),($2)", [tenant, other]);
    await db.pool.query(`INSERT INTO app.jobs(tenant_id,id,name,slug,encrypted_prompt_template,execution_target,concurrency_limit)
      SELECT $1,md5(i::text)::uuid,'Job '||i,'job-'||i,repeat('p',50000),'{"connectionId":"local","agentKind":"codex","workspace":"ephemeral","cwd":"/home/exedev/workspace"}'::jsonb,1 FROM generate_series(1,205) i`, [tenant]);
    await db.pool.query(`INSERT INTO app.jobs(tenant_id,id,name,slug,encrypted_prompt_template,execution_target,concurrency_limit)
      VALUES ($1,md5('1')::uuid,'Private Job','private-job','secret','{}',1)`, [other]);
  });
  afterAll(async () => { if (db) { await db.pool.query("DELETE FROM app.tenants WHERE id=ANY($1::uuid[])", [[tenant, other]]); await db.close(); } if (admin) { await admin.pool.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`); await admin.close(); } });
  it("pages without gaps/duplicates, omits editor data, and stays at one data query per page", async () => {
    const repo = new JobSummaryRepository(db, tenant), query = vi.spyOn(db.pool, "query");
    try {
      const ids: string[] = [];
      let cursor: string | undefined;
      do {
        query.mockClear();
        const page = await repo.page({ limit: 30, q: "", cursor });
        expect(query).toHaveBeenCalledTimes(1);
        expect(jobSummaryPage.safeParse(page).success).toBe(true);
        expect(page.items.length).toBeLessThanOrEqual(30);
        expect(JSON.stringify(page)).not.toMatch(/prompt|trigger|secret/);
        expect(JSON.stringify(page).length).toBeLessThan(16000);
        ids.push(...page.items.map(item => item.id)); cursor = page.nextCursor ?? undefined;
      } while (cursor);
      expect(ids.length).toBe(205); expect(new Set(ids).size).toBe(205);
      expect(ids).toEqual([...ids].sort().reverse());
    } finally { query.mockRestore(); }
  });
  it("searches literal case-insensitive names/slugs and bounds selector data", async () => {
    const repo = new JobSummaryRepository(db, tenant);
    const page = await repo.page({ limit: 3, q: "JOB-20" }, true);
    expect(jobSelectorPage.safeParse(page).success).toBe(true);
    expect(page.items).toHaveLength(3); expect(page.nextCursor).not.toBeNull();
    expect(page.items.every(item => item.slug.startsWith("job-20"))).toBe(true);
    expect((await repo.page({ limit: 100, q: "%" })).items).toHaveLength(0);
    expect((await repo.page({ limit: 100, q: "", enabled: "false" })).items).toHaveLength(0);
    expect((await new JobSummaryRepository(db, other).page({ limit: 100, q: "" })).items).toHaveLength(1);
  });
  it("compares configuration timestamps under lock: one concurrent writer wins, legacy writes still work", async () => {
    const repo = new PostgresJobRepository(db, tenant, async v => v, async v => v);
    const [item] = (await new JobSummaryRepository(db, tenant).page({ limit: 1, q: "" })).items;
    const job = (await repo.getJob(item!.id))!;
    const results = await Promise.allSettled([repo.update({ ...job, name: "Edit A" }, job.updatedAt), repo.update({ ...job, name: "Edit B" }, job.updatedAt)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(r => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(StaleJobEdit);
    const current = (await repo.getJob(job.id))!;
    expect(Date.parse(current.updatedAt)).toBeGreaterThan(Date.parse(job.updatedAt));
    await expect(repo.update({ ...current, name: "Legacy update" })).resolves.toMatchObject({ name: "Legacy update" });
    const beforeToggle = (await repo.getJob(job.id))!;
    await expect(repo.setEnabled(job.id, false, beforeToggle.updatedAt)).resolves.toBe(true);
    await expect(repo.update({ ...beforeToggle, name: "Stale after toggle" }, beforeToggle.updatedAt)).rejects.toBeInstanceOf(StaleJobEdit);
    expect(await new PostgresJobRepository(db, other, async v => v, async v => v).getJob(job.id)).toBeNull();
  });
});
