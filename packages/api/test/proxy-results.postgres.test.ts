import {beforeAll,afterAll,describe,it,expect,vi} from "vitest";
import {AgentApiService} from "../src/agent-api";
import {requestApiInput,queryApiResponseInput} from "../src/agent-api-contracts";
import {proxyResultSize} from "../src/proxy-result";
import {CredentialRepository} from "../src/postgres/credential-repository";
import {loadingFixture} from "./helpers/loading-fixture";
vi.mock("cloudflare:workers",()=>({WorkerEntrypoint:class{},WorkflowEntrypoint:class{},DurableObject:class{}}));
vi.mock("@cloudflare/workers-oauth-provider",()=>({OAuthProvider:class{},AuthorizationError:class extends Error{},getOAuthApi:vi.fn()}));
describe.skipIf(!process.env.AUTH_TEST_DATABASE_URL)("bounded retained proxy responses",()=>{
 let f:Awaited<ReturnType<typeof loadingFixture>>,service:AgentApiService,integration:string;
 const objects=new Map<string,Uint8Array>();let maxWrite=0;
 beforeAll(async()=>{
  f=await loadingFixture(process.env.AUTH_TEST_DATABASE_URL!);const id=crypto.randomUUID();
  await new CredentialRepository(f.db,f.tenantId,f.env.CREDENTIAL_ENCRYPTION_KEY).write({id,kind:"bearer",name:"Fixture",origin:"https://fixture.example.com",description:null,expectedRevision:0,idempotencyKey:crypto.randomUUID(),operation:"upsert",managedSecret:"private"});
  integration=(await f.db.pool.query("UPDATE app.agent_integrations SET policy='baseline' WHERE tenant_id=$1 AND credential_id=$2 RETURNING id",[f.tenantId,id])).rows[0].id;
  f.env.RUN_ARTIFACTS={put:async(key:string,value:ArrayBuffer)=>{maxWrite=Math.max(maxWrite,value.byteLength);objects.set(key,new Uint8Array(value).slice());},get:async(key:string,options:any)=>{const data=objects.get(key);if(!data)return null;const bytes=options?.range?data.slice(options.range.offset,options.range.offset+options.range.length):data;return {arrayBuffer:async()=>bytes.buffer};}} as any;
  service=new AgentApiService(f.env,{...f.auth,authMethod:"oauth",oauthGrantId:"responses",oauthClientId:"fixture",oauthExpiresAt:Date.now()/1000+3600,scopes:["proxy:use"]});
 });
 afterAll(async()=>{vi.unstubAllGlobals();await f?.cleanup();});
 const request=async(body:string|Uint8Array,budget=4096)=>{
  const bytes=typeof body==="string"?new TextEncoder().encode(body):body;
  let offset=0;vi.stubGlobal("fetch",async()=>new Response(new ReadableStream({pull(controller){if(offset>=bytes.length){controller.close();return;}controller.enqueue(bytes.slice(offset,offset+8192));offset+=8192;}}),{headers:{"Content-Type":"application/json","Authorization":"secret","Set-Cookie":"secret","X-Api-Key":"secret"}}));
  try{return await service.request(requestApiInput.parse({integration,method:"GET",path:"/",maxResultBytes:budget}));}finally{vi.unstubAllGlobals();}
 };
 it("bounds complete duplicated MCP results and preserves exact UTF8, escaped and binary bytes",async()=>{
  for(const budget of [2048,4096,32768])for(const body of [JSON.stringify({value:'😀\n"\\'.repeat(5000)}),new Uint8Array(20000).fill(255),"\u0000".repeat(1000)]){
   const result=await request(body,budget);expect(proxyResultSize(result)).toBeLessThanOrEqual(budget);expect(result.headers).not.toHaveProperty("authorization");expect(result.headers).not.toHaveProperty("x-api-key");
   if(!result.handle){expect(Buffer.from(result.body!,result.encoding==="base64"?"base64":"utf8")).toEqual(typeof body==="string"?Buffer.from(body):Buffer.from(body));continue;}let offset=0;const chunks:Buffer[]=[];
   do{const part=await service.read({handle:result.handle!,offset,limit:65536});chunks.push(Buffer.from(part.body,"base64"));offset=part.nextOffset;if(part.done)break;}while(true);
   expect(Buffer.concat(chunks)).toEqual(typeof body==="string"?Buffer.from(body):Buffer.from(body));
  }
 });
 it("stores bounded blocks across large downloads and retains legacy REST chunks",async()=>{
  const body=new Uint8Array(2*1024*1024+93).fill(65),response=await request(body);expect(maxWrite).toBeLessThanOrEqual(1024*1024);
  const part=await service.read({handle:response.handle!,offset:1024*1024-7});expect(Buffer.from(part.body,"base64")).toEqual(Buffer.from(body.slice(1024*1024-7,1024*1024-7+65536)));expect(part.nextOffset).toBe(1024*1024-7+65536);
  await expect(service.query(queryApiResponseInput.parse({handle:response.handle,mode:"json"}))).rejects.toMatchObject({code:"query_too_large"});
 });
 it("queries JSON projections/filters, text lines and bounded binary ranges",async()=>{
  const original=JSON.stringify({items:Array.from({length:100},(_,i)=>({id:i,text:"x".repeat(200)}))}),response=await request(original);
  const query=(v:object)=>service.query(queryApiResponseInput.parse({handle:response.handle,...v}));
  expect((await query({expression:"items[?id > `95`].id"})).data).toEqual([96,97,98,99]);
  const page=await query({expression:"items[*].id",offset:25,limit:25});expect(page.nextOffset).toBe(50);expect(page.done).toBe(false);
  const bounded=await query({expression:"items",limit:100,maxResultBytes:2048});expect(proxyResultSize(bounded)).toBeLessThanOrEqual(2048);expect(bounded.nextOffset).toBeGreaterThan(0);expect(bounded.done).toBe(false);
  for(const expression of ["items[","map(&@,items)","{copy:items}"])await expect(query({expression})).rejects.toMatchObject({status:400});
  const lines=await request(Array.from({length:1000},(_,i)=>`line ${i}`).join("\n"));expect((await service.query(queryApiResponseInput.parse({handle:lines.handle,mode:"text",offset:7,limit:2}))).data).toEqual(["line 7","line 8"]);
  const bytes=await query({mode:"bytes",limit:1000,maxResultBytes:2048});expect(proxyResultSize(bytes)).toBeLessThanOrEqual(2048);expect(Buffer.from(bytes.data as string,"base64")).toEqual(Buffer.from(original).subarray(0,bytes.nextOffset));
 });
 it("expires in 30 minutes and rechecks identity, tenant, revocation and epoch",async()=>{
  const response=await request("x".repeat(2000));const handle=response.handle!;
  expect(Date.parse(response.expiresAt!)-Date.now()).toBeGreaterThan(1790_000);expect(Date.parse(response.expiresAt!)-Date.now()).toBeLessThanOrEqual(1800_000);
  const other=new AgentApiService(f.env,{...f.auth,authMethod:"oauth",oauthGrantId:"foreign",oauthClientId:"fixture",oauthExpiresAt:Date.now()/1000+3600,scopes:["proxy:use"]});await expect(other.read({handle,offset:0})).rejects.toMatchObject({status:404});
  await f.db.pool.query("UPDATE app.agent_integrations SET epoch=epoch+1 WHERE tenant_id=$1 AND id=$2",[f.tenantId,integration]);await expect(service.read({handle,offset:0})).rejects.toMatchObject({status:403});
  const next=await request("x".repeat(2000));await f.db.pool.query("UPDATE app.agent_proxy_responses SET expires_at=now()-interval '1 second' WHERE tenant_id=$1 AND id=$2",[f.tenantId,next.handle]);await expect(service.read({handle:next.handle!,offset:0})).rejects.toMatchObject({status:404});
  const revoked=await request("x".repeat(2000));await f.db.pool.query("UPDATE app.agent_identities SET revoked_at=now() WHERE tenant_id=$1 AND kind='oauth' AND subject='responses'",[f.tenantId]);await expect(service.read({handle:revoked.handle!,offset:0})).rejects.toMatchObject({status:401});
 });
});
