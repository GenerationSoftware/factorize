import {describe,it,expect,vi} from "vitest";
import {loadingFixture} from "./helpers/loading-fixture";
import {CredentialRepository} from "../src/postgres/credential-repository";
import {PiTelemetry} from "../src/pi-telemetry";
import {protectedApiFetch} from "../src/protected-api";
vi.mock("cloudflare:workers",()=>({WorkerEntrypoint:class{},WorkflowEntrypoint:class{},DurableObject:class{}}));
vi.mock("@cloudflare/workers-oauth-provider",()=>({OAuthProvider:class{},AuthorizationError:class extends Error{},getOAuthApi:vi.fn()}));
describe.skipIf(!process.env.AUTH_TEST_DATABASE_URL)("telemetry/pricing public API",()=>{
 it("bounds reads, reconciles totals, authorizes access and snapshots override rates",async()=>{
  const f=await loadingFixture(process.env.AUTH_TEST_DATABASE_URL!);
  try{
   const call=(path:string,body?:object,auth=f.auth)=>protectedApiFetch(new Request(f.env.APP_ORIGIN+path,{method:body?"PUT":"GET",headers:{Origin:f.env.APP_ORIGIN,"Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{})}),f.env,auth,{} as any);
   const empty=await (await call(`/api/v1/runs/${f.runId}/telemetry`)).json() as any;expect(empty.available).toBe(false);
   const account=crypto.randomUUID();await new CredentialRepository(f.db,f.tenantId,f.env.CREDENTIAL_ENCRYPTION_KEY).write({id:account,kind:"model",name:"Model",origin:null,description:null,expectedRevision:0,idempotencyKey:crypto.randomUUID(),operation:"upsert",managedModelPayload:JSON.stringify({providerUrl:"https://models.example.com/v1"})});await f.db.pool.query("UPDATE app.runs SET execution_config=jsonb_set(execution_config,'{modelAccountId}',to_jsonb($3::text)) WHERE tenant_id=$1 AND id=$2",[f.tenantId,f.runId,account]);
   const override={integrationId:account,model:"custom",rates:{input:1,output:2,cacheRead:0.1,cacheWrite:1},expectedRevision:0};expect((await call("/api/v1/model-pricing",override)).status).toBe(200);expect((await call("/api/v1/model-pricing",override)).status).toBe(409);
   const telemetry=new PiTelemetry(f.db,f.env.CREDENTIAL_ENCRYPTION_KEY,f.tenantId,f.runId);await telemetry.begin("run","run","Pi run");await telemetry.begin("model:1","model","Model one",{text:"long".repeat(20000)},"run",{"llm.model_name":"custom"});await telemetry.end("model:1",{text:"answer"},"ok",{},{input:70,output:20,cacheRead:30,cacheWrite:0,reasoning:5});
   expect((await call("/api/v1/model-pricing",{...override,rates:{...override.rates,input:10},expectedRevision:1})).status).toBe(200);
   await telemetry.begin("model:2","model","Model two",{},"run",{"llm.model_name":"custom"});await telemetry.end("model:2",{},"error",{},{input:70,output:20,cacheRead:30,cacheWrite:0,reasoning:5});await telemetry.finish("error");
   const first=await (await call(`/api/v1/runs/${f.runId}/telemetry?limit=2`)).json() as any;expect(first.items).toHaveLength(2);expect(first.items.find((row:any)=>row.kind==="run").usage.total).toBe(240);expect(first.nextCursor).toBe(2);expect(first.summary.usage).toMatchObject({input:200,uncachedInput:140,output:40,reasoning:10,total:240});expect(first.summary.costUsd).toBeCloseTo(0.000113+0.000743);expect(first.summary.unpricedCalls).toBe(0);
   const next=await (await call(`/api/v1/runs/${f.runId}/telemetry?limit=2&cursor=2`)).json() as any;expect(next.items).toHaveLength(1);expect(next.nextCursor).toBeNull();
   const model=first.items.find((row:any)=>row.key==="model:1");expect(model.costUsd).toBeCloseTo(0.000113);const content=await (await call(`/api/v1/runs/${f.runId}/telemetry/${model.id}?field=input&limit=1000`)).json() as any;expect(content.text.length).toBe(1000);expect(content.next).toEqual({chunk:0,offset:1000});expect(content.pricing.revision).toBe(1);expect(JSON.stringify(first)).not.toContain("longlonglong");
   expect((await call(`/api/v1/runs/${f.runId}/telemetry`,undefined,{...f.auth,scopes:[]})).status).toBe(403);expect((await call(`/api/v1/runs/${crypto.randomUUID()}/telemetry`)).status).toBe(404);expect((await call(`/api/v1/runs/${f.runId}/telemetry/${model.id}?limit=5000`)).status).toBe(400);
  }finally{await f.cleanup();}
 });
});
