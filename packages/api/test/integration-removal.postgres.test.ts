import { expect, it, vi } from "vitest";
import { protectedApiFetch } from "../src/protected-api";
import { ConnectionRepository } from "../src/credentials/storage/connection-repository";
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
