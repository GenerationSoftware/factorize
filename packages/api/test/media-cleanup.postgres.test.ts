import {beforeAll,afterAll,describe,it,expect,vi} from "vitest";
import {Miniflare,convertV4MiniflareOptions} from "miniflare";
import {createHash} from "node:crypto";
import {loadingFixture} from "./helpers/loading-fixture";
import {ApiService} from "../src/flow-service";
import {RunMedia} from "../src/run-media";
import {MediaCleanup} from "../src/postgres/media-cleanup";
import {CredentialRepository} from "../src/postgres/credential-repository";
import {startRunInput} from "../src/flow-schemas";
import {RunRepository} from "../src/postgres/run-repository";
vi.mock("cloudflare:workers",()=>({WorkerEntrypoint:class{},WorkflowEntrypoint:class{},DurableObject:class{}}));
vi.mock("@cloudflare/workers-oauth-provider",()=>({OAuthProvider:class{},AuthorizationError:class extends Error{},getOAuthApi:vi.fn()}));
const bytes=new Uint8Array([137,80,78,71,0,1,2,255]),sha=createHash("sha256").update(bytes).digest("hex");
describe.skipIf(!process.env.AUTH_TEST_DATABASE_URL)("run media lifecycle and R2 cleanup",()=>{
 let f:Awaited<ReturnType<typeof loadingFixture>>,api:ApiService,media:RunMedia,storage:Miniflare,bucket:R2Bucket;
 beforeAll(async()=>{
  f=await loadingFixture(process.env.AUTH_TEST_DATABASE_URL!);f.auth.scopes.push("runs:start");api=new ApiService(f.env,f.auth);media=new RunMedia(f.db,f.env,f.auth);
  storage=new Miniflare(convertV4MiniflareOptions({name:"cleanup",modules:true,script:"export default {fetch(){return new Response('ok')}}",compatibilityDate:"2026-09-10",r2Buckets:["RUN_ARTIFACTS"]}));
  const actual=await storage.getR2Bucket("RUN_ARTIFACTS");bucket=new Proxy(actual,{get(target,property){if(property==="put")return async(key:string,body:any,options:any)=>target.put(key,body instanceof ReadableStream?await new Response(body).arrayBuffer():body,options);const value=(target as any)[property];return typeof value==="function"?value.bind(target):value;}}) as any;f.env.RUN_ARTIFACTS=bucket;
  const id=crypto.randomUUID();await new CredentialRepository(f.db,f.tenantId,f.env.CREDENTIAL_ENCRYPTION_KEY).write({id,kind:"model",name:"Unused local provider",origin:null,description:null,expectedRevision:0,idempotencyKey:crypto.randomUUID(),operation:"upsert",managedModelPayload:JSON.stringify({providerUrl:"http://127.0.0.1:1/v1"})});await api.setTeamRunDefaults({modelAccountId:id,model:"fixture",requiresVm:false,capacity:50});
 });
 afterAll(async()=>{await storage?.dispose();await f?.cleanup();});
 async function upload(){const receipt=await media.create({mediaType:"image/png",byteSize:bytes.length,sha256:sha,idempotencyKey:crypto.randomUUID()});await media.upload(receipt.artifactId,new Request(f.env.APP_ORIGIN,{method:"PUT",headers:{"Content-Type":"image/png"},body:bytes}));return receipt.artifactId;}
 async function key(id:string){return (await f.db.pool.query("SELECT object_key FROM app.run_media WHERE tenant_id=$1 AND id=$2",[f.tenantId,id])).rows[0].object_key as string;}
 async function run(input?:string){const receipt=await api.startRun(startRunInput.parse({prompt:"Lifecycle",attachments:input?[{artifactId:input}]:undefined}));await f.db.pool.query("UPDATE app.runs SET state='running' WHERE tenant_id=$1 AND id=$2",[f.tenantId,receipt.runId]);await f.db.pool.query("UPDATE app.trigger_runs SET state='running' WHERE tenant_id=$1 AND id=$2",[f.tenantId,receipt.runId]);return (await new RunRepository(f.db).find(f.tenantId,receipt.runId))!;}
 async function scratch(runId:string){const store=new RunMedia(f.db,f.env,{...f.auth,runId});const block=await store.store(bytes,"image/png","scratch:"+crypto.randomUUID());return {id:block.data.slice("factorize-media:".length),store};}
 const future=(hours:number)=>new Date(Date.now()+hours*3600000);
 it("expires abandoned uploads while retaining inputs, active-run dependencies and result references",async()=>{
  const abandoned=await upload(),input=await upload(),active=await run(input),temporary=await scratch(active.id),retained=await scratch(active.id);
  const result={status:"succeeded" as const,summary:"Retained result",outputs:{image:{artifactId:retained.id}}};await retained.store.retainResults(active.id,result);await new RunRepository(f.db).recordTriggerResult(active,result);
  await new MediaCleanup(f.db,bucket).sweep(future(25));expect(await bucket.head(await key(abandoned))).toBeNull();
  expect(await bucket.head(await key(input))).not.toBeNull();expect(await bucket.head(await key(temporary.id))).not.toBeNull();expect(await bucket.head(await key(retained.id))).not.toBeNull();
  await new RunRepository(f.db).terminal(active,"succeeded","stored",undefined,true);
  await new MediaCleanup(f.db,bucket).sweep(new Date(Date.now()+30*60000));expect(await bucket.head(await key(temporary.id))).not.toBeNull();
  await new MediaCleanup(f.db,bucket).sweep(future(2));expect(await bucket.head(await key(temporary.id))).toBeNull();expect(await bucket.head(await key(input))).not.toBeNull();expect(await bucket.head(await key(retained.id))).not.toBeNull();
  expect((await f.db.pool.query("SELECT trigger_result FROM app.runs WHERE tenant_id=$1 AND id=$2",[f.tenantId,active.id])).rows[0].trigger_result).toEqual(result);
  // Aggregate deletion removes reachability; receipts still own R2 cleanup.
  await f.db.pool.query("DELETE FROM app.runs WHERE tenant_id=$1 AND id=$2",[f.tenantId,active.id]);await new MediaCleanup(f.db,bucket).sweep(future(3));expect(await bucket.head(await key(input))).toBeNull();expect(await bucket.head(await key(retained.id))).toBeNull();
 });
 it("retries a lost deletion acknowledgement and never reopens the artifact",async()=>{
  const target=await upload(),objectKey=await key(target);let failed=false;
  const faulty=new Proxy(bucket,{get(bucket,property){if(property==="delete")return async(key:string)=>{await bucket.delete(key);if(key===objectKey&&!failed){failed=true;throw new Error("Lost deletion acknowledgement");}};const value=(bucket as any)[property];return typeof value==="function"?value.bind(bucket):value;}});
  await new MediaCleanup(f.db,faulty).sweep(future(25));expect((await f.db.pool.query("SELECT state,cleanup_error FROM app.run_media WHERE tenant_id=$1 AND id=$2",[f.tenantId,target])).rows[0]).toMatchObject({state:"deleting",cleanup_error:expect.any(String)});
  await expect(media.read(target)).rejects.toMatchObject({status:409});await new MediaCleanup(f.db,bucket).sweep(new Date(future(25).getTime()+120000));expect((await f.db.pool.query("SELECT state FROM app.run_media WHERE tenant_id=$1 AND id=$2",[f.tenantId,target])).rows[0].state).toBe("deleted");
 });
 it("cleans unadopted writes and repeats deletion if a late object appears after the first confirmation",async()=>{
  const id=crypto.randomUUID(),attempt=crypto.randomUUID(),objectKey=`unadopted/${id}/${attempt}`;
  await f.db.pool.query("INSERT INTO app.media_upload_attempts(tenant_id,media_id,id,object_key,expires_at) VALUES($1,$2,$3,$4,now()-interval '1 minute')",[f.tenantId,id,attempt,objectKey]);await bucket.put(objectKey,bytes);
  await new MediaCleanup(f.db,bucket).sweep();expect(await bucket.head(objectKey)).toBeNull();
  await bucket.put(objectKey,bytes);await new MediaCleanup(f.db,bucket).sweep(future(2));expect(await bucket.head(objectKey)).toBeNull();
  expect((await f.db.pool.query("SELECT state FROM app.media_upload_attempts WHERE tenant_id=$1 AND media_id=$2 AND id=$3",[f.tenantId,id,attempt])).rows[0].state).toBe("deleted");
  await new MediaCleanup(f.db,bucket).sweep(future(26));expect((await f.db.pool.query("SELECT 1 FROM app.media_upload_attempts WHERE tenant_id=$1 AND media_id=$2 AND id=$3",[f.tenantId,id,attempt])).rowCount).toBe(0);
 });
 it("respects active upload leases and allows only one concurrent cleanup owner",async()=>{
  const id=crypto.randomUUID(),attempt=crypto.randomUUID(),objectKey=`active-upload/${id}/${attempt}`;
  await f.db.pool.query("INSERT INTO app.run_media(tenant_id,id,owner_user_id,idempotency_key,media_type,byte_size,sha256,state,lease_id,lease_expires_at,created_at,updated_at) VALUES($1,$2,$3,($2::uuid)::text,'image/png',8,$4,'uploading',$5,now()+interval '2 days',now()-interval '3 days',now()-interval '3 days')",[f.tenantId,id,f.userId,sha,attempt]);await f.db.pool.query("INSERT INTO app.media_upload_attempts(tenant_id,media_id,id,object_key,expires_at) VALUES($1,$2,$3,$4,now()-interval '1 hour')",[f.tenantId,id,attempt,objectKey]);await bucket.put(objectKey,bytes);
  await Promise.all([new MediaCleanup(f.db,bucket).sweep(),new MediaCleanup(f.db,bucket).sweep()]);expect(await bucket.head(objectKey)).not.toBeNull();
  await f.db.pool.query("UPDATE app.run_media SET lease_expires_at=now()-interval '1 second' WHERE tenant_id=$1 AND id=$2",[f.tenantId,id]);await Promise.all([new MediaCleanup(f.db,bucket).sweep(),new MediaCleanup(f.db,bucket).sweep()]);expect(await bucket.head(objectKey)).toBeNull();
 });
});
