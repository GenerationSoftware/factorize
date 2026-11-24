import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadingFixture } from "./helpers/loading-fixture";

describe.skipIf(!process.env.AUTH_TEST_DATABASE_URL)("team Skills purge", () => {
  let fixture: Awaited<ReturnType<typeof loadingFixture>>;
  beforeAll(async () => { fixture = await loadingFixture(process.env.AUTH_TEST_DATABASE_URL!); });
  afterAll(async () => { await fixture?.cleanup(); });

  it("preserves Skills until the explicit purge, then removes stored copies and preserves Triggers", async () => {
    const { db, tenantId, seedEventTrigger, otherTenant } = fixture;
    const { triggerId, definitionId } = await seedEventTrigger();
    const backfill = await db.pool.query("SELECT tenant_id FROM app.skill_library_backfill WHERE tenant_id=$1", [otherTenant]);
    expect(backfill.rowCount).toBe(0);
    await db.pool.query(
      "INSERT INTO app.skills(tenant_id,id,key,encrypted_body) VALUES ($1,$2,'old-skill','stored-fixture')",
      [tenantId, crypto.randomUUID()],
    );
    await db.pool.query(
      "INSERT INTO app.skill_content_cache(tenant_id,repository,commit_sha,encrypted_content) VALUES ($1,'repo','commit','cached-fixture')",
      [tenantId],
    );
    const purge = await readFile(new URL("../scripts/purge-team-skills.sql", import.meta.url), "utf8");
    await db.pool.query(purge);
    await db.pool.query(purge);
    const tables = await db.pool.query("SELECT tablename FROM pg_tables WHERE schemaname='app' AND tablename LIKE '%skill%'");
    expect(tables.rows).toEqual([]);
    const names = await db.pool.query("SELECT kind FROM app.resource_names WHERE tenant_id=$1", [tenantId]);
    expect(names.rows).toEqual([{ kind: "trigger" }]);
    const trigger = await db.pool.query("UPDATE app.triggers SET name='old-skill' WHERE tenant_id=$1 AND id=$2 RETURNING event_definition_id", [tenantId, triggerId]);
    expect(trigger.rows).toEqual([{ event_definition_id: definitionId }]);
  });
});
