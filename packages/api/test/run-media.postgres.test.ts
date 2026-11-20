import worker from "../src/worker";
import {signSession} from "../src/index";
import {beforeAll,afterAll,beforeEach,describe,it,expect,vi} from "vitest";
import {createServer,type Server} from "node:http";
import {Miniflare,convertV4MiniflareOptions} from "miniflare";
import {createHash} from "node:crypto";
import {loadingFixture} from "./helpers/loading-fixture";
import {ApiService} from "../src/flow-service";
import {CredentialRepository} from "../src/postgres/credential-repository";
import {RunRepository,type PersistedRun} from "../src/postgres/run-repository";
import {HostedPi} from "../src/hosted-pi";
import {createPiMcpTools} from "../src/pi-mcp-client";
import {PiSessionRepository} from "../src/postgres/pi-session-repository";
import {RunMedia} from "../src/run-media";
import {mediaUploadInput} from "../src/media-contracts";
import {startRunInput} from "../src/flow-schemas";
import {decrypt} from "../src/crypto";
vi.mock("cloudflare:workers",()=>({WorkerEntrypoint:class{},WorkflowEntrypoint:class{},DurableObject:class{}}));
vi.mock("@cloudflare/workers-oauth-provider",()=>({OAuthProvider:class{},AuthorizationError:class extends Error{},getOAuthApi:vi.fn()}));
const image=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9WQAAAAASUVORK5CYII=","base64"),fetched=Buffer.concat([image,Buffer.from("fixture image source")]);
const sha=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
describe.skipIf(!process.env.AUTH_TEST_DATABASE_URL)("unchanged Pi media with PostgreSQL and local R2",()=>{
 let f:Awaited<ReturnType<typeof loadingFixture>>,api:ApiService,server:Server,storage:Miniflare,account:string,integration:string,requests:any[],turn:number,mode:"tools"|"final"|"result",resultArtifact:string,sourceBytes:Buffer=fetched;
 const realFetch=globalThis.fetch;
 beforeAll(async()=>{
  f=await loadingFixture(process.env.AUTH_TEST_DATABASE_URL!);f.auth.scopes.push("runs:start");api=new ApiService(f.env,f.auth);
  storage=new Miniflare(convertV4MiniflareOptions({name:"media",modules:true,script:"export default {fetch(){return new Response('ok')}}",compatibilityDate:"2026-09-10",compatibilityFlags:["nodejs_compat"],r2Buckets:["RUN_ARTIFACTS"]}));
  const bucket=await storage.getR2Bucket("RUN_ARTIFACTS");
  // The Node RPC bridge cannot preserve Worker fixed-length stream metadata.
  // Consume fixture streams here; checksum validation and storage use real R2.
  f.env.RUN_ARTIFACTS=new Proxy(bucket,{get(target,property){if(property==="put")return async(key:string,body:any,options:any)=>target.put(key,body instanceof ReadableStream?await new Response(body).arrayBuffer():body,options);const value=(target as any)[property];return typeof value==="function"?value.bind(target):value;}}) as any;
  server=createServer(async(req,res)=>{
   const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString());requests.push(body);
   let call:any;if(mode==="tools"&&turn===0)call={name:"fetch_media",arguments:JSON.stringify({integration,path:"/image",idempotencyKey:"fetched-image"})};
   if(mode==="tools"&&turn===1){const result=body.messages.filter((message:any)=>message.role==="tool").at(-1);const receipt=JSON.parse(result.content);call={name:"read_media",arguments:JSON.stringify({artifactId:receipt.artifactId})};}
   turn++;res.writeHead(200,{"Content-Type":"text/event-stream"});const delta=call?{tool_calls:[{index:0,id:"media-call-"+turn,type:"function",function:call}]}:{content:mode==="result"?JSON.stringify({status:"succeeded",summary:"Image result",outputs:{image:{artifactId:resultArtifact}}}):"Images received unchanged."};
   res.end("data: "+JSON.stringify({id:"local",object:"chat.completion.chunk",model:"fixture",choices:[{index:0,delta,finish_reason:call?"tool_calls":"stop"}]})+"\n\ndata: [DONE]\n\n");
  });await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const credentials=new CredentialRepository(f.db,f.tenantId,f.env.CREDENTIAL_ENCRYPTION_KEY);account=crypto.randomUUID();
  await credentials.write({id:account,kind:"model",name:"Local",origin:null,description:null,expectedRevision:0,idempotencyKey:crypto.randomUUID(),operation:"upsert",managedModelPayload:JSON.stringify({providerUrl:`http://127.0.0.1:${(server.address() as any).port}/v1`})});
  const credentialId=crypto.randomUUID();await credentials.write({id:credentialId,kind:"bearer",name:"Images",origin:"https://images.fixture",description:null,expectedRevision:await credentials.revision(),idempotencyKey:crypto.randomUUID(),operation:"upsert",managedSecret:"private-image-key"});
  integration=(await f.db.pool.query("SELECT id FROM app.agent_integrations WHERE tenant_id=$1 AND kind='bearer' AND credential_id=$2",[f.tenantId,credentialId])).rows[0].id;
  await api.setTeamRunDefaults({modelAccountId:account,model:"fixture",requiresVm:false,capacity:50,portableIntegrationIds:[credentialId],runScopes:[]});
  vi.stubGlobal("fetch",async(input:any,init?:RequestInit)=>{const url=typeof input==="string"?input:input instanceof URL?input.href:input.url;if(url.startsWith("https://images.fixture/")){expect(new Headers(init?.headers??input.headers).get("Authorization")).toBe("Bearer private-image-key");return new Response(new Uint8Array(sourceBytes),{headers:{"Content-Type":"image/png"}});}return realFetch(input,init);});
 });
 beforeEach(()=>{requests=[];turn=0;mode="final";sourceBytes=fetched;});
 afterAll(async()=>{vi.unstubAllGlobals();server?.closeAllConnections();if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));await storage?.dispose();await f?.cleanup();});
 async function upload(bytes:Uint8Array=image){const receipt=await api.createMediaUpload({mediaType:"image/png",byteSize:bytes.length,sha256:sha(bytes),idempotencyKey:crypto.randomUUID()});return api.uploadMedia(receipt.artifactId,new Request(f.env.APP_ORIGIN,{method:"PUT",headers:{"Content-Type":"image/png"},body:bytes as Uint8Array<ArrayBuffer>}));}
 async function launch(ids:string[]=[]){const receipt=await api.startRun(startRunInput.parse({prompt:ids.length?undefined:"See the images",attachments:ids.map(artifactId=>({artifactId}))}));await f.db.pool.query("UPDATE app.runs SET state='running',execution_handle=$3 WHERE tenant_id=$1 AND id=$2",[f.tenantId,receipt.runId,{backendKind:"hosted-pi",id:receipt.runId}]);await f.db.pool.query("UPDATE app.trigger_runs SET state='running' WHERE tenant_id=$1 AND id=$2",[f.tenantId,receipt.runId]);return (await new RunRepository(f.db).find(f.tenantId,receipt.runId))!;}
 it("pipes actual launch and tool-fetched image bytes through real Pi, scoped MCP and local R2 across fresh harnesses",async()=>{
  mode="tools";const uploaded=await upload(),run=await launch([uploaded.artifactId]);const harness=()=>new HostedPi(f.db,f.env,(run,lease)=>createPiMcpTools(f.env,run,lease));await harness().initialize(run);
  for(let i=0;i<3;i++)await harness().advance(run);
  expect(requests).toHaveLength(3);const images=requests.flatMap(body=>body.messages.flatMap((message:any)=>Array.isArray(message.content)?message.content.filter((part:any)=>part.type==="image_url").map((part:any)=>Buffer.from(part.image_url.url.split(",")[1],"base64")):[]));
  expect(images.some(bytes=>bytes.equals(image))).toBe(true);expect(images.some(bytes=>bytes.equals(fetched))).toBe(true);
  const session=await new PiSessionRepository(f.db,f.env.CREDENTIAL_ENCRYPTION_KEY).read(f.tenantId,run.id);expect(session!.status).toBe("complete");expect(JSON.stringify(session!.messages)).not.toContain(image.toString("base64"));expect(JSON.stringify(session!.messages)).toContain("factorize-media:");
  const records=(await f.db.pool.query("SELECT encrypted_event FROM app.pi_session_events WHERE tenant_id=$1 AND run_id=$2",[f.tenantId,run.id])).rows;
  for(const row of records)expect(await decrypt(row.encrypted_event,f.env.CREDENTIAL_ENCRYPTION_KEY)).not.toContain(fetched.toString("base64"));
  const links=(await f.db.pool.query("SELECT role FROM app.run_media_links WHERE tenant_id=$1 AND run_id=$2",[f.tenantId,run.id])).rows;expect(links.some(row=>row.role==="input")).toBe(true);expect(links.some(row=>row.role==="scratch")).toBe(true);
 });
 it("retains only media referenced by the actual Pi result for run history",async()=>{
  const run=await launch(),media=new RunMedia(f.db,f.env,{...f.auth,runId:run.id});
  const result=await media.store(image,"image/png","result:"+run.id);resultArtifact=result.data.slice("factorize-media:".length);mode="result";
  const pi=new HostedPi(f.db,f.env);await pi.initialize(run);await pi.advance(run);
  expect((await new PiSessionRepository(f.db,f.env.CREDENTIAL_ENCRYPTION_KEY).read(f.tenantId,run.id))!.status).toBe("complete");
  expect((await f.db.pool.query("SELECT role FROM app.run_media_links WHERE tenant_id=$1 AND run_id=$2 AND media_id=$3",[f.tenantId,run.id,resultArtifact])).rows[0].role).toBe("result");
 });
 it("fails an inaccessible result reference explicitly without retaining foreign blobs",async()=>{
  const run=await launch();resultArtifact=crypto.randomUUID();mode="result";
  const pi=new HostedPi(f.db,f.env);await pi.initialize(run);await pi.advance(run);
  expect(await new RunRepository(f.db).find(f.tenantId,run.id)).toMatchObject({state:"failed",failureCode:"result_media_unavailable"});
 });
 it("expires private proxy buffers immediately after capturing a chunked image response",async()=>{
  sourceBytes=Buffer.concat([image,Buffer.alloc(65536,7)]);mode="tools";const run=await launch(),pi=new HostedPi(f.db,f.env,(run,lease)=>createPiMcpTools(f.env,run,lease));await pi.initialize(run);await pi.advance(run);
  const buffers=(await f.db.pool.query("SELECT expires_at<=now() expired FROM app.agent_proxy_responses p JOIN app.agent_identities i ON i.tenant_id=p.tenant_id AND i.id=p.identity_id WHERE p.tenant_id=$1 AND i.subject=$2",[f.tenantId,run.id])).rows;
  expect(buffers.length).toBeGreaterThan(0);expect(buffers.every(row=>row.expired)).toBe(true);
 });
 it("keeps immutable upload receipts idempotent, streams raw download bytes and rejects changed metadata",async()=>{
  const input={mediaType:"image/png",byteSize:image.length,sha256:sha(image),idempotencyKey:crypto.randomUUID()};const first=await api.createMediaUpload(input),retry=await api.createMediaUpload(input);expect(retry.artifactId).toBe(first.artifactId);
  await api.uploadMedia(first.artifactId,new Request(f.env.APP_ORIGIN,{method:"PUT",headers:{"Content-Type":"image/png"},body:image}));expect(Buffer.from(await (await api.downloadMedia(first.artifactId)).arrayBuffer())).toEqual(image);
  await expect(api.createMediaUpload({...input,sha256:"a".repeat(64)})).rejects.toMatchObject({status:409});
 });
 it("rejects cross-Team and cross-run references before admission and accepts only the pinned framework content types",async()=>{
  const receipt=await upload(),other=new RunMedia(f.db,f.env,{tenantId:f.otherTenant,userId:f.userId});await expect(other.read(receipt.artifactId)).rejects.toMatchObject({status:404});
  const run=await launch(),restricted=new RunMedia(f.db,f.env,{tenantId:f.tenantId,userId:f.userId,runId:run.id});await expect(restricted.read(receipt.artifactId)).rejects.toMatchObject({status:403});
  for(const mime of ["audio/wav","video/mp4","application/octet-stream"])expect(mediaUploadInput.safeParse({mediaType:mime,byteSize:1,sha256:"a".repeat(64),idempotencyKey:"unsupported"}).success).toBe(false);
  const pending=await api.createMediaUpload({mediaType:"image/png",byteSize:1,sha256:"a".repeat(64),idempotencyKey:crypto.randomUUID()});await expect(api.startRun(startRunInput.parse({attachments:[{artifactId:pending.artifactId}]}))).rejects.toMatchObject({status:409,code:"media_not_ready"});
 });
 it("documents and enforces the same public REST upload/download boundary used by clients",async()=>{
  const cookie="factorize_session="+await signSession({...f.auth,email:"owner@example.test",exp:Math.floor(Date.now()/1000)+3600},f.env.SESSION_SIGNING_SECRET);
  const request=(path:string,init:RequestInit={})=>worker.fetch(new Request(f.env.APP_ORIGIN+path,{...init,headers:{Cookie:cookie,Origin:f.env.APP_ORIGIN,...init.headers}}),f.env,{waitUntil(){}} as any);
  const denied=await worker.fetch(new Request(f.env.APP_ORIGIN+"/api/v1/media/uploads",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}),f.env,{waitUntil(){}} as any);expect(denied.status).toBe(401);
  const reserved=await request("/api/v1/media/uploads",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mediaType:"image/png",byteSize:image.length,sha256:sha(image),idempotencyKey:crypto.randomUUID()})});expect(reserved.status).toBe(201);const receipt=await reserved.json() as any;
  expect((await request("/api/v1/media/"+receipt.artifactId,{method:"PUT",headers:{"Content-Type":"image/png"},body:image})).status).toBe(200);
  const read=await request("/api/v1/media/"+receipt.artifactId);expect(read.status).toBe(200);expect(read.headers.get("Content-Type")).toBe("image/png");expect(Buffer.from(await read.arrayBuffer())).toEqual(image);
  expect((await request("/api/v1/media/not-a-uuid")).status).toBe(400);
  await expect(new RunMedia(f.db,f.env,{tenantId:f.tenantId,userId:f.userId}).externalize({type:"image",data:"not base64!",mimeType:"image/png"})).rejects.toMatchObject({status:400});
 });
 it("streams multi-chunk uploads and leaves canceled transfers safely retryable",async()=>{
  const bytes=Buffer.alloc(2*1024*1024,137),receipt=await api.createMediaUpload({mediaType:"image/png",byteSize:bytes.length,sha256:sha(bytes),idempotencyKey:crypto.randomUUID()});
  let offset=0,chunks=0;const stream=new ReadableStream<Uint8Array>({pull(controller){const next=bytes.subarray(offset,offset+65536);offset+=next.length;chunks++;controller.enqueue(next);if(offset===bytes.length)controller.close();}});
  await api.uploadMedia(receipt.artifactId,new Request(f.env.APP_ORIGIN,{method:"PUT",headers:{"Content-Type":"image/png"},body:stream,duplex:"half"} as RequestInit));
  expect(chunks).toBe(32);expect(sha(new Uint8Array(await (await api.downloadMedia(receipt.artifactId)).arrayBuffer()))).toBe(sha(bytes));
  const canceled=await api.createMediaUpload({mediaType:"image/png",byteSize:image.length,sha256:sha(image),idempotencyKey:crypto.randomUUID()}),abort=new AbortController();abort.abort();
  await expect(api.uploadMedia(canceled.artifactId,new Request(f.env.APP_ORIGIN,{method:"PUT",headers:{"Content-Type":"image/png"},body:image,signal:abort.signal}))).rejects.toMatchObject({status:502});
  expect((await api.uploadMedia(canceled.artifactId,new Request(f.env.APP_ORIGIN,{method:"PUT",headers:{"Content-Type":"image/png"},body:image}))).state).toBe("ready");
 });
 it("keeps interrupted and mismatched streams retryable without exposing incomplete bytes",async()=>{
  const receipt=await api.createMediaUpload({mediaType:"image/png",byteSize:image.length,sha256:sha(image),idempotencyKey:crypto.randomUUID()});
  await expect(api.uploadMedia(receipt.artifactId,new Request(f.env.APP_ORIGIN,{method:"PUT",headers:{"Content-Type":"image/png"},body:image.subarray(0,5)}))).rejects.toMatchObject({status:400});
  await expect(api.downloadMedia(receipt.artifactId)).rejects.toMatchObject({status:409});
  await expect(api.uploadMedia(receipt.artifactId,new Request(f.env.APP_ORIGIN,{method:"PUT",headers:{"Content-Type":"image/png"},body:Buffer.alloc(image.length)}))).rejects.toMatchObject({status:400});
  expect((await api.uploadMedia(receipt.artifactId,new Request(f.env.APP_ORIGIN,{method:"PUT",headers:{"Content-Type":"image/png"},body:image}))).state).toBe("ready");
 });
});
