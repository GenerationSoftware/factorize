import { readFile, readdir } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Database } from "../src/postgres/database";
import { TriggerSummaryRepository } from "../src/postgres/job-summary-repository";
import { PostgresTriggerRepository, StaleTriggerEdit } from "../src/postgres/job-repository";
import { triggerSummaryPage, triggerSelectorPage } from "../src/job-contracts";

const url = process.env.AUTH_TEST_DATABASE_URL;
const uuidPattern = /^[0-9a-f-]{36}$/i;
describe.skipIf(!url)("bounded trigger reads and conditional editing (PostgreSQL)", () => {
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
    await db.pool.query("INSERT INTO app.projects(tenant_id,id,name) VALUES ($1,md5(($1::uuid)::text || ':default')::uuid,'Default'),($2,md5(($2::uuid)::text || ':default')::uuid,'Default')", [tenant, other]);
    await db.pool.query(`INSERT INTO app.triggers(tenant_id,id,project_id,name,slug,encrypted_prompt,execution_config,concurrency_limit)
      SELECT $1,md5(i::text)::uuid,md5(($1::uuid)::text || ':default')::uuid,'Trigger '||i,'trigger-'||i,repeat('p',50000),'{"connectionId":"local","agentKind":"codex","workspace":"ephemeral","cwd":"/home/exedev/workspace"}'::jsonb,1 FROM generate_series(1,205) i`, [tenant]);
    const lateTrigger = "00000000-0000-4000-8000-000000000001", event = "00000000-0000-4000-8000-000000000002", invocation = "00000000-0000-4000-8000-000000000003", run = "00000000-0000-4000-8000-000000000004";
    await db.pool.query(`INSERT INTO app.triggers(tenant_id,id,project_id,name,slug,encrypted_prompt,execution_config,concurrency_limit) VALUES ($1,$2,md5(($1::uuid)::text || ':default')::uuid,'Zulu active','zulu-active','prompt','{"connectionId":"local","agentKind":"codex"}',1)`, [tenant, lateTrigger]);
    await db.pool.query(`INSERT INTO app.triggers(tenant_id,id,project_id,name,slug,encrypted_prompt,execution_config,concurrency_limit)
      VALUES ($1,'00000000-0000-4000-8000-000000000010',md5(($1::uuid)::text || ':default')::uuid,'apple','apple-lower','prompt','{"agentKind":"codex"}',1),
        ($1,'00000000-0000-4000-8000-000000000011',md5(($1::uuid)::text || ':default')::uuid,'Apple','apple-upper','prompt','{"agentKind":"codex"}',1),
        ($1,'00000000-0000-4000-8000-000000000012',md5(($1::uuid)::text || ':default')::uuid,'Ápple','apple-accent','prompt','{"agentKind":"codex"}',1)`, [tenant]);
    await db.pool.query("UPDATE app.triggers SET name='tie-'||left(id::text,8) WHERE tenant_id=$1 AND id IN (md5('204')::uuid,md5('205')::uuid)", [tenant]);
    await db.pool.query("INSERT INTO app.events(tenant_id,id,trigger_id,kind,slug) VALUES ($1,$2,$3,'manual','manual')", [tenant, event, lateTrigger]);
    await db.pool.query("INSERT INTO app.invocations(tenant_id,id,trigger_id,source,claim_key,event_id,context) VALUES ($1,$2,$3,'manual','test',$4,'{}')", [tenant, invocation, lateTrigger, event]);
    await db.pool.query("INSERT INTO app.trigger_runs(tenant_id,id,trigger_id,invocation_id,state,encrypted_prompt) VALUES ($1,$2,$3,$4,'running','prompt')", [tenant, run, lateTrigger, invocation]);
    await db.pool.query(`INSERT INTO app.triggers(tenant_id,id,project_id,name,slug,encrypted_prompt,execution_config,concurrency_limit)
      VALUES ($1,md5('1')::uuid,md5(($1::uuid)::text || ':default')::uuid,'Private Trigger','private-trigger','secret','{}',1)`, [other]);
  });
  afterAll(async () => { if (db) { await db.pool.query("DELETE FROM app.tenants WHERE id=ANY($1::uuid[])", [[tenant, other]]); await db.close(); } if (admin) { await admin.pool.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`); await admin.close(); } });
  it("pages without gaps/duplicates, omits editor data, and stays at one data query per page", async () => {
    const repo = new TriggerSummaryRepository(db, tenant), query = vi.spyOn(db.pool, "query");
    try {
      const ids: string[] = [];
      let cursor: string | undefined;
      do {
        query.mockClear();
        const page = await repo.page({ limit: 30, q: "", cursor });
        expect(query).toHaveBeenCalledTimes(1);
        expect(triggerSummaryPage.safeParse(page).success).toBe(true);
        expect(page.items.length).toBeLessThanOrEqual(30);
        expect(JSON.stringify(page)).not.toMatch(/prompt|event|secret/);
        expect(JSON.stringify(page).length).toBeLessThan(16000);
        ids.push(...page.items.map(item => item.id)); cursor = page.nextCursor ?? undefined;
      } while (cursor);
      expect(ids.length).toBe(209); expect(new Set(ids).size).toBe(209);
      expect(ids).toEqual([...ids].sort().reverse());
    } finally { query.mockRestore(); }
  });
  it("orders active, running, and title pages with stable full-tuple cursors", async () => {
    const repo = new TriggerSummaryRepository(db, tenant);
    const active = await repo.page({ limit: 30, q: "", sort: "active" });
    expect(active.items[0]).toMatchObject({ name: "Zulu active", runningCount: 1 });
    expect(active.nextCursor).not.toMatch(uuidPattern);
    for (const [sort, direction] of [["running", "asc"], ["running", "desc"], ["title", "asc"], ["title", "desc"], ["active", "desc"]] as const) {
      const ids: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await repo.page({ limit: 30, q: "", sort, direction, cursor });
        ids.push(...page.items.map(item => item.id)); cursor = page.nextCursor ?? undefined;
      } while (cursor);
      expect(ids).toHaveLength(209); expect(new Set(ids).size).toBe(209);
      if (sort === "title" && direction === "asc") {
        expect(ids.slice(0, 3)).toEqual(["00000000-0000-4000-8000-000000000010", "00000000-0000-4000-8000-000000000011", "00000000-0000-4000-8000-000000000012"]);
        const tieIds = (await db.pool.query<{ id: string }>("SELECT id FROM app.triggers WHERE tenant_id=$1 AND name LIKE 'tie-%'", [tenant])).rows.map(row => row.id);
        expect(ids.filter(id => tieIds.includes(id))).toEqual([...tieIds].sort());
      }
    }
    const first = await repo.page({ limit: 2, q: "", sort: "running", direction: "asc" });
    await expect(repo.page({ limit: 2, q: "", sort: "running", direction: "desc", cursor: first.nextCursor! })).rejects.toThrow(/Invalid trigger summary cursor/);
    await expect(repo.page({ limit: 2, q: "", sort: "title", cursor: first.nextCursor! })).rejects.toThrow(/Invalid trigger summary cursor/);
  });
  it("searches literal case-insensitive names/slugs and bounds selector data", async () => {
    const repo = new TriggerSummaryRepository(db, tenant);
    const page = await repo.page({ limit: 3, q: "TRIGGER-20" }, true);
    expect(triggerSelectorPage.safeParse(page).success).toBe(true);
    expect(page.items).toHaveLength(3); expect(page.nextCursor).not.toBeNull();
    const matches=(await db.pool.query<{id:string}>("SELECT id FROM app.triggers WHERE tenant_id=$1 AND slug LIKE 'trigger-20%'",[tenant])).rows.map(row=>row.id);
    expect(page.items.every(item => matches.includes(item.id))).toBe(true);
    expect(page.items[0]).not.toHaveProperty("slug");
    expect((await repo.page({ limit: 100, q: "%" })).items).toHaveLength(0);
    expect((await repo.page({ limit: 100, q: "", enabled: "false" })).items).toHaveLength(0);
    expect((await new TriggerSummaryRepository(db, other).page({ limit: 100, q: "" })).items).toHaveLength(1);
  });
  it("compares configuration timestamps under lock: one concurrent writer wins, legacy writes still work", async () => {
    const repo = new PostgresTriggerRepository(db, tenant, async v => v, async v => v);
    const [item] = (await new TriggerSummaryRepository(db, tenant).page({ limit: 1, q: "" })).items;
    const trigger = (await repo.getTrigger(item!.id))!;
    const results = await Promise.allSettled([repo.update({ ...trigger, name: "Edit A" }, trigger.updatedAt), repo.update({ ...trigger, name: "Edit B" }, trigger.updatedAt)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(r => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(StaleTriggerEdit);
    const current = (await repo.getTrigger(trigger.id))!;
    expect(Date.parse(current.updatedAt)).toBeGreaterThan(Date.parse(trigger.updatedAt));
    await expect(repo.update({ ...current, name: "Legacy update" })).resolves.toMatchObject({ name: "Legacy update" });
    const beforeToggle = (await repo.getTrigger(trigger.id))!;
    await expect(repo.setEnabled(trigger.id, false, beforeToggle.updatedAt)).resolves.toBe(true);
    await expect(repo.update({ ...beforeToggle, name: "Stale after toggle" }, beforeToggle.updatedAt)).rejects.toBeInstanceOf(StaleTriggerEdit);
    expect(await new PostgresTriggerRepository(db, other, async v => v, async v => v).getTrigger(trigger.id)).toBeNull();
  });
});
