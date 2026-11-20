import { expect,it,vi } from "vitest";
import { loadingFixture } from "./helpers/loading-fixture";
import { installSkillArtifacts } from "./helpers/memory-skill-git";
import { SkillLibrary } from "../src/skill-library";
import { ApiService } from "../src/flow-service";
import { readSkillDefinition } from "../src/skill-definition";
vi.mock("../src/skill-git",()=>({withSkillGit:vi.fn()}));
vi.mock("cloudflare:workers",()=>({WorkerEntrypoint:class{},DurableObject:class{}}));
vi.mock("@cloudflare/workers-oauth-provider",()=>({OAuthProvider:class{},AuthorizationError:class extends Error{},getOAuthApi:vi.fn()}));
it.skipIf(!process.env.AUTH_TEST_DATABASE_URL)("commits structured edits and selector autosaves to SKILL.md preserving unknown YAML and conditional revisions",async()=>{
 const f=await loadingFixture(process.env.AUTH_TEST_DATABASE_URL!);
 try{
  installSkillArtifacts(f.env);await new SkillLibrary(f.env,f.tenantId).configure({kind:"managed"});
  const service=new ApiService(f.env,{...f.auth,scopes:[...f.auth.scopes,"skills:read","skills:write"]});
  const source="---\nname: structured\ndescription: Example\nlicense: MIT\nmetadata:\n  retained: yes\n---\n# Hello\n";
  const skill=await service.createSkill({key:"structured",body:source});
  const vm=await service.savePreset({kind:"vm",name:"Development",slug:"development",settings:{provider:"none"}});
  const definition=readSkillDefinition(source,"structured");definition.factorize["vm-preset"]=vm.preset.slug;
  const saved=await service.updateSkill(skill.id,{definition,expectedRevision:skill.revision});
  const current=await service.getSkill(skill.id);
  expect(current.body).toContain("license: MIT");expect(current.body).toContain("retained: yes");expect(current.definition?.factorize["vm-preset"]).toBe("development");expect(current.definition?.markdown).toBe("# Hello\n");
  const index=(await f.db.pool.query("SELECT definition FROM app.skills WHERE tenant_id=$1 AND id=$2",[f.tenantId,skill.id])).rows[0].definition;
  expect(index).not.toHaveProperty("markdown");expect(JSON.stringify(index)).not.toContain("Hello");
  const directory=await service.getSkillDirectory(skill.id);
  expect(atob(directory.files.find(file=>file.path==="SKILL.md")!.content)).toBe(current.body);
  expect(directory.commit).toBeTruthy();
  await expect(service.updateSkill(skill.id,{definition:{...definition,markdown:"Stale"},expectedRevision:skill.revision})).rejects.toMatchObject({status:409});
  expect((await service.getSkill(skill.id)).body).toBe(current.body);
  const next=await service.updateSkill(skill.id,{definition:{...definition,description:"Updated",markdown:"# Updated",factorize:{concurrency:0,disabled:true}},expectedRevision:saved.revision});
  expect(next.definition).toMatchObject({description:"Updated",markdown:"# Updated",factorize:{concurrency:0,disabled:true}});
  expect(next.definition?.factorize["vm-preset"]).toBeUndefined();
 }finally{await f.cleanup();}
});
