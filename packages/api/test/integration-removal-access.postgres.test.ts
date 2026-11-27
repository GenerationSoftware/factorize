import { expect, it } from "vitest";
import { inspectIntegrationAccess, removeIntegrationAccess } from "../src/integrations/application/integration-removal-access";
import { loadingFixture } from "./helpers/loading-fixture";
const url = process.env.AUTH_TEST_DATABASE_URL;

it.skipIf(!url)("subtracts only exact integration access and revokes only dependent provider grants", async () => {
  const f = await loadingFixture(url!);
  try {
    const { tenantId, otherTenant, userId } = f;
    const target = crypto.randomUUID(), other = crypto.randomUUID();
    const removed = "integration:" + target + ":2", old = "integration:" + target + ":1", kept = "integration:" + other + ":2";
    const targetVm = crypto.randomUUID(), otherVm = crypto.randomUUID(), siblingVm = crypto.randomUUID();
    const issuance = crypto.randomUUID(), siblingIssuance = crypto.randomUUID();
    const q = f.db.pool.query.bind(f.db.pool);
    for (const tenant of [tenantId, otherTenant]) {
      await q("INSERT INTO app.agent_integrations (tenant_id,id,kind,credential_id,name,available) VALUES ($1,$2,'exe','target','Target',true),($1,$3,'exe','other','Other',true)", [tenant,target,other]);
      await q("INSERT INTO app.oauth_installations(tenant_id,user_id,id,client_id,display_name,redirect_uri,selected_scopes,active_scopes,legacy_implicit_scopes,policy_revision) VALUES($1,$2,'scope-owner','client-a','Named connection','https://client.test/callback',$3,$4,$5,2),($1,$2,'pending-only','client-b',NULL,'https://client.test/callback','{}','{}','{}',1)", [tenant,userId,["team:read",removed,kept],[removed,kept],[old,kept]]);
      await q("INSERT INTO app.oauth_installation_issuances(id,tenant_id,user_id,installation_id,expected_revision,session_version,selected_scopes,credential_scopes,expires_at) VALUES($1,$2,$3,'pending-only',1,0,$4,$4,now()+interval '10 min')",[tenant === tenantId ? issuance:siblingIssuance,tenant,userId,[removed,kept]]);
      await q("INSERT INTO app.agent_identities(tenant_id,kind,subject,user_id,session_version,scope_overrides,disabled_scopes,integration_overrides) VALUES($1,'oauth','legacy',$2,0,NULL,$3,$4)",[tenant,userId,[old,"team:write",kept],JSON.stringify({[target]:false,[other]:kept})]);
      await q("INSERT INTO app.oauth_legacy_baselines VALUES ($1,$2),($1,$3)",[tenant,old,kept]);
    }
    for (const [tenant,id,provider] of [[tenantId,targetVm,target],[tenantId,otherVm,other],[otherTenant,siblingVm,target]]) {
      await q("INSERT INTO app.vm_permission_grants(tenant_id,id,provider_id,provider_kind,provider_epoch,vm,request_key,scopes,created_by,updated_by) VALUES($1,$2::uuid,$3,'exe',1,$2::text,$2::text,$4,'fixture','fixture')", [tenant,id,provider,[removed,kept]]);
    }

    const preview = await inspectIntegrationAccess(f.db.pool,tenantId,target);
    expect(preview.clients).toEqual([
      {id:"legacy",name:"legacy"},{id:"pending-only",name:"client-b"},{id:"scope-owner",name:"Named connection"},
    ]);
    expect(preview.workloads).toEqual(expect.arrayContaining([{id:targetVm,name:targetVm,revoked:true},{id:otherVm,name:otherVm,revoked:false}]));
    expect(preview.evidence.issuances.map(p=>p.id)).toEqual([issuance]);
    expect(preview.evidence.baseline).toEqual([old]);
    expect(await f.db.transaction(sql=>removeIntegrationAccess(sql,tenantId,target,preview))).toEqual({needsTombstone:true});
    expect((await q("SELECT selected_scopes,active_scopes,legacy_implicit_scopes,policy_revision FROM app.oauth_installations WHERE tenant_id=$1 AND id='scope-owner'",[tenantId])).rows[0]).toEqual({
      selected_scopes:["team:read",kept],active_scopes:[kept],legacy_implicit_scopes:[kept],policy_revision:3,
    });
    expect((await q("SELECT selected_scopes,credential_scopes,expected_revision FROM app.oauth_installation_issuances WHERE id=$1",[issuance])).rows[0]).toEqual({
      selected_scopes:[kept],credential_scopes:[kept],expected_revision:1,
    });
    expect((await q("SELECT scope_overrides,disabled_scopes,integration_overrides FROM app.agent_identities WHERE tenant_id=$1",[tenantId])).rows[0]).toEqual({
      scope_overrides:null,disabled_scopes:["team:write",kept],integration_overrides:{[other]:kept},
    });
    expect((await q("SELECT scope FROM app.oauth_legacy_baselines WHERE tenant_id=$1",[tenantId])).rows).toEqual([{scope:kept}]);
    expect((await q("SELECT id, scopes, revoked_at IS NOT NULL AS revoked FROM app.vm_permission_grants")).rows).toEqual(expect.arrayContaining([
      {id:targetVm,scopes:[kept],revoked:true},{id:otherVm,scopes:[kept],revoked:false},{id:siblingVm,scopes:[removed,kept],revoked:false},
    ]));
    const otherPreview = await inspectIntegrationAccess(f.db.pool,otherTenant,target);
    expect(otherPreview.evidence.issuances.map(p=>p.id)).toEqual([siblingIssuance]);
    expect(otherPreview.evidence.baseline).toEqual([old]);
  } finally { await f.cleanup(); }
});
