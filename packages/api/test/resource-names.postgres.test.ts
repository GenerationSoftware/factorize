import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resourceName } from "../src/triggers/api/resource-names";
import { triggerInputSchema } from "../src/triggers/api/trigger-schemas";
import { loadingFixture } from "./helpers/loading-fixture";

vi.mock("@cloudflare/workers-oauth-provider", () => ({ OAuthProvider: class {}, AuthorizationError: class extends Error {}, getOAuthApi: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {}, WorkflowEntrypoint: class {}, DurableObject: class {} }));

const eventId = "11111111-1111-4111-8111-111111111111";
describe("Trigger names", () => {
  it("validates Trigger names", () => {
    for (const name of ["a", "9", "code-review", "a".repeat(64)]) {
      expect(resourceName.safeParse(name).success).toBe(true);
      expect(triggerInputSchema.safeParse({ name, eventId }).success).toBe(true);
    }
    for (const name of ["", "manual", "Name", "two words", "old_key", "-start", "end-", "two--hyphens", "a".repeat(65)]) {
      expect(resourceName.safeParse(name).success, name).toBe(false);
      expect(triggerInputSchema.safeParse({ name, eventId }).success, name).toBe(false);
    }
  });
});

describe.skipIf(!process.env.AUTH_TEST_DATABASE_URL)("team resource namespace with PostgreSQL", () => {
  let f: Awaited<ReturnType<typeof loadingFixture>>;
  beforeAll(async () => { f = await loadingFixture(process.env.AUTH_TEST_DATABASE_URL!); });
  afterAll(async () => { await f?.cleanup(); });
  const addTrigger = async (name: string, tenantId = f.tenantId) => {
    const id = crypto.randomUUID(), event = crypto.randomUUID();
    await f.db.pool.query("INSERT INTO app.event_definitions(tenant_id,id,name,current_revision) VALUES($1,$2,$3,1)", [tenantId,event,`event-${id}`]);
    await f.db.pool.query("INSERT INTO app.event_definition_revisions(tenant_id,definition_id,revision) VALUES($1,$2,1)", [tenantId,event]);
    return f.db.pool.query("INSERT INTO app.triggers(tenant_id,id,event_definition_id,name,slug) VALUES($1,$2,$3,$4,$4) RETURNING id", [tenantId,id,event,name]);
  };
  it("serializes concurrent Trigger creates and isolates teams", async () => {
    const results = await Promise.allSettled([addTrigger("racing-name"), addTrigger("racing-name")]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    expect((await f.db.pool.query("SELECT * FROM app.resource_names WHERE tenant_id=$1 AND name='racing-name'", [f.tenantId])).rows).toHaveLength(1);
    await expect(addTrigger("racing-name", f.otherTenant)).resolves.toBeDefined();
  });
  it("rejects colliding renames atomically and releases deleted names", async () => {
    await addTrigger("occupied-name");
    const id = (await addTrigger("original-name")).rows[0].id;
    await expect(f.db.pool.query("UPDATE app.triggers SET name='occupied-name' WHERE tenant_id=$1 AND id=$2", [f.tenantId,id])).rejects.toMatchObject({ code: "23505" });
    expect((await f.db.pool.query("SELECT name FROM app.triggers WHERE tenant_id=$1 AND id=$2", [f.tenantId,id])).rows[0].name).toBe("original-name");
    await f.db.pool.query("DELETE FROM app.triggers WHERE tenant_id=$1 AND id=$2", [f.tenantId,id]);
    await expect(addTrigger("original-name")).resolves.toBeDefined();
  });
});
