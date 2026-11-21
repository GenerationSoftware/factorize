import {beforeAll,afterAll,beforeEach,describe,it,expect,vi} from "vitest";
import {loadingFixture} from "./helpers/loading-fixture";
import {AgentApiService} from "../src/agent-api";
import {grantVm,renewVmGrant,revokeVmGrant} from "../src/vm-grants";
import {protectedApiFetch} from "../src/protected-api";
import type {OAuthProps} from "../src/types";
vi.mock("cloudflare:workers",()=>({WorkerEntrypoint:class{},WorkflowEntrypoint:class{},DurableObject:class{}}));
vi.mock("@cloudflare/workers-oauth-provider",()=>({OAuthProvider:class{},AuthorizationError:class extends Error{},getOAuthApi:vi.fn()}));
const meta={"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientInfo":{name:"grant-client",version:"1"},"io.modelcontextprotocol/clientCapabilities":{}};
describe.skipIf(!process.env.AUTH_TEST_DATABASE_URL)("renewable VM grant leases",()=>{
 let f:Awaited<ReturnType<typeof loadingFixture>>,auth:OAuthProps,parent:string,provider:any,target:any,grantId:string;
 beforeAll(async()=>{
  f=await loadingFixture(process.env.AUTH_TEST_DATABASE_URL!);
  auth={...f.auth,authMethod:"oauth",oauthGrantId:"parent-authorization",oauthClientId:"client",oauthExpiresAt:Math.floor(Date.now()/1000)+10,scopes:["proxy:use","vm:grant"]};
  parent=(await new AgentApiService(f.env,auth).identity()).id;
  await f.db.pool.query("UPDATE app.agent_integrations SET policy='baseline' WHERE tenant_id=$1 AND kind IN ('exe','amp')",[f.tenantId]);
  provider=(await f.db.pool.query("SELECT * FROM app.agent_integrations WHERE tenant_id=$1 AND kind='exe'",[f.tenantId])).rows[0];
  target=(await f.db.pool.query("SELECT * FROM app.agent_integrations WHERE tenant_id=$1 AND kind='amp'",[f.tenantId])).rows[0];
 });
 beforeEach(async()=>{
  await f.db.pool.query("UPDATE app.agent_integrations SET policy='baseline',available=true WHERE tenant_id=$1 AND id=ANY($2::uuid[])",[f.tenantId,[provider.id,target.id]]);
  await f.db.pool.query("UPDATE app.agent_identities SET revoked_at=NULL,disabled_scopes='{}',integration_overrides='{}' WHERE tenant_id=$1 AND id=$2",[f.tenantId,parent]);
  grantId=crypto.randomUUID();
  await f.db.pool.query(`INSERT INTO app.vm_grants(tenant_id,id,parent_id,provider_id,provider_epoch,vm,permissions,parent_scopes,request_key,issuer,subject,expires_at)
   VALUES($1,$2,$3,$4,$5,'guest',$6,$7,($2::uuid)::text,'https://exe.dev/issuer/fixture','guest',now()+interval '5 minutes')`,[f.tenantId,grantId,parent,provider.id,provider.epoch,JSON.stringify({[target.id]:target.epoch}),JSON.stringify(auth.scopes)]);
 });
 afterAll(async()=>f?.cleanup());
 const expiry=async()=>new Date((await f.db.pool.query("SELECT expires_at FROM app.vm_grants WHERE id=$1",[grantId])).rows[0].expires_at).getTime();
 const nearHour=(value:string)=>expect(Math.abs(new Date(value).getTime()-Date.now()-3600000)).toBeLessThan(3000);
 it("renews a live lease for one hour independently of the caller token's remaining seconds",async()=>{
  const value=await renewVmGrant(f.env,auth,grantId);nearHour(value.expiresAt);
  const before=await expiry();await new AgentApiService(f.env,{...auth,oauthExpiresAt:auth.oauthExpiresAt!+3600}).identity();expect(await expiry()).toBe(before);
  const replay=await grantVm(f.env,auth,{providerIntegrationId:provider.id,vm:"guest",integrationIds:[target.id],idempotencyKey:grantId});expect(new Date(replay.expiresAt).getTime()).toBe(before);
 });
 it("shares renewal between REST and MCP with validated identifiers",async()=>{
  const response=await protectedApiFetch(new Request(f.env.APP_ORIGIN+`/api/v1/agent/vm-grants/${grantId}/renew`,{method:"POST"}),f.env,auth,{} as any);expect(response.status).toBe(200);nearHour((await response.json() as any).expiresAt);
  const request=new Request(f.env.APP_ORIGIN+"/mcp",{method:"POST",headers:{Host:"factorize.test","Mcp-Method":"tools/call","Mcp-Name":"renew_vm_grant","Content-Type":"application/json",Accept:"application/json, text/event-stream"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/call",params:{_meta:meta,name:"renew_vm_grant",arguments:{grantId}}})});
  const result=await (await protectedApiFetch(request,f.env,auth,{} as any)).json() as any;expect(result.result.isError).not.toBe(true);expect(result.result.structuredContent.grantId).toBe(grantId);nearHour(result.result.structuredContent.expiresAt);
  expect((await protectedApiFetch(new Request(f.env.APP_ORIGIN+"/api/v1/agent/vm-grants/not-an-id/renew",{method:"POST"}),f.env,auth,{} as any)).status).toBe(400);
 });
 it("rejects other parents, other tenants, missing scopes and revoked parents without extending the lease",async()=>{
  const before=await expiry();
  for(const identity of [{...auth,oauthGrantId:"other"},{...auth,tenantId:f.otherTenant},{...auth,scopes:["proxy:use"]},{...auth,scopes:["vm:grant"]}])await expect(renewVmGrant(f.env,identity,grantId)).rejects.toThrow();
  await f.db.pool.query("UPDATE app.agent_identities SET revoked_at=now() WHERE tenant_id=$1 AND id=$2",[f.tenantId,parent]);await expect(renewVmGrant(f.env,auth,grantId)).rejects.toThrow();expect(await expiry()).toBe(before);
 });
 it.each(["expired","revoked"])("cannot revive a %s grant through renewal or replayed creation",async state=>{
  if(state==="expired")await f.db.pool.query("UPDATE app.vm_grants SET expires_at=now()-interval '1 second' WHERE id=$1",[grantId]);else await revokeVmGrant(f.env,auth,grantId);
  const before=await expiry();await expect(renewVmGrant(f.env,auth,grantId)).rejects.toThrow();await expect(grantVm(f.env,auth,{providerIntegrationId:provider.id,vm:"guest",integrationIds:[target.id],idempotencyKey:grantId})).rejects.toThrow();expect(await expiry()).toBe(before);
 });
 it.each(["provider-disabled","target-disabled","provider-disconnected","target-disconnected","target-blocked","scope-disabled","epoch-changed"])("rechecks %s before extending access",async reason=>{
  const before=await expiry();
  if(reason.endsWith("disabled")&&reason!=="scope-disabled")await f.db.pool.query("UPDATE app.agent_integrations SET policy='disabled' WHERE id=$1",[reason.startsWith("provider")?provider.id:target.id]);
  if(reason.endsWith("disconnected"))await f.db.pool.query("UPDATE app.agent_integrations SET available=false WHERE id=$1",[reason.startsWith("provider")?provider.id:target.id]);
  if(reason==="target-blocked")await f.db.pool.query("UPDATE app.agent_identities SET integration_overrides=$2 WHERE id=$1",[parent,JSON.stringify({[target.id]:false})]);
  if(reason==="scope-disabled")await f.db.pool.query("UPDATE app.agent_identities SET disabled_scopes=ARRAY['proxy:use'] WHERE id=$1",[parent]);
  if(reason==="epoch-changed")await f.db.pool.query("UPDATE app.vm_grants SET provider_epoch=provider_epoch-1 WHERE id=$1",[grantId]);
  await expect(renewVmGrant(f.env,auth,grantId)).rejects.toThrow();expect(await expiry()).toBe(before);
 });
});
