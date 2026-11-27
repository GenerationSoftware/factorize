import {beforeAll,afterAll,describe,it,expect,vi} from "vitest";
import {createHash} from "node:crypto";
import {loadingFixture} from "./helpers/loading-fixture";
import {ProxyPayloads,createPayloadInput,appendPayloadInput,attachmentInput,proxyRequestBody} from "../src/proxy/application/proxy-payloads";
import {CredentialRepository} from "../src/credentials/storage/credential-repository";
import {AgentApiService} from "../src/proxy/application/agent-api";
import {requestApiInput} from "../src/proxy/api/agent-api-contracts";
import {protectedApiFetch} from "../src/protected-api";
vi.mock("cloudflare:workers",()=>({WorkerEntrypoint:class{},WorkflowEntrypoint:class{},DurableObject:class{}}));
vi.mock("@cloudflare/workers-oauth-provider",()=>({OAuthProvider:class{},AuthorizationError:class extends Error{},getOAuthApi:vi.fn()}));
describe.skipIf(!process.env.AUTH_TEST_DATABASE_URL)("temporary payloads and attachment contracts",()=>{
 let f:Awaited<ReturnType<typeof loadingFixture>>,payloads:ProxyPayloads,auth:any,integration:string;const objects=new Map<string,Uint8Array>();
 beforeAll(async()=>{
  f=await loadingFixture(process.env.AUTH_TEST_DATABASE_URL!);auth={...f.auth,authMethod:"oauth",oauthGrantId:"payloads",oauthClientId:"fixture",oauthExpiresAt:Date.now()/1000+3600,scopes:["proxy:use","triggers:read"]};payloads=new ProxyPayloads(f.env,auth);
  f.env.PROXY_ARTIFACTS={put:async(k:string,v:ArrayBuffer)=>objects.set(k,new Uint8Array(v).slice()),get:async(k:string,o:any)=>{let bytes=objects.get(k);if(!bytes)return null;bytes=o?.range?bytes.slice(o.range.offset,o.range.offset+o.range.length):bytes;return {arrayBuffer:async()=>bytes!.buffer,body:new ReadableStream({start(c){c.enqueue(bytes!);c.close();}})};}} as any;
  const id=crypto.randomUUID();await new CredentialRepository(f.db,f.tenantId,f.env.CREDENTIAL_ENCRYPTION_KEY).write({id,kind:"bearer",name:"Fixture",origin:"https://fixture.example.com",description:null,expectedRevision:0,idempotencyKey:crypto.randomUUID(),operation:"upsert",managedSecret:"private-upstream"});integration=(await f.db.pool.query("UPDATE app.agent_integrations SET policy='baseline' WHERE tenant_id=$1 AND credential_id=$2 RETURNING id",[f.tenantId,id])).rows[0].id;
 });
 afterAll(async()=>{vi.unstubAllGlobals();await f?.cleanup();});
 const create=(extra:object={})=>payloads.create(createPayloadInput.parse(extra));
 it("stages exact bytes, enforces order/idempotency/checksum/finalization and streams raw/multipart bodies",async()=>{
  const row=await create({name:"input.txt",byteSize:5}),chunk=appendPayloadInput.parse({handle:row.handle,offset:0,body:"hello"});await payloads.append(chunk);await payloads.append(chunk);
  await expect(payloads.append({...chunk,body:"other"})).rejects.toMatchObject({code:"chunk_conflict"});
  await expect(payloads.append({...chunk,offset:2})).rejects.toMatchObject({code:"invalid_offset"});
  await expect(proxyRequestBody(f.env,auth,{bodySource:{kind:"payload",handle:row.handle},headers:{},encoding:"utf8"})).rejects.toMatchObject({code:"payload_incomplete"});
  await expect(payloads.finalize({handle:row.handle,sha256:"0".repeat(64)})).rejects.toMatchObject({code:"checksum_mismatch"});
  const ready=await payloads.finalize({handle:row.handle});expect(ready.sha256).toBe(createHash("sha256").update("hello").digest("hex"));await expect(payloads.append(chunk)).rejects.toMatchObject({code:"payload_immutable"});
  const source={kind:"payload" as const,handle:row.handle};const raw=await proxyRequestBody(f.env,auth,{bodySource:source,headers:{},encoding:"utf8"});expect(await new Response(raw.body).text()).toBe("hello");
  const multi=await proxyRequestBody(f.env,auth,{multipart:[{name:"file",filename:"input.txt",source,mediaType:"text/plain"},{name:"description",text:"example"}],headers:{"content-type":"wrong"},encoding:"utf8"});const text=await new Response(multi.body).text();expect(multi.headers["Content-Type"]).toMatch(/^multipart\/form-data; boundary=/);expect(text).toContain('name="file"; filename="input.txt"\r\nContent-Type: text/plain\r\n\r\nhello');expect(text).toContain("example");
 });
 it("imports native file parameters without credential headers, rejects redirects/private/expired/oversize URLs",async()=>{
  const requests:any[]=[];vi.stubGlobal("fetch",async(url:any,init:any)=>{requests.push({url:String(url),init});return new Response(new Uint8Array([0,255,128]),{headers:{"Content-Type":"application/pdf"}});});
  const file={file_id:"file-fixture",download_url:"https://files.oaiusercontent.com/fixture?token=never-log-this",file_name:"file.pdf",mime_type:"application/pdf"};
  try{const imported=await payloads.importAttachment({file});expect(imported).toMatchObject({state:"ready",size:3});expect(JSON.stringify(imported)).not.toContain("never-log-this");expect(requests[0].init.redirect).toBe("manual");expect(requests[0].init.headers).toBeUndefined();expect(await new Response((await proxyRequestBody(f.env,auth,{bodySource:{kind:"payload",handle:imported.handle},headers:{},encoding:"utf8"})).body).arrayBuffer()).toEqual(new Uint8Array([0,255,128]).buffer);
   for(const download_url of ["http://127.0.0.1/file","https://127.0.0.1/file","https://files.oaiusercontent.com.evil.com/file","https://user:pass@files.oaiusercontent.com/file"])await expect(payloads.importAttachment({file:{...file,download_url}})).rejects.toMatchObject({code:"invalid_attachment"});expect(requests).toHaveLength(1);
   for(const status of [302,403]){vi.stubGlobal("fetch",async()=>new Response(null,{status,headers:{Location:"http://127.0.0.1/private"}}));await expect(payloads.importAttachment({file})).rejects.toMatchObject({code:"attachment_unavailable"});}
   vi.stubGlobal("fetch",async()=>new Response(new Uint8Array(32*1024*1024+1)));await expect(payloads.importAttachment({file})).rejects.toMatchObject({code:"request_too_large"});
   expect(attachmentInput.safeParse({file:"chat_upload://image"}).success).toBe(false);
  }finally{vi.unstubAllGlobals();}
 });
 it("authorizes browser upload on behalf of a connection and isolates foreign/expired/revoked handles",async()=>{
  const row=await create({name:"browser.txt",byteSize:7});
  const put=new Request(row.uploadUrl,{method:"PUT",headers:{Origin:f.env.APP_ORIGIN,"Content-Type":"application/octet-stream"},body:"browser"});
  const response=await protectedApiFetch(put,f.env,f.auth,{} as any);expect(response.status,await response.clone().text()).toBe(200);expect(await response.json()).toMatchObject({handle:row.handle,state:"ready",size:7});
  const denied=await protectedApiFetch(new Request(row.uploadUrl,{method:"PUT",body:"other"}),f.env,null,{} as any);expect(denied.status).toBe(401);
  await expect(new ProxyPayloads(f.env,{...auth,oauthGrantId:"foreign"}).get(row.handle)).rejects.toMatchObject({status:403});
  const expired=await create();await f.db.pool.query("UPDATE app.proxy_payloads SET expires_at=now()-interval '1 second' WHERE tenant_id=$1 AND id=$2",[f.tenantId,expired.handle]);await expect(payloads.get(expired.handle)).rejects.toMatchObject({status:404});
 });
 it("uses integration imports, retained responses and payloads as request sources",async()=>{
  vi.stubGlobal("fetch",async()=>new Response("source data"));
  try{const imported=await payloads.importIntegration({integration,path:"/file",mediaType:"text/plain"});expect(imported).toMatchObject({state:"ready",size:11});
   const api=new AgentApiService(f.env,auth);const response=await api.request(requestApiInput.parse({integration,method:"GET",path:"/file",maxResultBytes:2048}));
   let observed="";vi.stubGlobal("fetch",async(_url:any,init:any)=>{observed=await new Response(init.body).text();return Response.json({ok:true});});await api.request(requestApiInput.parse({integration,method:"POST",path:"/upload",bodySource:{kind:"payload",handle:imported.handle}}));expect(observed).toBe("source data");
   expect(response.body).toBe("source data");
   vi.stubGlobal("fetch",async()=>new Response("retained".repeat(1000)));const retained=await api.request(requestApiInput.parse({integration,method:"GET",path:"/large",maxResultBytes:2048}));expect(retained.handle).toBeDefined();const fromResponse=await proxyRequestBody(f.env,auth,{bodySource:{kind:"response",handle:retained.handle!},headers:{},encoding:"utf8"});expect(await new Response(fromResponse.body).text()).toBe("retained".repeat(1000));
   await f.db.pool.query("UPDATE app.agent_identities SET revoked_at=now() WHERE tenant_id=$1 AND kind='oauth' AND subject='payloads'",[f.tenantId]);await expect(payloads.get(imported.handle)).rejects.toMatchObject({status:401});
  }finally{vi.unstubAllGlobals();}
 });
});
