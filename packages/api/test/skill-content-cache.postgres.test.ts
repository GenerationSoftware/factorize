import { beforeAll,afterAll,afterEach,describe,expect,it,vi } from "vitest";
import { loadingFixture } from "./helpers/loading-fixture";
import { SkillContent } from "../src/skill-content";
import { PostgresSkillContentCache } from "../src/postgres/skill-content-cache";
import { withSkillGit } from "../src/skill-git";
import { markdown,type Directory } from "../src/skill-files";
import { ApiService } from "../src/flow-service";
import { decrypt } from "../src/crypto";
vi.mock("cloudflare:workers",()=>({WorkerEntrypoint:class{},DurableObject:class{}}));
vi.mock("@cloudflare/workers-oauth-provider",()=>({OAuthProvider:class{},AuthorizationError:class extends Error{},getOAuthApi:vi.fn()}));
vi.mock("../src/skill-git",()=>({withSkillGit:vi.fn()}));
describe.skipIf(!process.env.AUTH_TEST_DATABASE_URL)("persistent skill directory cache",()=>{
 let f:Awaited<ReturnType<typeof loadingFixture>>,id:string,dirs:Directory[];
 const ref={repo:"fixture",remote:"https://local.test/library.git",commit:"a".repeat(40),key:"cached-skill"};
 beforeAll(async()=>{
  f=await loadingFixture(process.env.AUTH_TEST_DATABASE_URL!);id=crypto.randomUUID();
  f.env.SKILL_ARTIFACTS={get:async()=>({createToken:async()=>({plaintext:"fixture-token"})})} as any;
  dirs=[{key:ref.key,files:[markdown("Cached instructions"),{path:"nested/file.txt",content:btoa("Nested text"),executable:false},{path:"image.bin",content:btoa("\x00\xff"),executable:false}]}];
  vi.mocked(withSkillGit).mockImplementation(async()=>structuredClone(dirs) as any);
  await f.db.pool.query("INSERT INTO app.skills(tenant_id,id,key,artifact_version) VALUES($1,$2,$3,$4)",[f.tenantId,id,ref.key,ref]);
 });
 afterAll(async()=>{await f?.cleanup();});
 const service=()=>new ApiService(f.env,{...f.auth,scopes:[...f.auth.scopes,"skills:read"]});
 it("fetches once across independent API requests and encrypts cached content",async()=>{
  const first=await service().getSkillDirectory(id);expect(first.files).toHaveLength(3);
  expect((await service().getSkillDirectory(id)).files).toEqual(first.files);
  expect(withSkillGit).toHaveBeenCalledTimes(1);
  const encrypted=(await f.db.pool.query("SELECT encrypted_content FROM app.skill_content_cache WHERE tenant_id=$1",[f.tenantId])).rows[0].encrypted_content;
  expect(encrypted).not.toContain("Cached instructions");expect(await decrypt(encrypted,f.env.CREDENTIAL_ENCRYPTION_KEY)).toContain("nested/file.txt");
 });
 it("selects new commits after edits/sync and preserves older pinned commits",async()=>{
  dirs=[{key:ref.key,files:[markdown("New instructions")]}];
  await f.db.pool.query("UPDATE app.skills SET artifact_version=$3,revision=revision+1 WHERE tenant_id=$1 AND id=$2",[f.tenantId,id,{...ref,commit:"b".repeat(40)}]);
  const next=await service().getSkillDirectory(id);expect(next.revision).toBe(2);expect(atob(next.files[0].content)).toBe("New instructions");expect(withSkillGit).toHaveBeenCalledTimes(2);
  const old=await new SkillContent(undefined,new PostgresSkillContentCache(f.db,f.tenantId,f.env.CREDENTIAL_ENCRYPTION_KEY)).read({artifact_version:ref},async value=>value);
  expect(old.body).toBe("Cached instructions");expect(withSkillGit).toHaveBeenCalledTimes(2);
 });
 it("isolates tenants, rejects paths before caching and reads warm versions during upstream failure",async()=>{
  const otherCache=new PostgresSkillContentCache(f.db,f.otherTenant,f.env.CREDENTIAL_ENCRYPTION_KEY);
  expect(await otherCache.get(JSON.stringify([ref.repo,ref.remote]),ref.commit)).toBeUndefined();
  const privateId=crypto.randomUUID();await f.db.pool.query("INSERT INTO app.skills(tenant_id,id,key,artifact_version) VALUES($1,$2,'private-context',$3)",[f.otherTenant,privateId,ref]);
  await expect(service().getSkillDirectory(privateId)).rejects.toMatchObject({status:404});
  dirs=[{key:ref.key,files:[markdown("Invalid"),{path:"../secret",content:"",executable:false}]}];
  await expect(new SkillContent(f.env.SKILL_ARTIFACTS,otherCache).read({artifact_version:ref},async value=>value)).rejects.toThrow();
  expect(await otherCache.get(JSON.stringify([ref.repo,ref.remote]),ref.commit)).toBeUndefined();
  vi.mocked(withSkillGit).mockRejectedValue(new Error("Upstream offline"));
  expect((await service().getSkillDirectory(id)).revision).toBe(2);
  await expect(new SkillContent(f.env.SKILL_ARTIFACTS,otherCache).read({artifact_version:ref},async value=>value)).rejects.toThrow("Upstream offline");
 });
});
