import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadingFixture } from "./helpers/loading-fixture";
import { VmAttachmentRepository } from "../src/postgres/vm-attachment-repository";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {}, DurableObject: class {} }));
vi.mock("@cloudflare/workers-oauth-provider", () => ({ OAuthProvider: class {}, AuthorizationError: class extends Error {}, getOAuthApi: vi.fn() }));

const url = process.env.AUTH_TEST_DATABASE_URL;
describe.skipIf(!url)("VM attachment inventory", () => {
  let fixture: Awaited<ReturnType<typeof loadingFixture>>;
  beforeAll(async () => { fixture = await loadingFixture(url!); });
  afterAll(async () => { await fixture?.cleanup(); });

  it("keeps run access history and scopes reads to the authorizing tenant", async () => {
    const { db, tenantId, runId, userId } = fixture;
    await db.pool.query("UPDATE app.trigger_runs SET state='running' WHERE tenant_id=$1 AND id=$2", [tenantId, runId]);
    await db.pool.query("UPDATE app.runs SET state='running' WHERE tenant_id=$1 AND id=$2", [tenantId, runId]);
    await db.pool.query(`INSERT INTO app.run_authorizations(tenant_id,run_id,user_id,session_version,scopes)
      SELECT tenant_id,$2,user_id,session_version,'[]' FROM app.members WHERE tenant_id=$1 AND user_id=$3
      ON CONFLICT (tenant_id,run_id) DO NOTHING`, [tenantId, runId, userId]);
    await db.pool.query(`INSERT INTO app.vendor_run_identity_bindings
      (tenant_id,run_id,provider,vm_id,issuer,subject,audience,issued_at,expires_at)
      VALUES ($1,$2,'exe.dev',$3,'https://issuer.example','subject','audience',now(),now()+interval '1 hour')`, [tenantId, runId, `fixture-${runId}`]);

    const inventory = new VmAttachmentRepository(db, tenantId);
    expect(await inventory.runs()).toMatchObject([{ sourceId: runId, status: "active" }]);
    expect(await new VmAttachmentRepository(db, crypto.randomUUID()).runs(runId)).toEqual([]);

    await db.pool.query("UPDATE app.vendor_run_identity_bindings SET revoked_at=now() WHERE tenant_id=$1 AND run_id=$2", [tenantId, runId]);
    expect(await inventory.runs()).toEqual([]);
    expect(await inventory.runs(runId)).toMatchObject([{ sourceId: runId, status: "revoked" }]);
  });

  it("isolates delegated grants by OAuth authorization and retains expiry", async () => {
    const { db, tenantId, userId } = fixture;
    const providerId = crypto.randomUUID();
    await db.pool.query(`INSERT INTO app.agent_integrations(tenant_id,id,kind,credential_id,name,available,policy)
      VALUES ($1,$2,'exe','vm-inventory','VM inventory',true,'baseline')`, [tenantId, providerId]);
    const creators = [
      { subject: "fixture-connection-one", offset: "1 hour" },
      { subject: "fixture-connection-two", offset: "-1 hour" },
    ];
    for (const { subject, offset } of creators) {
      const { rows: [parent] } = await db.pool.query(`INSERT INTO app.agent_identities(tenant_id,kind,subject,user_id,session_version)
        SELECT tenant_id,'oauth',$2,user_id,session_version FROM app.members WHERE tenant_id=$1 AND user_id=$3
        RETURNING id`, [tenantId, subject, userId]);
      await db.pool.query(`INSERT INTO app.vm_grants(tenant_id,parent_id,provider_id,provider_epoch,vm,permissions,parent_scopes,request_key,issuer,expires_at)
        SELECT tenant_id,$2,id,epoch,$3,'{}','["proxy:use","vm:grant"]','inventory','https://issuer.example',now()+$4::interval
        FROM app.agent_integrations WHERE tenant_id=$1 AND id=$5`, [tenantId, parent.id, subject, offset, providerId]);
    }
    const inventory = new VmAttachmentRepository(db, tenantId);
    expect(await inventory.clients(userId)).toMatchObject([{ sourceId: creators[0].subject, status: "active" }]);
    expect(await inventory.clients(userId, creators[1].subject)).toMatchObject([{ sourceId: creators[1].subject, status: "expired" }]);
    expect(await inventory.clients(crypto.randomUUID(), creators[0].subject)).toEqual([]);
  });
});
