import { expect,it,vi } from "vitest";
import { loadingFixture } from "./helpers/loading-fixture";
import { ApiService } from "../src/flow-service";
import { encrypt } from "../src/crypto";
import { protectedApiFetch } from "../src/protected-api";
vi.mock("cloudflare:workers",()=>({WorkerEntrypoint:class{},DurableObject:class{}}));
vi.mock("@cloudflare/workers-oauth-provider",()=>({OAuthProvider:class{},AuthorizationError:class extends Error{},getOAuthApi:vi.fn()}));
it.skipIf(!process.env.AUTH_TEST_DATABASE_URL)("reads effective preset settings and rejects the retired execution-settings mutation",async()=>{
 const f=await loadingFixture(process.env.AUTH_TEST_DATABASE_URL!);
 try{
  const service=new ApiService(f.env,{...f.auth,scopes:[...f.auth.scopes,"skills:read","skills:write"]}),id=crypto.randomUUID();
  await f.db.pool.query("INSERT INTO app.skills(tenant_id,id,key,encrypted_body,encrypted_prompt) VALUES($1,$2,'effective-settings',$3,$4)",[f.tenantId,id,await encrypt("Instructions",f.env.CREDENTIAL_ENCRYPTION_KEY),await encrypt("Saved prompt",f.env.CREDENTIAL_ENCRYPTION_KEY)]);
  const initial=await service.getSkillSettings(id);expect(initial.defaults).toMatchObject({executionType:"agent",prompt:"",requiresVm:false});
  expect((await service.getSkill(id)).definition?.markdown).toBe("Instructions\n\nSaved prompt");
  const model=(await service.listPresets()).presets.find(p=>p.kind==="model")!;
  await service.savePreset({kind:"model",name:model.name,slug:model.slug,settings:{model:"updated-model"},expectedRevision:model.revision},model.id);
  expect((await service.getSkillSettings(id)).defaults.model).toBe("updated-model");
  await expect(service.setSkillSettings(id,{expectedRevision:initial.revision,defaults:{prompt:"Old mutation"}})).rejects.toMatchObject({status:410,code:"settings_retired"});
  const request=()=>new Request(f.env.APP_ORIGIN+`/api/v1/skills/${id}/settings`,{method:"PUT",headers:{Origin:f.env.APP_ORIGIN,"Content-Type":"application/json"},body:JSON.stringify({expectedRevision:1,defaults:{}})});
  expect((await protectedApiFetch(request(),f.env,null,{} as ExecutionContext)).status).toBe(401);
  expect((await protectedApiFetch(request(),f.env,{...f.auth,scopes:["skills:write"]},{} as ExecutionContext)).status).toBe(403);
  expect((await protectedApiFetch(request(),f.env,{...f.auth,scopes:[...f.auth.scopes,"skills:write"]},{} as ExecutionContext)).status).toBe(410);
 }finally{await f.cleanup();}
});
