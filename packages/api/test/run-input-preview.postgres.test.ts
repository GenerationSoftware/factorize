import {beforeAll,afterAll,describe,it,expect,vi} from "vitest";
import {loadingFixture} from "./helpers/loading-fixture";
import {ApiService} from "../src/flow-service";
import {CredentialRepository} from "../src/postgres/credential-repository";
import {encrypt,decrypt} from "../src/crypto";
import {triggerInputSchema,startRunInput} from "../src/flow-schemas";
import {protectedApiFetch} from "../src/protected-api";
vi.mock("cloudflare:workers",()=>({WorkerEntrypoint:class{},WorkflowEntrypoint:class{},DurableObject:class{}}));
vi.mock("@cloudflare/workers-oauth-provider",()=>({OAuthProvider:class{},AuthorizationError:class extends Error{},getOAuthApi:vi.fn()}));
describe.skipIf(!process.env.AUTH_TEST_DATABASE_URL)("immutable run Source and Prompt projections",()=>{
 let f:Awaited<ReturnType<typeof loadingFixture>>,api:ApiService,skillId:string;
 beforeAll(async()=>{
  f=await loadingFixture(process.env.AUTH_TEST_DATABASE_URL!);f.auth.scopes.push("runs:start","skills:read");api=new ApiService(f.env,f.auth);
  const id=crypto.randomUUID();await new CredentialRepository(f.db,f.tenantId,f.env.CREDENTIAL_ENCRYPTION_KEY).write({id,kind:"model",name:"Unused fixture",origin:null,description:null,expectedRevision:0,idempotencyKey:crypto.randomUUID(),operation:"upsert",managedModelPayload:JSON.stringify({providerUrl:"http://127.0.0.1:1/v1"})});await api.setTeamRunDefaults({modelAccountId:id,model:"fixture",requiresVm:false,capacity:50,runScopes:[]});
  skillId=crypto.randomUUID();await f.db.pool.query("INSERT INTO app.skills(tenant_id,id,key,encrypted_body) VALUES($1,$2,'review-guide',$3)",[f.tenantId,skillId,await encrypt("Reusable skill instructions",f.env.CREDENTIAL_ENCRYPTION_KEY)]);
 });
 afterAll(async()=>{await f?.cleanup();});
 it("snapshots Trigger and skill names, composes optional Event/manual text without skill body and keeps the run name",async()=>{
  const trigger=await api.createTrigger(triggerInputSchema.parse({name:"original-trigger",prompt:"Base {{literal}}",skillId,events:[{kind:"manual",config:{},template:"Issue {{data.id}}"}]}));
  const receipt=await api.invokeTrigger(trigger.id,{name:"Keep this run name",prompt:"Caller instructions",data:{id:7}});
  await api.updateTrigger(trigger.id,triggerInputSchema.parse({name:"renamed-trigger",prompt:"Changed instructions",skillId,events:[{kind:"manual",config:{}}]}));
  await f.db.pool.query("UPDATE app.skills SET key='renamed-guide' WHERE tenant_id=$1 AND id=$2",[f.tenantId,skillId]);
  const item=(await api.listRuns(new URLSearchParams({triggerId:trigger.id}))).items.find((item:any)=>item.id===receipt.runId)!;
  expect(item).toMatchObject({source:"original-trigger",run_name:"Keep this run name",launch_skill_key:"review-guide",prompt_preview:"Base {{literal}} Issue 7 Caller instructions"});expect(item).not.toHaveProperty("encrypted_preview");
  const detail=await api.getRun(receipt.runId);expect(detail.context_prompt).toBe("Base {{literal}}\n\nIssue 7\n\nCaller instructions");expect(detail.prompt).toBe("Reusable skill instructions\n\n"+detail.context_prompt);
  await api.deleteTrigger(trigger.id);await f.db.pool.query("DELETE FROM app.skills WHERE tenant_id=$1 AND id=$2",[f.tenantId,skillId]);
  const retained=(await api.listRuns(new URLSearchParams())).items.find((item:any)=>item.id===receipt.runId)!;expect(retained).toMatchObject({source:"original-trigger",launch_skill_key:"review-guide",prompt_preview:item.prompt_preview});
 });
 it("uses manual for direct runs, optional skill prefixes and bounded literal previews while preserving full detail",async()=>{
  const skill=crypto.randomUUID();await f.db.pool.query("INSERT INTO app.skills(tenant_id,id,key,encrypted_body) VALUES($1,$2,'direct-guide',$3)",[f.tenantId,skill,await encrypt("Direct skill body",f.env.CREDENTIAL_ENCRYPTION_KEY)]);
  const literal="😀 "+"Long prompt <script>\n".repeat(80),receipt=await api.startRun(startRunInput.parse({name:"Direct named run",skill,prompt:literal}));
  const item=(await api.listRuns(new URLSearchParams())).items.find((item:any)=>item.id===receipt.runId)!;expect(item).toMatchObject({source:"manual",run_name:"Direct named run",launch_skill_key:"direct-guide"});expect(Array.from(item.prompt_preview)).toHaveLength(241);expect(item.prompt_preview.endsWith("…")).toBe(true);expect(item.prompt_preview).not.toContain("Direct skill body");
  expect((await api.getRun(receipt.runId)).context_prompt).toBe(literal);
  const stored=(await f.db.pool.query("SELECT encrypted_prompt_preview,encrypted_context_prompt FROM app.runs WHERE tenant_id=$1 AND id=$2",[f.tenantId,receipt.runId])).rows[0];expect(stored.encrypted_prompt_preview).not.toContain("Long prompt");expect(await decrypt(stored.encrypted_context_prompt,f.env.CREDENTIAL_ENCRYPTION_KEY)).toBe(literal);
  const skillOnly=await api.startRun(startRunInput.parse({skill}));expect((await api.getRun(skillOnly.runId)).prompt_preview).toBe("");
 });
 it("shows a shortened script instead of an agent prompt and preserves old rows without previews",async()=>{
  const script="printf '%s\\n' hello\n".repeat(80),receipt=await api.startRun(startRunInput.parse({prompt:"Historical row fixture"}));
  await f.db.pool.query("UPDATE app.runs SET encrypted_prompt_preview=NULL,execution_config=execution_config||$3::jsonb WHERE tenant_id=$1 AND id=$2",[f.tenantId,receipt.runId,{executionType:"code",script}]);
  const item=(await api.listRuns(new URLSearchParams())).items.find((item:any)=>item.id===receipt.runId)!;expect(item.execution_type).toBe("code");expect(item.prompt_preview).toContain("printf");expect(item.prompt_preview.endsWith("…")).toBe(true);expect((await api.getRun(receipt.runId)).execution_script).toBe(script);
  const legacy=(await api.listRuns(new URLSearchParams())).items.find((item:any)=>item.id===f.runId)!;expect(legacy.prompt_preview).toBe("Prompt");expect(legacy.source).toBeTruthy();
 });
 it("exposes the new fields through the authorized public boundary and sorts/paginates by source snapshots",async()=>{
  const response=await protectedApiFetch(new Request(f.env.APP_ORIGIN+"/api/v1/runs?sort=source&limit=2"),f.env,f.auth,{waitUntil(){}} as any);expect(response.status).toBe(200);const page=await response.json() as any;expect(page.items).toHaveLength(2);expect(page.items.every((item:any)=>typeof item.source==="string"&&typeof item.prompt_preview==="string")).toBe(true);expect(page.items[0].source.localeCompare(page.items[1].source)).toBeLessThanOrEqual(0);
  const denied=await protectedApiFetch(new Request(f.env.APP_ORIGIN+"/api/v1/runs"),f.env,{...f.auth,scopes:[]},{waitUntil(){}} as any);expect(denied.status).toBe(403);
  if(page.nextCursor){const next=await api.listRuns(new URLSearchParams({sort:"source",limit:"2",cursor:page.nextCursor}));expect(next.items.some((item:any)=>page.items.some((prior:any)=>prior.id===item.id))).toBe(false);}
 });
});
