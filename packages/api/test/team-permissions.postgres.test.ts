import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { loadingFixture } from "./helpers/loading-fixture";
import worker from "../src/worker";

vi.mock("cloudflare:workers", () => ({
  WorkerEntrypoint: class {}, WorkflowEntrypoint: class {}, DurableObject: class {},
}));
vi.mock("@cloudflare/workers-oauth-provider", () => ({
  OAuthProvider: class {}, AuthorizationError: class extends Error {}, getOAuthApi: vi.fn(),
}));

const database = process.env.AUTH_TEST_DATABASE_URL;
describe.skipIf(!database)("team consent defaults", () => {
  it("migrates the previous default without mutating grants and edits the two-state workspace list through the API", async () => {
    const f = await loadingFixture(database!);
    try {
      const saved = crypto.randomUUID(), other = crypto.randomUUID();
      await f.db.pool.query(`INSERT INTO app.agent_integrations(tenant_id,id,kind,credential_id,name,available,policy)
        VALUES($1,$2,'linear','saved','Saved',true,'baseline'),($1,$3,'linear','other','Other',true,'requestable')`,[f.tenantId,saved,other]);
      await f.db.pool.query(`INSERT INTO app.permission_presets(tenant_id,id,name,scopes,is_default)
        VALUES($1,gen_random_uuid(),'Selected',$2,true),($1,gen_random_uuid(),'Not selected',ARRAY['team:write'],false)`,
        [f.tenantId,["triggers:read","integration:"+saved+":1"]]);
      const block = JSON.stringify({[saved]: false});
      await f.db.pool.query(`INSERT INTO app.agent_identities(tenant_id,kind,subject,user_id,session_version,integration_overrides)
        VALUES($1,'oauth','old-grant',$2,$3,$4)`,[f.tenantId,f.userId,f.auth.sessionVersion,block]);
      await f.db.pool.query("DROP TABLE app.team_permission_defaults");
      await f.db.pool.query(await readFile(new URL("../migrations/0111_team_permission_defaults.sql",import.meta.url),"utf8"));
      const api = (method: string, body?: unknown) => worker.fetch(new Request(f.env.APP_ORIGIN + "/api/v1/team-permissions", {
        method, headers: { Cookie:f.cookie, Origin:f.env.APP_ORIGIN, "Content-Type":"application/json" },
        body: body ? JSON.stringify(body) : undefined,
      }), f.env, {} as ExecutionContext);
      const list = await api("GET");
      expect(list.status).toBe(200);
      expect(await list.json()).toEqual(expect.arrayContaining([
        expect.objectContaining({scope:"triggers:read",isDefault:true}), expect.objectContaining({scope:"team:write",isDefault:false}),
        expect.objectContaining({scope:"integration:"+saved+":1",isDefault:true,preferenceSet:true}),
        expect.objectContaining({scope:"integration:"+other+":1",isDefault:false,preferenceSet:true}),
      ]));
      const fresh = crypto.randomUUID();
      await f.db.pool.query(`INSERT INTO app.agent_integrations(tenant_id,id,kind,credential_id,name,available)
        VALUES($1,$2,'linear','fresh','Fresh',true)`,[f.tenantId,fresh]);
      const scope = "integration:"+fresh+":1";
      expect(await (await api("GET")).json()).toEqual(expect.arrayContaining([expect.objectContaining({scope,preferenceSet:false})]));
      expect((await api("PUT",{scope,isDefault:false})).status).toBe(200);
      expect(await (await api("GET")).json()).toEqual(expect.arrayContaining([expect.objectContaining({scope,preferenceSet:true,isDefault:false})]));
      expect((await api("PUT",{scope,isDefault:true})).status).toBe(200);
      expect((await f.db.pool.query("SELECT policy FROM app.agent_integrations WHERE id=$1",[fresh])).rows[0].policy).toBe("requestable");
      expect((await f.db.pool.query("SELECT integration_overrides FROM app.agent_identities WHERE subject='old-grant'")).rows[0].integration_overrides).toEqual({[saved]:false});
    } finally { await f.cleanup(); }
  });
});
