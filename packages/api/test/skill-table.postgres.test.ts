import { expect,it,vi } from "vitest";
import { loadingFixture } from "./helpers/loading-fixture";
import { ApiService } from "../src/flow-service";
import { encrypt } from "../src/crypto";
import { readSkillDefinition,writeSkillDefinition } from "../src/skill-definition";
vi.mock("cloudflare:workers",()=>({WorkerEntrypoint:class{},DurableObject:class{}}));
vi.mock("@cloudflare/workers-oauth-provider",()=>({OAuthProvider:class{},AuthorizationError:class extends Error{},getOAuthApi:vi.fn()}));
it.skipIf(!process.env.AUTH_TEST_DATABASE_URL)("lists descriptions and preset references without bodies and counts disabled non-manual events",async()=>{
 const f=await loadingFixture(process.env.AUTH_TEST_DATABASE_URL!);
 try{
  const service=new ApiService(f.env,{...f.auth,scopes:[...f.auth.scopes,"skills:read"]});await service.listPresets();
  for(const [i,key] of ["no-trigger","manual-only","disabled-automation"].entries()){
   const id=crypto.randomUUID(),definition=readSkillDefinition("Body secret",key);definition.description="Description "+key;
   await f.db.pool.query("INSERT INTO app.skills(tenant_id,id,key,definition,encrypted_body) VALUES($1,$2,$3,$4,$5)",[f.tenantId,id,key,definition,await encrypt(writeSkillDefinition("",definition),f.env.CREDENTIAL_ENCRYPTION_KEY)]);
   if(i>0)await f.db.pool.query("INSERT INTO app.trigger_skills(tenant_id,trigger_id,skill_id,position) VALUES($1,$2,$3,0)",[f.tenantId,f.triggerIds[i],id]);
   if(i===1)await f.db.pool.query("DELETE FROM app.events WHERE tenant_id=$1 AND trigger_id=$2 AND kind<>'manual'",[f.tenantId,f.triggerIds[i]]);
   if(i===2){await f.db.pool.query("UPDATE app.events SET enabled=false WHERE tenant_id=$1 AND trigger_id=$2",[f.tenantId,f.triggerIds[i]]);await f.db.pool.query("UPDATE app.triggers SET enabled=false WHERE tenant_id=$1 AND id=$2",[f.tenantId,f.triggerIds[i]]);}
  }
  const page=await service.listSkills({q:"",limit:100});
  expect(Object.fromEntries(page.items.map(s=>[s.key,s.hasTriggers]))).toEqual({"no-trigger":false,"manual-only":false,"disabled-automation":true});
  expect(page.items.every(s=>s.description===`Description ${s.key}`)).toBe(true);
  expect(JSON.stringify(page)).not.toContain("Body secret");
  const small=await service.listSkills({q:"",limit:1});expect(small.nextCursor).toBeTruthy();
  const next=await service.listSkills({q:"",limit:1,cursor:small.nextCursor!});expect(next.items[0].id).not.toBe(small.items[0].id);
 }finally{await f.cleanup();}
});
