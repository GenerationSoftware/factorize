import {beforeAll,afterAll,describe,it,expect,vi} from "vitest";
import {loadingFixture} from "./helpers/loading-fixture";
import {protectedApiFetch} from "../src/protected-api";
import {CredentialRepository} from "../src/postgres/credential-repository";
import {configuredPiProvider} from "../src/pi-provider";
vi.mock("cloudflare:workers",()=>({WorkerEntrypoint:class{},WorkflowEntrypoint:class{},DurableObject:class{}}));
vi.mock("@cloudflare/workers-oauth-provider",()=>({OAuthProvider:class{},AuthorizationError:class extends Error{},getOAuthApi:vi.fn()}));
describe.skipIf(!process.env.AUTH_TEST_DATABASE_URL)("OpenAI-compatible provider integration contract",()=>{
 let f:Awaited<ReturnType<typeof loadingFixture>>,id:string;
 beforeAll(async()=>{f=await loadingFixture(process.env.AUTH_TEST_DATABASE_URL!);id=crypto.randomUUID();});afterAll(async()=>{await f?.cleanup();});
 const request=(path:string,method:string,body?:unknown,auth=f.auth)=>protectedApiFetch(new Request(f.env.APP_ORIGIN+path,{method,headers:{Origin:f.env.APP_ORIGIN,"Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{})}),f.env,auth,{} as any);
 it("saves a provider URL and optional key, validates limits and exposes safe metadata only",async()=>{
  const body={id,name:"Local model",description:null,expectedRevision:0,idempotencyKey:crypto.randomUUID(),providerUrl:"https://models.example/v1",apiKey:"private-model-key",contextWindow:32000,maxTokens:4000};
  expect((await request("/api/v1/model-accounts","POST",body)).status).toBe(201);
  const read=await request("/api/v1/model-accounts","GET");expect(read.status).toBe(200);const text=await read.text();expect(text).not.toContain("private-model-key");expect(JSON.parse(text).accounts[0]).toMatchObject({id,providerUrl:body.providerUrl,credentialConfigured:true,contextWindow:32000,maxTokens:4000});
  const stored=await new CredentialRepository(f.db,f.tenantId,f.env.CREDENTIAL_ENCRYPTION_KEY).managedCredential(id,"model");expect(configuredPiProvider(stored!.payload)?.apiKey).toBe("private-model-key");
  expect((await request("/api/v1/model-accounts","POST",body,{...f.auth,authMethod:"oauth"})).status).toBe(403);
  for(const change of [{providerUrl:"file:///etc/passwd"},{providerUrl:"https://user:secret@models.example/v1"},{maxTokens:40000},{initialState:'{"OPENAI_API_KEY":"retired"}'}])expect((await request("/api/v1/model-accounts","POST",{...body,...change})).status).toBe(400);
 });
 it("supports a keyless replacement and rejects another Team's account and retired authorization routes",async()=>{
  const body={name:"Keyless",description:null,expectedRevision:1,idempotencyKey:crypto.randomUUID(),providerUrl:"https://keyless.example/v1"};
  expect((await request(`/api/v1/model-accounts/${id}`,"PUT",body)).status).toBe(200);
  const stored=await new CredentialRepository(f.db,f.tenantId,f.env.CREDENTIAL_ENCRYPTION_KEY).managedCredential(id,"model");expect(configuredPiProvider(stored!.payload)).toMatchObject({providerUrl:body.providerUrl});expect(configuredPiProvider(stored!.payload)?.apiKey).toBeUndefined();
  expect((await request(`/api/v1/model-accounts/${crypto.randomUUID()}`,"PUT",body)).status).toBe(404);
  for(const action of ["authorize","status","cancel"])expect((await request(`/api/v1/model-accounts/${id}/authorization/${action}`,"POST",{})).status).toBe(404);
 });
 it("rejects retired managed harness selections in the public run and Trigger contracts",async()=>{
  for(const input of [{modelProvider:"codex"},{modelProvider:"claude"},{modelAccess:"native"}])expect((await request("/api/v1/triggers","POST",{name:"retired-agent",...input})).status).toBe(400);
  expect((await request("/api/v1/runs","POST",{prompt:"Work",modelProvider:"codex"}, {...f.auth,scopes:[...f.auth.scopes,"runs:start"]})).status).toBe(400);
 });
});
