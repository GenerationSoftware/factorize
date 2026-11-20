import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { loadingFixture } from "./helpers/loading-fixture";
import { AuthRepository } from "../src/postgres/auth-repository";
import { protectedApiFetch } from "../src/protected-api";
import { usernameSchema } from "../src/usernames";
vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {}, DurableObject: class {} }));
vi.mock("@cloudflare/workers-oauth-provider", () => ({ OAuthProvider: class {}, AuthorizationError: class extends Error {}, getOAuthApi: vi.fn() }));
describe.skipIf(!process.env.AUTH_TEST_DATABASE_URL)("usernames and profile", () => {
  let f: Awaited<ReturnType<typeof loadingFixture>>, repo: AuthRepository;
  beforeAll(async () => { f = await loadingFixture(process.env.AUTH_TEST_DATABASE_URL!); Object.assign(f.env, { POSTMARK_SERVER_TOKEN:"local", POSTMARK_FROM_EMAIL:"accounts@example.test", POSTMARK_MESSAGE_STREAM:"outbound" }); repo = new AuthRepository(f.db, f.env); });
  afterAll(async () => { await f?.cleanup(); });
  afterEach(() => vi.unstubAllGlobals());
  it("requires usernames, normalizes case, and supports both password identifiers", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ErrorCode:0 })));
    const email="alice@example.test", password="local password for tests";
    expect((await repo.signup({email,password})).status).toBe(400);
    for (const value of ["ab","a".repeat(40),"-abc","abc-","ab--cd","ab_cd","a.b"]) expect(usernameSchema.safeParse(value).success).toBe(false);
    expect((await repo.signup({email,password,username:"Alice-Smith"})).status).toBe(201);
    await f.db.pool.query("UPDATE app.auth_users SET email_verified=true WHERE email=$1",[email]);
    expect((await repo.login({email:"ALICE-SMITH",password})).status).toBe(200);
    expect((await repo.login({email,password})).status).toBe(200);
    expect((await repo.signup({email:"other@example.test",password,username:"alice-smith"})).status).toBe(409);
  });
  it("authorizes profile changes, validates input, and arbitrates concurrent claims", async () => {
    const request = (body:unknown,cookie=f.cookie) => protectedApiFetch(new Request(f.env.APP_ORIGIN+"/api/v1/profile", {method:"PUT",headers:{Origin:f.env.APP_ORIGIN,Cookie:cookie,"Content-Type":"application/json"},body:JSON.stringify(body)}),f.env,null,{} as ExecutionContext);
    expect((await request({username:"valid-name"},"")).status).toBe(401);
    expect((await request({username:"bad_name"})).status).toBe(400);
    expect((await request({username:"New-Owner"})).status).toBe(200);
    expect(await repo.profile(f.userId)).toMatchObject({username:"new-owner"});
    expect((await f.db.pool.query("SELECT name FROM app.tenants WHERE id=$1",[f.tenantId])).rows[0].name).toBe("new-owner");
    await f.db.pool.query("UPDATE app.tenants SET name='cannot-edit' WHERE id=$1",[f.tenantId]);
    expect((await f.db.pool.query("SELECT name FROM app.tenants WHERE id=$1",[f.tenantId])).rows[0].name).toBe("new-owner");
    const other=crypto.randomUUID();
    await f.db.pool.query("INSERT INTO app.auth_users(id,email,email_verified) VALUES($1,'claim@example.test',true)",[other]);
    const results=await Promise.all([repo.updateProfile(f.userId,"shared-name"),repo.updateProfile(other,"shared-name")]);
    expect(results.map(r=>r.status).sort()).toEqual([200,409]);
    expect((await f.db.pool.query("SELECT t.name,u.username FROM app.tenants t JOIN app.auth_users u ON u.id=t.personal_owner_id WHERE t.id=$1",[f.tenantId])).rows[0]).toEqual({name:(await repo.profile(f.userId))!.username,username:(await repo.profile(f.userId))!.username});
    expect((await f.db.pool.query("SELECT count(*) FROM app.auth_users WHERE username='shared-name'")).rows[0].count).toBe("1");
  });
  it("backfills migration prefixes and diagnoses invalid/colliding values", async () => {
    const sql=await readFile(new URL("../migrations/0080_usernames.sql",import.meta.url),"utf8");
    // Test the real migration against an isolated shadow schema in a rolled-back transaction.
    const client=await f.db.pool.connect();
    try {
      for (const [emails,expected] of [[["Legacy@one.test"],"legacy"],[["bad_name@one.test"],"not a valid username"],[["same@one.test","same@two.test"],"duplicate email prefixes"]] as const) {
        await client.query("BEGIN");
        await client.query("CREATE SCHEMA username_migration; CREATE TABLE username_migration.auth_users(id uuid DEFAULT gen_random_uuid(),email text); CREATE TABLE username_migration.schema_migrations(version text PRIMARY KEY)");
        for(const email of emails)await client.query("INSERT INTO username_migration.auth_users(email) VALUES($1)",[email]);
        try {
          await client.query(sql.replaceAll("app.","username_migration."));
          expect((await client.query("SELECT username FROM username_migration.auth_users")).rows[0].username).toBe(expected);
        } catch(error:any) { expect(error.message).toContain(expected); }
        await client.query("ROLLBACK");
      }
    } finally { await client.query("ROLLBACK"); client.release(); }
  });
});
