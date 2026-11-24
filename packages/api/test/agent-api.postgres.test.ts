import { describe, expect, it, vi } from "vitest";
import { loadingFixture } from "./helpers/loading-fixture";
import { CredentialRepository } from "../src/postgres/credential-repository";
import { AgentApiService, cleanupAgentResponses, integrationConsentLabels } from "../src/agent-api";
import { normalizeScopes } from "../src/access-tokens";
import { requestApiInput } from "../src/agent-api-contracts";
vi.mock("cloudflare:workers",()=>({WorkerEntrypoint:class {},DurableObject:class {}}));
vi.mock("@cloudflare/workers-oauth-provider",()=>({OAuthProvider:class {},AuthorizationError:class extends Error {},getOAuthApi:vi.fn()}));
const url=process.env.AUTH_TEST_DATABASE_URL;
describe.skipIf(!url)("persisted agent grants and cleanup",()=>{
  it("retains a stable reference across rotation, but disconnect and disable never revive approvals",async()=>{
    const f=await loadingFixture(url!);
    try {
      const repository=new CredentialRepository(f.db,f.tenantId,f.env.CREDENTIAL_ENCRYPTION_KEY),id=crypto.randomUUID();
      const write=(operation:"upsert"|"delete",revision:number)=>repository.write({id,kind:"bearer",name:"API",description:"Use this API",origin:"https://api.example.com",expectedRevision:revision,idempotencyKey:crypto.randomUUID(),operation,...(operation==="upsert"?{managedSecret:"private"}:{})});
      await write("upsert",0);
      const row=(await f.db.pool.query("SELECT * FROM app.agent_integrations WHERE tenant_id=$1 AND credential_id=$2",[f.tenantId,id])).rows[0];
      const scope=`integration:${row.id}:${row.epoch}`;
      const auth={...f.auth,authMethod:"oauth" as const,oauthGrantId:"grant",oauthClientId:"client",oauthExpiresAt:Date.now()/1000+3600,scopes:[scope]};
      const service=new AgentApiService(f.env,auth);
      expect((await service.authorize(row.id)).identity.kind).toBe("oauth");
      await write("upsert",1);expect((await service.authorize(row.id)).integration.epoch).toBe(row.epoch);
      await write("delete",2);await expect(service.authorize(row.id)).rejects.toMatchObject({status:403});
      await write("upsert",3);await expect(service.authorize(row.id)).rejects.toMatchObject({code:"insufficient_scope"});
      await expect(integrationConsentLabels(f.env,f.tenantId,[scope])).rejects.toMatchObject({status:403});
      await f.db.pool.query("UPDATE app.agent_integrations SET policy='baseline' WHERE tenant_id=$1 AND id=$2",[f.tenantId,row.id]);
      await service.authorize(row.id);
      await f.db.pool.query("UPDATE app.agent_integrations SET policy='disabled' WHERE tenant_id=$1 AND id=$2",[f.tenantId,row.id]);
      await expect(service.authorize(row.id)).rejects.toMatchObject({status:403});
      await f.db.pool.query("UPDATE app.agent_integrations SET policy='requestable' WHERE tenant_id=$1 AND id=$2",[f.tenantId,row.id]);
      await expect(service.authorize(row.id)).rejects.toMatchObject({code:"insufficient_scope"});
      await f.db.pool.query("UPDATE app.agent_identities SET revoked_at=now() WHERE tenant_id=$1",[f.tenantId]);
      await expect(service.reflection()).rejects.toMatchObject({status:401});
    } finally {await f.cleanup();}
  });
  it("cleans expired receipts including interrupted uploads, and retries failed object deletion",async()=>{
    const f=await loadingFixture(url!);
    try {
      const identity=await new AgentApiService(f.env,{...f.auth,authMethod:"oauth",oauthGrantId:"grant",oauthClientId:"client",oauthExpiresAt:Date.now()/1000+3600}).identity();
      const integration=crypto.randomUUID();
      await f.db.pool.query("INSERT INTO app.agent_integrations(tenant_id,id,kind,credential_id,name,available) VALUES($1,$2,'linear','linear','Linear',true)",[f.tenantId,integration]);
      const expired=crypto.randomUUID(),pending=crypto.randomUUID(),live=crypto.randomUUID();
      for(const [id,age,size] of [[expired,-1,10],[pending,-1,null],[live,1,10]]) await f.db.pool.query("INSERT INTO app.agent_proxy_responses(tenant_id,id,identity_id,integration_id,integration_epoch,object_key,size,expires_at) VALUES($1,$2,$3,$4,1,$2::uuid::text,$5,now()+$6*interval '1 day')",[f.tenantId,id,identity.id,integration,size,age]);
      const deleted:string[]=[];let failed=true;
      f.env.PROXY_ARTIFACTS={list:vi.fn(async({prefix}:{prefix:string})=>({objects:[{key:prefix+'0'}],truncated:false})),delete:vi.fn(async(keys:string[])=>{if(failed)throw new Error("storage unavailable");deleted.push(...keys);})} as any;
      await expect(cleanupAgentResponses(f.env)).rejects.toThrow("storage unavailable");
      expect((await f.db.pool.query("SELECT * FROM app.agent_proxy_responses")).rowCount).toBe(3);
      failed=false;await cleanupAgentResponses(f.env);
      expect(deleted.sort()).toEqual([expired+'/0',pending+'/0'].sort());
      expect((await f.db.pool.query("SELECT id FROM app.agent_proxy_responses")).rows).toEqual([{id:live}]);
    } finally {await f.cleanup();}
  });
});
it("only normalizes well-formed epoch integration scopes and rejects caller origins and invalid requests",()=>{
  const id=crypto.randomUUID(),scope=`integration:${id}:1`;
  expect(normalizeScopes([scope,scope,`integration:${id}:0`,`integration:${id}:01`,`integration:${id}:1 x`,`integration:foreign:1`])).toEqual([scope]);
  for(const path of ['https://evil.com','//evil.com','/a\\b','/a\n','/a#fragment']) expect(requestApiInput.safeParse({integration:id,method:"GET",path}).success).toBe(false);
  expect(requestApiInput.safeParse({integration:id,method:"CONNECT",path:"/"}).success).toBe(false);
  expect(requestApiInput.safeParse({integration:id,method:"GET",path:"/",headers:{x:"x\r\ninjected:true"}}).success).toBe(false);
});
