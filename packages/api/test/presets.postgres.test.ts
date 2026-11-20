import { afterEach, expect, it, vi } from "vitest";
import { loadingFixture } from "./helpers/loading-fixture";
import { PresetRepository } from "../src/postgres/preset-repository";
import { ApiService } from "../src/flow-service";
import { protectedApiFetch } from "../src/protected-api";
vi.mock("cloudflare:workers",()=>({WorkerEntrypoint:class{},DurableObject:class{}}));
vi.mock("@cloudflare/workers-oauth-provider",()=>({OAuthProvider:class{},AuthorizationError:class extends Error{},getOAuthApi:vi.fn()}));

it.skipIf(!process.env.AUTH_TEST_DATABASE_URL)("versions all preset kinds, protects defaults/references, enforces tenants and API validation",async()=>{
 const f=await loadingFixture(process.env.AUTH_TEST_DATABASE_URL!);
 try{
  const service=new ApiService(f.env,f.auth),store=new PresetRepository(f.db,f.tenantId);
  for(const kind of ["vm","permission","model"] as const){
   const settings=kind==="vm"?{provider:"none" as const}:kind==="permission"?{runScopes:[]}: {model:"fixture-model",effort:"high"};
   const first=(await service.savePreset({kind,slug:"first",name:"First",settings})).preset;
   expect(first).toMatchObject({isDefault:true,revision:1,slug:"first"});
   const next=(await service.savePreset({kind,slug:"second",name:"Second",settings})).preset;
   await expect(service.deletePreset(first.id)).rejects.toMatchObject({code:"default_preset"});
   await service.defaultPreset(next.id);
   const updated=await service.savePreset({kind,slug:"first",name:"Renamed",settings,expectedRevision:1},first.id);
   expect(updated.preset.revision).toBe(2);
   await expect(service.savePreset({kind,slug:"changed",name:"Bad",settings},first.id)).rejects.toMatchObject({code:"immutable_slug"});
   await expect(service.savePreset({kind,slug:"first",name:"Stale",settings,expectedRevision:1},first.id)).rejects.toMatchObject({code:"stale_preset"});
   await expect(service.savePreset({kind,slug:"first",name:"Duplicate",settings})).rejects.toMatchObject({code:"duplicate_slug"});
   const skillId=crypto.randomUUID();
   await f.db.pool.query("INSERT INTO app.skills(tenant_id,id,key,definition) VALUES($1,$2,$3,$4)",[f.tenantId,skillId,`uses-${kind}`,{factorize:{[`${kind}-preset`]:'first'}}]);
   await expect(service.deletePreset(first.id)).rejects.toMatchObject({code:"preset_referenced",message:expect.stringContaining(`uses-${kind}`)});
   await f.db.pool.query("DELETE FROM app.skills WHERE tenant_id=$1 AND id=$2",[f.tenantId,skillId]);
   await service.deletePreset(first.id);
   expect((await store.list()).find(p=>p.id===first.id)).toBeUndefined();
   expect((await f.db.pool.query("SELECT revision FROM app.preset_revisions WHERE tenant_id=$1 AND preset_id=$2 ORDER BY revision",[f.tenantId,first.id])).rows).toEqual([{revision:1},{revision:2}]);
   await expect(new PresetRepository(f.db,f.otherTenant).remove(next.id)).rejects.toMatchObject({code:"not_found"});
  }
  await expect(service.savePreset({kind:"vm",slug:"missing",name:"Missing",settings:{provider:"exe",connectionId:"foreign",image:"",tags:[]}})).rejects.toMatchObject({status:400});
  await expect(service.savePreset({kind:"model",slug:"missing",name:"Missing",settings:{modelAccountId:crypto.randomUUID()}})).rejects.toMatchObject({status:400});
  const request=new Request(f.env.APP_ORIGIN+"/api/v1/presets",{method:"POST",headers:{Origin:f.env.APP_ORIGIN,"Content-Type":"application/json"},body:JSON.stringify({kind:"model",slug:"bad slug",name:"Bad",settings:{}})});
  expect((await protectedApiFetch(request,f.env,f.auth,{} as ExecutionContext)).status).toBe(400);
  const denied=new ApiService(f.env,{...f.auth,scopes:["integrations:read"]});
  await expect(denied.deletePreset(crypto.randomUUID())).rejects.toMatchObject({status:403});
 }finally{await f.cleanup();}
});
