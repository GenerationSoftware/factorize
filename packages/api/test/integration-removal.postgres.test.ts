import { expect, it, vi } from "vitest";
import { integrationRemovalPreview } from "../src/integrations/api/integration-removal-contracts";
import { protectedApiFetch } from "../src/protected-api";
import { ConnectionRepository } from "../src/credentials/storage/connection-repository";
import { CredentialRepository } from "../src/credentials/storage/credential-repository";
import { EventDefinitionRepository } from "../src/events/storage/event-definition-repository";
import { EventMatchRepository } from "../src/events/storage/event-match-repository";
import { mcpRequest } from "./helpers/mcp-request";
import { loadingFixture } from "./helpers/loading-fixture";

vi.mock("cloudflare:workers", () => ({WorkerEntrypoint:class {}, DurableObject:class {}, WorkflowEntrypoint:class {}}));
const url = process.env.AUTH_TEST_DATABASE_URL;
type Fixture = Awaited<ReturnType<typeof loadingFixture>>;
function rpc(f: Fixture, path: string, body?: object, method = "POST") {
  return protectedApiFetch(new Request(f.env.APP_ORIGIN + path, {
    method, headers:{Cookie:f.cookie,Origin:f.env.APP_ORIGIN,"Content-Type":"application/json"},
    body:body===undefined?undefined:JSON.stringify(body),
  }),f.env,f.auth,{} as ExecutionContext);
}
const paths = { preview:"/api/v1/integrations/removal/preview", confirm:"/api/v1/integrations/removal/confirm" };

it.skipIf(!url)("removes a standalone exe.dev credential without treating its registration as a Trigger",async()=>{
  const f = await loadingFixture(url!);
  try {
    const id=crypto.randomUUID(), other=crypto.randomUUID();
    const repo=new ConnectionRepository(f.db,f.tenantId,f.env.CREDENTIAL_ENCRYPTION_KEY);
    await repo.put(`exe:${id}`,{apiToken:"dummy-local-fixture"});
    await repo.put(`exe:${other}`,{apiToken:"other-local-fixture"});
    const registration=(await f.db.pool.query<{id:string}>("SELECT id FROM app.agent_integrations WHERE tenant_id=$1 AND kind='exe' AND credential_id=$2",[f.tenantId,id])).rows[0]!;
    expect(registration.id).toBeTruthy();
    const preview=await rpc(f,paths.preview,{kind:"exe",id});
    expect(preview.status,await preview.clone().text()).toBe(200);
    expect(await preview.json()).toMatchObject({needsConfirmation:false,sources:[],lookups:[]});
    expect(await repo.get(`exe:${id}`)).not.toBeNull();
    const removed=await rpc(f,`/api/v1/integrations/exe/${id}`,undefined,"DELETE");
    expect(removed.status,await removed.clone().text()).toBe(200);
    expect(await repo.get(`exe:${id}`)).toBeNull();
    expect(await repo.get(`exe:${other}`)).not.toBeNull();
    expect((await f.db.pool.query("SELECT id FROM app.agent_integrations WHERE tenant_id=$1 AND id=$2",[f.tenantId,registration.id])).rowCount).toBe(0);
    await repo.put(`exe:${id}`,{apiToken:"reconnected-dummy-fixture"});
    const replacement=(await f.db.pool.query<{id:string}>("SELECT id FROM app.agent_integrations WHERE tenant_id=$1 AND kind='exe' AND credential_id=$2",[f.tenantId,id])).rows[0]!;
    expect(replacement.id).not.toBe(registration.id);
    const read=mcpRequest(f.env,{...f.auth,authMethod:"oauth",oauthGrantId:"fixture-old-credential",oauthClientId:"fixture-old-client",
      oauthExpiresAt:Date.now()/1000+300,explicitIntegrationScopes:true,scopes:["proxy:use",`integration:${registration.id}:1`]});
    const reflected=(await read("tools/call",{name:"get_api_reflection",arguments:{}})).message.result.structuredContent;
    expect(reflected.integrations.find((value:{id:string})=>value.id===replacement.id).access).toBe("requestable");
  } finally { await f.cleanup(); }
});

it.skipIf(!url)("requires the current impact and explicit owner confirmation, preserving Event history and sibling resources",async()=>{
  const f=await loadingFixture(url!);
  try {
    const kept=await f.seedEventTrigger();
    const prior=await new EventMatchRepository(f.db).match({tenantId:f.tenantId,triggerId:kept.triggerId,triggerRevision:1,sourceIdentity:"manual:fixture",deduplicationKey:"previous",evidence:{kept:true},decision:"matched"});
    const id=Number.parseInt(crypto.randomUUID().slice(0,8),16).toString(), sibling=String(Number(id)+1);
    await f.db.pool.query("INSERT INTO app.github_installations(tenant_id,installation_id,account_login,account_type,state) VALUES($1,$2,'fixture-removal','Organization','active'),($1,$3,'sibling','Organization','active')",[f.tenantId,id,sibling]);
    const registry=(await f.db.pool.query<{id:string}>("SELECT id FROM app.agent_integrations WHERE tenant_id=$1 AND kind='github' AND credential_id=$2",[f.tenantId,id])).rows[0]!.id;
    const otherRegistry=(await f.db.pool.query<{id:string}>("SELECT id FROM app.agent_integrations WHERE tenant_id=$1 AND kind='github' AND credential_id=$2",[f.tenantId,sibling])).rows[0]!.id;
    const directory=new EventDefinitionRepository(f.db,f.tenantId);
    await directory.update(kept.definitionId,{name:"fixture-event",enrichment:{rule:"lookups.chain.ok",extraDataUrls:[
      {name:"selected",integration:registry,method:"GET",path:"/fixture"},
      {name:"chain",integration:otherRegistry,method:"GET",path:"/fixture?value={{lookups.selected.id}}"},
      {name:"independent",integration:otherRegistry,method:"GET",path:"/fixture"},
    ]}},1);
    const affectedSource=crypto.randomUUID(), laterSource=crypto.randomUUID(), unrelatedSource=crypto.randomUUID(), subscriptionId="sub_"+"a".repeat(64);
    const target={kind:"github",id};
    const source = (sourceId:string,installationId:string) => f.db.pool.query(`INSERT INTO app.events(tenant_id,id,trigger_id,kind,slug,position,config)
      VALUES($1,$2::uuid,$3,'webhook',$2::uuid::text,9,$4)`,[f.tenantId,sourceId,kept.triggerId,JSON.stringify({provider:"github",installationId:Number(installationId),repositoryId:1,event:"check_suite",action:"completed"})]);
    await source(affectedSource,id);
    await source(unrelatedSource,sibling);
    await f.db.pool.query(`INSERT INTO app.mcp_event_subscriptions
      (tenant_id,id,user_id,session_version,grant_id,client_id,definition_id,arguments,callback_url,encrypted_secret,secret_fingerprint,verified_at,generation,status,expires_at)
      VALUES($1,$2,$3,1,'fixture-grant','fixture-client',$4,'{}','https://example.com/fixture','fixture','fixture',now(),$5,'active',now()+interval '5 minutes')`,
      [f.tenantId,subscriptionId,f.userId,kept.definitionId,crypto.randomUUID()]);
    const preview=async()=>{
      const r=await rpc(f,paths.preview,target);
      expect(r.status,await r.clone().text()).toBe(200);
      return r.json() as Promise<{fingerprint:string}>;
    };
    const first=await preview();
    expect(first).toMatchObject({needsConfirmation:true,sources:[{id:affectedSource,triggerId:kept.triggerId,deleteTrigger:false}],lookups:[{name:"selected",cascaded:false},{name:"chain",cascaded:true}],pausedEvents:[{id:kept.definitionId}]});
    expect((await rpc(f,paths.confirm,{...target,fingerprint:first.fingerprint,confirmImpact:false})).status).toBe(409);
    expect((await rpc(f,`/api/v1/providers/github/installations/${id}`,undefined,"DELETE")).status).toBe(409);
    await source(laterSource,id); // Impact changed while the dialog was open.
    expect((await rpc(f,paths.confirm,{...target,fingerprint:first.fingerprint,confirmImpact:true})).status).toBe(409);
    expect((await f.db.pool.query("SELECT id FROM app.events WHERE id IN ($1,$2)",[affectedSource,laterSource])).rowCount).toBe(2);
    const latest=await preview();
    const removed=await rpc(f,paths.confirm,{...target,fingerprint:latest.fingerprint,confirmImpact:true});
    expect(removed.status,await removed.clone().text()).toBe(200);
    expect((await f.db.pool.query("SELECT id FROM app.events WHERE id IN ($1,$2)",[affectedSource,laterSource])).rowCount).toBe(0);
    expect((await f.db.pool.query("SELECT id FROM app.triggers WHERE id=$1",[kept.triggerId])).rowCount).toBe(1);
    expect((await f.db.pool.query("SELECT id FROM app.events WHERE tenant_id=$1 AND id=$2",[f.tenantId,unrelatedSource])).rowCount).toBe(1);
    expect((await f.db.pool.query("SELECT id FROM app.mcp_event_subscriptions WHERE tenant_id=$1 AND id=$2",[f.tenantId,subscriptionId])).rowCount).toBe(1);
    expect((await directory.occurrences(kept.definitionId))?.items[0].id).toBe(prior.occurrence!.id);
    expect(await directory.get(kept.definitionId)).toMatchObject({enrichmentPauseReason:"integration_removed",enrichment:{rule:"lookups.chain.ok",extraDataUrls:[{name:"independent"}]}});
    expect((await f.db.pool.query("SELECT id FROM app.agent_integrations WHERE tenant_id=$1 AND id=$2",[f.tenantId,otherRegistry])).rowCount).toBe(1);
  } finally { await f.cleanup(); }
});

it.skipIf(!url)("retains a receipt-backed tombstone without inheriting old implicit access on reconnect",async()=>{
  const f=await loadingFixture(url!);
  try {
    const id=crypto.randomUUID();
    const repo=new ConnectionRepository(f.db,f.tenantId,f.env.CREDENTIAL_ENCRYPTION_KEY);
    await repo.put(`exe:${id}`,{apiToken:"dummy-local-fixture"});
    const registry=(await f.db.pool.query<{id:string;epoch:number}>("UPDATE app.agent_integrations SET policy='baseline' WHERE tenant_id=$1 AND kind='exe' AND credential_id=$2 RETURNING id,epoch",[f.tenantId,id])).rows[0]!;
    const identity=(await f.db.pool.query<{id:string}>("INSERT INTO app.agent_identities(tenant_id,kind,subject,user_id,session_version) VALUES($1,'oauth','fixture-old',$2,1) RETURNING id",[f.tenantId,f.userId])).rows[0]!.id;
    const receipt=crypto.randomUUID();
    await f.db.pool.query(`INSERT INTO app.agent_proxy_responses(tenant_id,id,identity_id,integration_id,integration_epoch,object_key,expires_at)
      VALUES($1,$2,$3,$4,$5,$2::uuid::text,now()+interval '5 minutes')`,[f.tenantId,receipt,identity,registry.id,registry.epoch]);
    const before=await rpc(f,paths.preview,{kind:"exe",id});
    expect(before.status).toBe(200);
    const {fingerprint}=await before.json() as {fingerprint:string};
    const gone=await rpc(f,paths.confirm,{kind:"exe",id,fingerprint,confirmImpact:false});
    expect(gone.status,await gone.clone().text()).toBe(200);
    expect((await f.db.pool.query("SELECT available,policy FROM app.agent_integrations WHERE tenant_id=$1 AND id=$2",[f.tenantId,registry.id])).rows[0]).toEqual({available:false,policy:"requestable"});
    await repo.put(`exe:${id}`,{apiToken:"different-dummy-fixture"});
    const active=(await f.db.pool.query<{epoch:number}>("SELECT epoch FROM app.agent_integrations WHERE tenant_id=$1 AND id=$2 AND available",[f.tenantId,registry.id])).rows[0]!;
    expect(active.epoch).toBeGreaterThan(registry.epoch);
    const old=mcpRequest(f.env,{...f.auth,authMethod:"oauth",oauthGrantId:"fixture-old",oauthClientId:"legacy-client",oauthExpiresAt:Date.now()/1000+300,scopes:["proxy:use"]});
    const result=(await old("tools/call",{name:"get_api_reflection",arguments:{}})).message.result.structuredContent;
    expect(result.integrations.find((entry:{id:string})=>entry.id===registry.id).access).toBe("requestable");
    expect((await f.db.pool.query("SELECT id FROM app.agent_proxy_responses WHERE tenant_id=$1 AND id=$2",[f.tenantId,receipt])).rowCount).toBe(1);
  } finally { await f.cleanup(); }
});

it.skipIf(!url)("deletes the native Linear connection, webhook routing and access without deleting Event history", async () => {
  const f = await loadingFixture(url!);
  const organizationId = crypto.randomUUID(), otherOrganizationId = crypto.randomUUID();
  const connection = { accessToken: "local-access", refreshToken: "local-refresh", organizationId };
  const repository = new ConnectionRepository(f.db, f.tenantId, f.env.CREDENTIAL_ENCRYPTION_KEY);
  const otherRepository = new ConnectionRepository(f.db, f.otherTenant, f.env.CREDENTIAL_ENCRYPTION_KEY);
  const target = { kind: "linear", id: "linear" };
  const preview = async () => {
    const response = await rpc(f, paths.preview, target);
    expect(response.status, await response.clone().text()).toBe(200);
    return integrationRemovalPreview.parse(await response.json());
  };
  try {
    expect(await repository.putLinear(organizationId, connection)).toBe(true);
    expect(await otherRepository.putLinear(otherOrganizationId, { ...connection, organizationId: otherOrganizationId })).toBe(true);
    const registration = (await f.db.pool.query<{ id: string; epoch: number }>(
      "SELECT id,epoch FROM app.agent_integrations WHERE tenant_id=$1 AND kind='linear' AND credential_id='linear'", [f.tenantId],
    )).rows[0]!;
    const scope = `integration:${registration.id}:${registration.epoch}`;
    await f.db.pool.query(`INSERT INTO app.agent_identities(tenant_id,kind,subject,user_id,session_version,scope_overrides)
      VALUES($1,'oauth','linear-test-client',$2,1,$3::text[])`, [f.tenantId, f.userId, [scope]]);
    const retained = await f.seedEventTrigger();
    const sibling = await f.seedEventTrigger(f.otherTenant);
    const directory = new EventDefinitionRepository(f.db, f.tenantId);
    const sole = (await directory.create({ name: "linear-only" }))!;
    const soleTrigger = crypto.randomUUID();
    await f.db.pool.query("INSERT INTO app.triggers(tenant_id,id,event_definition_id,name,slug) VALUES($1,$2,$3,'Only Linear','only-linear')", [f.tenantId, soleTrigger, sole.id]);
    const prior = await new EventMatchRepository(f.db).match({ tenantId:f.tenantId, triggerId:retained.triggerId, triggerRevision:1, sourceIdentity:"manual:retained", deduplicationKey:"linear-history", evidence:{keep:true}, decision:"matched" });
    const retainedSource = crypto.randomUUID(), soleSource = crypto.randomUUID(), siblingSource = crypto.randomUUID();
    for (const [tenant, trigger, id] of [[f.tenantId, retained.triggerId, retainedSource], [f.tenantId, soleTrigger, soleSource], [f.otherTenant, sibling.triggerId, siblingSource]]) {
      await f.db.pool.query(`INSERT INTO app.events(tenant_id,id,trigger_id,kind,slug,position,config)
        VALUES($1,$2,$3,'webhook','linear-issues',5,'{"provider":"linear","projectId":"project","matchRules":[{"type":"status","targetId":"done"}]}')`, [tenant, id, trigger]);
    }
    await directory.update(retained.definitionId, { name:"linear-and-manual", enrichment:{rule:"lookups.linearIssue.ok",extraDataUrls:[
      {name:"linearIssue",integration:registration.id,method:"POST",path:"/graphql"},
    ]}}, 1);
    expect((await rpc(f, paths.preview, { kind: "linear", id: "different" })).status).toBe(404);
    const first = await preview();
    expect(first).toMatchObject({
      needsConfirmation: true,
      sources: expect.arrayContaining([{id:retainedSource,triggerId:retained.triggerId,triggerName:"Fixture trigger",eventId:retained.definitionId,eventName:"linear-and-manual",sourceName:"linear-issues",deleteTrigger:false},
        expect.objectContaining({id:soleSource,deleteTrigger:true})]),
      pausedEvents: expect.arrayContaining([expect.objectContaining({id:sole.id}),expect.objectContaining({id:retained.definitionId})]),
      lookups: [expect.objectContaining({name:"linearIssue",cascaded:false})],
      clients: [expect.objectContaining({id:"linear-test-client"})],
    });
    expect(first.sources).toHaveLength(2);
    expect(await repository.get("linear")).not.toBeNull();
    expect((await rpc(f, paths.confirm, {...target, fingerprint:first.fingerprint, confirmImpact:false})).status).toBe(409);
    // A reconnect replaces the credential and invalidates an open delete dialog.
    expect(await repository.putLinear(organizationId, {...connection, accessToken:"refreshed-local-token"})).toBe(true);
    expect((await rpc(f, paths.confirm, {...target, fingerprint:first.fingerprint, confirmImpact:true})).status).toBe(409);
    const latest = await preview();
    const response = await rpc(f, paths.confirm, {...target, fingerprint:latest.fingerprint, confirmImpact:true});
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toEqual({deleted:true});
    expect(await repository.get("linear")).toBeNull();
    expect(await otherRepository.get("linear")).not.toBeNull();
    expect((await f.db.pool.query("SELECT organization_id FROM app.linear_workspaces WHERE organization_id=ANY($1::uuid[])", [[organizationId,otherOrganizationId]])).rows)
      .toEqual([{organization_id:otherOrganizationId}]);
    expect((await f.db.pool.query("SELECT id FROM app.events WHERE id IN ($1,$2,$3)", [retainedSource,soleSource,siblingSource])).rows)
      .toEqual([{id:siblingSource}]);
    expect((await f.db.pool.query("SELECT id FROM app.triggers WHERE id IN ($1,$2)", [retained.triggerId,soleTrigger])).rows)
      .toEqual([{id:retained.triggerId}]);
    expect(await directory.get(sole.id)).not.toBeNull();
    expect(await directory.get(retained.definitionId)).toMatchObject({enrichmentPauseReason:"integration_removed",enrichment:{rule:"lookups.linearIssue.ok",extraDataUrls:[]}});
    expect((await directory.occurrences(retained.definitionId))?.items[0].id).toBe(prior.occurrence!.id);
    expect((await f.db.pool.query("SELECT scope_overrides FROM app.agent_identities WHERE tenant_id=$1 AND subject='linear-test-client'", [f.tenantId])).rows[0])
      .toEqual({scope_overrides:[]});
    expect((await rpc(f, paths.preview, target)).status).toBe(404);
    // The old mapping is actually released, not left reserving its organization.
    expect(await otherRepository.putLinear(organizationId, connection)).toBe(true);
  } finally { await f.cleanup(); }
});

it.skipIf(!url)("uses the shared preview and confirm workflow for every existing removal kind", async () => {
  const f = await loadingFixture(url!);
  try {
    const repository = new ConnectionRepository(f.db, f.tenantId, f.env.CREDENTIAL_ENCRYPTION_KEY);
    const bearer = new CredentialRepository(f.db, f.tenantId, f.env.CREDENTIAL_ENCRYPTION_KEY);
    const db = f.db.pool;
    const exe = crypto.randomUUID(), amp = crypto.randomUUID(), tail = crypto.randomUUID();
    const cloudflare = crypto.randomUUID(), bearerId = crypto.randomUUID();
    const github = String(Number.parseInt(crypto.randomUUID().slice(0,8),16));
    for (const key of [`exe:${exe}`, `amp:${amp}`, `cloudflare-tail:${tail}`]) await repository.put(key, {fixture:true});
    await db.query("INSERT INTO app.github_installations(tenant_id,installation_id,account_login,account_type,state) VALUES($1,$2,'fixture','Organization','active')", [f.tenantId, github]);
    await db.query("INSERT INTO app.fly_connections(tenant_id,organization_slug,organization_name,encrypted_token) VALUES($1,'fixture','Fixture','fixture')", [f.tenantId]);
    await db.query("INSERT INTO app.cloudflare_connections(tenant_id,id,account_name,encrypted_credentials) VALUES($1,$2,'Fixture','fixture')", [f.tenantId, cloudflare]);
    await bearer.write({id:bearerId, kind:"bearer", name:"Fixture", origin:"https://fixture.test", description:null, expectedRevision:0, idempotencyKey:crypto.randomUUID(), operation:"upsert", managedSecret:"local-only"});
    const targets = [
      {kind:"exe", id:exe}, {kind:"amp", id:amp}, {kind:"cloudflareTail", id:tail},
      {kind:"github", id:github}, {kind:"fly", id:"fly"}, {kind:"cloudflare", id:cloudflare}, {kind:"bearer", id:bearerId},
    ];
    const noProviderRequest = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Removing integrations must not call providers"));
    try {
      for (const target of targets) {
        const preview = await rpc(f, paths.preview, target);
        expect(preview.status, target.kind + ": " + await preview.clone().text()).toBe(200);
        const impact = integrationRemovalPreview.parse(await preview.json());
        expect(impact).toMatchObject({needsConfirmation:false});
        const gone = await rpc(f, paths.confirm, {...target, fingerprint:impact.fingerprint, confirmImpact:false});
        expect(gone.status, target.kind + ": " + await gone.clone().text()).toBe(200);
        expect(await gone.json()).toEqual({deleted:true});
        expect((await rpc(f, paths.preview, target)).status, target.kind).toBe(404);
      }
      expect(noProviderRequest).not.toHaveBeenCalled();
    } finally { noProviderRequest.mockRestore(); }
    expect(await repository.all(["exe:", "amp:", "cloudflare-tail:"])).toEqual(new Map());
    expect((await db.query("SELECT 1 FROM app.github_installations WHERE tenant_id=$1", [f.tenantId])).rowCount).toBe(0);
    expect((await db.query("SELECT 1 FROM app.fly_connections WHERE tenant_id=$1", [f.tenantId])).rowCount).toBe(0);
    expect((await db.query("SELECT encrypted_credentials FROM app.cloudflare_connections WHERE tenant_id=$1 AND id=$2", [f.tenantId, cloudflare])).rows)
      .toEqual([{encrypted_credentials:null}]);
    expect(await bearer.managedCredential(bearerId, "bearer")).toBeNull();
    expect((await db.query("SELECT id FROM app.agent_integrations WHERE tenant_id=$1 AND available", [f.tenantId])).rowCount).toBe(0);
  } finally { await f.cleanup(); }
});

it.skipIf(!url)("preserves the client permission during provider edits and temporary reconnects, but fences old operations", async () => {
  const f = await loadingFixture(url!);
  try {
    const db = f.db.pool, tenant = f.tenantId;
    const x = crypto.randomUUID();
    const github = String(Number.parseInt(crypto.randomUUID().slice(0,8),16));
    await db.query("INSERT INTO app.github_installations(tenant_id,installation_id,account_login,account_type,state) VALUES($1,$2,'fixture','Organization','active')", [tenant, github]);
    await db.query("INSERT INTO app.fly_connections(tenant_id,organization_slug,organization_name,encrypted_token) VALUES($1,'original','Original','fixture')", [tenant]);
    await db.query("INSERT INTO app.x_connections(tenant_id,id,name,client_id,scopes,encrypted_secret,status) VALUES($1,$2,'Fixture','client','{}','fixture','connected')", [tenant, x]);
    const read = async (kind: string) => (await db.query<{id:string;epoch:number;operation_epoch:number;available:boolean}>(
      "SELECT id,epoch,operation_epoch,available FROM app.agent_integrations WHERE tenant_id=$1 AND kind=$2", [tenant,kind])).rows[0];
    const fly = await read("fly");
    await db.query("UPDATE app.fly_connections SET organization_slug='replacement',organization_name='Replacement' WHERE tenant_id=$1", [tenant]);
    expect(await read("fly")).toEqual({ ...fly, operation_epoch: fly.operation_epoch + 1 });

    const gh = await read("github");
    await db.query("UPDATE app.github_installations SET state='suspended' WHERE tenant_id=$1 AND installation_id=$2", [tenant,github]);
    expect(await read("github")).toEqual({ ...gh, available:false, operation_epoch:gh.operation_epoch+1 });
    await db.query("UPDATE app.github_installations SET state='active' WHERE tenant_id=$1 AND installation_id=$2", [tenant,github]);
    expect(await read("github")).toEqual({ ...gh, operation_epoch:gh.operation_epoch+1 });
    await db.query("DELETE FROM app.github_installations WHERE tenant_id=$1 AND installation_id=$2", [tenant,github]);
    expect(await read("github")).toMatchObject({available:false,epoch:gh.epoch+1});

    const xBefore = await read("x");
    await db.query("UPDATE app.x_connections SET status='reconnect_required' WHERE tenant_id=$1 AND id=$2", [tenant,x]);
    expect(await read("x")).toEqual({ ...xBefore, available:false, operation_epoch:xBefore.operation_epoch+1 });
    await db.query("UPDATE app.x_connections SET status='connected' WHERE tenant_id=$1 AND id=$2", [tenant,x]);
    expect(await read("x")).toEqual({ ...xBefore, operation_epoch:xBefore.operation_epoch+1 });
    await db.query("UPDATE app.agent_integrations SET policy='disabled' WHERE tenant_id=$1 AND id=$2", [tenant,xBefore.id]);
    await db.query("UPDATE app.agent_integrations SET policy='requestable' WHERE tenant_id=$1 AND id=$2", [tenant,xBefore.id]);
    expect(await read("x")).toEqual({ ...xBefore, epoch:xBefore.epoch+1, operation_epoch:xBefore.operation_epoch+2 });
    await db.query("UPDATE app.x_connections SET status='revoked' WHERE tenant_id=$1 AND id=$2", [tenant,x]);
    expect(await read("x")).toMatchObject({available:false,epoch:xBefore.epoch+2});
  } finally { await f.cleanup(); }
});
