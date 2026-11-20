import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resourceName } from "../src/resource-names";
import { triggerInputSchema } from "../src/flow-schemas";
import { skillInput } from "../src/skills";
import { loadingFixture } from "./helpers/loading-fixture";
import { protectedApiFetch } from "../src/protected-api";

vi.mock("@cloudflare/workers-oauth-provider", () => ({ OAuthProvider: class {}, AuthorizationError: class extends Error {}, getOAuthApi: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {}, WorkflowEntrypoint: class {}, DurableObject: class {} }));

describe("shared Agent Skills names", () => {
  it("uses the same rules for skills and Triggers and retires slug/description inputs", () => {
    for (const name of ["a", "9", "code-review", "a".repeat(64)]) {
      expect(resourceName.safeParse(name).success).toBe(true);
      expect(skillInput.safeParse({key:name,body:"Instructions"}).success).toBe(true);
      expect(triggerInputSchema.safeParse({name,prompt:"Do work",executionConfigId:"local"}).success).toBe(true);
    }
    for (const name of ["", "manual", "Name", "two words", "old_key", "-start", "end-", "two--hyphens", "a".repeat(65)]) {
      expect(resourceName.safeParse(name).success, name).toBe(false);
      expect(skillInput.safeParse({key:name,body:"Instructions"}).success, name).toBe(false);
      expect(triggerInputSchema.safeParse({name,prompt:"Do work",executionConfigId:"local"}).success, name).toBe(false);
    }
    for (const retired of [{slug:"old"},{description:"Old description"}])
      expect(triggerInputSchema.safeParse({name:"safe",prompt:"Do work",executionConfigId:"local",...retired}).success).toBe(false);
  });
});

describe.skipIf(!process.env.AUTH_TEST_DATABASE_URL)("team resource namespace with PostgreSQL", () => {
  let f: Awaited<ReturnType<typeof loadingFixture>>;
  beforeAll(async () => { f=await loadingFixture(process.env.AUTH_TEST_DATABASE_URL!); });
  afterAll(async () => { await f?.cleanup(); });
  const addTrigger = (name:string, tenant?:string) => f.db.pool.query("INSERT INTO app.triggers(tenant_id,id,name,slug,encrypted_prompt,execution_config,concurrency_limit) VALUES($1,$2,$3,$3,'fixture','{}',1)",[tenant??f.tenantId,crypto.randomUUID(),name]);
  const addSkill = (name:string) => f.db.pool.query("INSERT INTO app.skills(tenant_id,id,key,encrypted_body) VALUES($1,$2,$3,'fixture') RETURNING id",[f.tenantId,crypto.randomUUID(),name]);
  it("serializes concurrent skill/Trigger creates and isolates teams", async () => {
    const results=await Promise.allSettled([addTrigger("racing-name"),addSkill("racing-name")]);
    expect(results.filter(result=>result.status==="fulfilled")).toHaveLength(1);
    expect(results.filter(result=>result.status==="rejected")).toHaveLength(1);
    expect((await f.db.pool.query("SELECT * FROM app.resource_names WHERE tenant_id=$1 AND name='racing-name'",[f.tenantId])).rows).toHaveLength(1);
    await expect(addTrigger("racing-name", f.otherTenant)).resolves.toBeDefined();
  });
  it("rejects colliding renames atomically and releases deleted names", async () => {
    await addTrigger("occupied-name");
    const id=(await addSkill("original-name")).rows[0].id;
    await expect(f.db.pool.query("UPDATE app.skills SET key='occupied-name' WHERE tenant_id=$1 AND id=$2",[f.tenantId,id])).rejects.toMatchObject({code:"23505"});
    expect((await f.db.pool.query("SELECT key FROM app.skills WHERE tenant_id=$1 AND id=$2",[f.tenantId,id])).rows[0].key).toBe("original-name");
    await f.db.pool.query("DELETE FROM app.skills WHERE tenant_id=$1 AND id=$2",[f.tenantId,id]);
    await expect(addTrigger("original-name")).resolves.toBeDefined();
  });
  it("returns a name collision through the authorized API without exposing retired fields", async () => {
    await addSkill("skill-owned");
    const write=(name:string)=>protectedApiFetch(new Request(f.env.APP_ORIGIN+"/api/v1/triggers",{method:"POST",headers:{Cookie:f.cookie,Origin:f.env.APP_ORIGIN,"Content-Type":"application/json"},body:JSON.stringify({name,prompt:"Do work",executionConfigId:"local"})}),f.env,f.auth,{waitUntil() {}} as any);
    expect((await write("skill-owned"))!.status).toBe(409);
    const result=await write("new-trigger");expect(result!.status).toBe(201);
    const value=await result!.json() as any;
    expect(value.name).toBe("new-trigger");expect(value).not.toHaveProperty("slug");expect(value).not.toHaveProperty("description");
  });
});
