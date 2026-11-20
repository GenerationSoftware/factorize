import {createHash} from "node:crypto";
import {Buffer} from "node:buffer";
import type {Database,DatabaseClient} from "./postgres/database";
import type {Env} from "./types";
import {AgentApiError} from "./agent-api-error";
import {mediaUploadInput,mediaType,MEDIA_LIMIT,MEDIA_DATA_PREFIX} from "./media-contracts";
import type {z} from "zod";
type MediaIdentity={tenantId:string;userId:string;runId?:string};
export type MediaRow={tenant_id:string;id:string;owner_user_id:string;owner_run_id:string|null;media_type:string;byte_size:string|number;sha256:string;state:string;object_key:string|null;lease_id:string|null;first_linked_at?:Date|null};
const fail=(status:number,code:string,message:string)=>new AgentApiError(status,code,message);
export class RunMedia {
 constructor(private db:Database,private env:Env,private identity:MediaIdentity){}
 private bucket(){if(!this.env.RUN_ARTIFACTS)throw fail(503,"media_unavailable","Run artifact storage is unavailable.");return this.env.RUN_ARTIFACTS;}
 receipt(row:MediaRow){return {artifactId:row.id,mediaType:row.media_type,byteSize:Number(row.byte_size),sha256:row.sha256,state:row.state,uploadUrl:`${this.env.APP_ORIGIN}/api/v1/media/${row.id}`,readUrl:`${this.env.APP_ORIGIN}/api/v1/media/${row.id}`};}
 async create(value:z.infer<typeof mediaUploadInput>){
  const input=mediaUploadInput.parse(value);this.bucket();
  const row=(await this.db.pool.query(`INSERT INTO app.run_media(tenant_id,id,owner_user_id,owner_run_id,idempotency_key,media_type,byte_size,sha256)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(tenant_id,owner_user_id,idempotency_key) DO UPDATE SET id=app.run_media.id RETURNING *`,[this.identity.tenantId,crypto.randomUUID(),this.identity.userId,this.identity.runId??null,input.idempotencyKey,input.mediaType,input.byteSize,input.sha256])).rows[0] as MediaRow;
  if(row.media_type!==input.mediaType || Number(row.byte_size)!==input.byteSize || row.sha256!==input.sha256 || row.owner_run_id!==(this.identity.runId??null))throw fail(409,"idempotency_conflict","This upload key identifies different media or a different run.");
  return this.receipt(row);
 }
 async authorized(id:string,client:DatabaseClient=this.db.pool):Promise<MediaRow>{
  const row=(await client.query("SELECT * FROM app.run_media WHERE tenant_id=$1 AND id=$2",[this.identity.tenantId,id])).rows[0] as MediaRow|undefined;
  if(!row)throw fail(404,"not_found","Media artifact not found.");
  if(this.identity.runId){
   const own=row.owner_run_id===this.identity.runId || Boolean((await client.query("SELECT 1 FROM app.run_media_links WHERE tenant_id=$1 AND run_id=$2 AND media_id=$3",[this.identity.tenantId,this.identity.runId,id])).rowCount);
   const active=await client.query("SELECT 1 FROM app.runs WHERE tenant_id=$1 AND id=$2 AND state IN ('starting','running','blocked')",[this.identity.tenantId,this.identity.runId]);
   if(!own || !active.rowCount)throw fail(403,"forbidden","Media is outside this active run's inputs and scratch space.");
  }else if(row.owner_user_id!==this.identity.userId)throw fail(403,"forbidden","This identity cannot read another user's upload.");
  if(row.first_linked_at && !(await client.query("SELECT 1 FROM app.run_media_links WHERE tenant_id=$1 AND media_id=$2 LIMIT 1",[this.identity.tenantId,id])).rowCount)throw fail(404,"not_found","Media retention has expired.");
  return row;
 }
 async upload(id:string,request:Request){
  let row=await this.authorized(id);const bucket=this.bucket();
  if(request.headers.get("Content-Type")?.split(";",1)[0].trim().toLowerCase()!==row.media_type)throw fail(415,"unsupported_media_type","Upload Content-Type must match the media receipt.");
  if(row.state==="ready"){await request.body?.cancel();return this.receipt(row);}
  if(!request.body)throw fail(400,"invalid_request","Media bytes are required.");
  const lease=crypto.randomUUID(),objectKey=`tenants/${row.tenant_id}/media/${id}/${lease}`;
  row=await this.db.transaction(async client=>{
   const claimed=(await client.query("UPDATE app.run_media SET state='uploading',lease_id=$3,lease_expires_at=now()+interval '5 minutes',updated_at=now() WHERE tenant_id=$1 AND id=$2 AND state IN ('pending','uploading') AND (lease_id IS NULL OR lease_expires_at<now()) RETURNING *",[row.tenant_id,id,lease])).rows[0];
   if(!claimed)throw fail(409,"upload_in_progress","This upload is active or no longer writable.");
   await client.query("INSERT INTO app.media_upload_attempts(tenant_id,media_id,id,object_key,expires_at) VALUES($1,$2,$3,$4,now()+interval '15 minutes')",[row.tenant_id,id,lease,objectKey]);return claimed;
  });
  try{
   const hash=createHash("sha256");let size=0,actualSha="";const signal=AbortSignal.any([request.signal,AbortSignal.timeout(120000)]);
   let stream=request.body.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({transform(chunk,controller){size+=chunk.byteLength;if(size>Number(row.byte_size)||size>MEDIA_LIMIT)throw fail(400,"invalid_media","Upload exceeds its declared size.");hash.update(chunk);controller.enqueue(chunk);},flush(){if(size!==Number(row.byte_size))throw fail(400,"invalid_media","Upload is incomplete.");actualSha=hash.digest("hex");if(actualSha!==row.sha256)throw fail(400,"invalid_media","Upload checksum does not match its receipt.");}}),{signal});
   const Fixed=(globalThis as any).FixedLengthStream;let transfer:Promise<void>|undefined;
   if(Fixed){const fixed=new Fixed(Number(row.byte_size));transfer=stream.pipeTo(fixed.writable,{signal});stream=fixed.readable;}
   await Promise.all([bucket.put(objectKey,stream,{httpMetadata:{contentType:row.media_type},sha256:row.sha256}),transfer]);
   if(actualSha!==row.sha256)throw fail(400,"invalid_media","Upload checksum does not match its receipt.");
   await this.db.transaction(async client=>{
    await this.authorized(id,client);
    const ready=await client.query("UPDATE app.run_media SET state='ready',object_key=$4,lease_id=NULL,lease_expires_at=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND lease_id=$3 AND lease_expires_at>now()",[row.tenant_id,id,lease,objectKey]);
    if(!ready.rowCount)throw fail(409,"upload_lease_lost","Upload ownership expired before it could commit.");
    await client.query("UPDATE app.media_upload_attempts SET state='adopted',updated_at=now() WHERE tenant_id=$1 AND media_id=$2 AND id=$3",[row.tenant_id,id,lease]);
    if(this.identity.runId)await client.query("INSERT INTO app.run_media_links(tenant_id,run_id,media_id,role) VALUES($1,$2,$3,'scratch') ON CONFLICT DO NOTHING",[row.tenant_id,this.identity.runId,id]);
   });
   return this.receipt({...row,state:"ready",object_key:objectKey});
  }catch(error){
   await this.db.transaction(async client=>{await client.query("UPDATE app.run_media SET state='pending',lease_id=NULL,lease_expires_at=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND lease_id=$3",[row.tenant_id,id,lease]);await client.query("UPDATE app.media_upload_attempts SET state='cleanup',updated_at=now() WHERE tenant_id=$1 AND media_id=$2 AND id=$3 AND state='writing'",[row.tenant_id,id,lease]);});
   if(error instanceof AgentApiError)throw error;throw fail(502,"media_upload_failed","Artifact storage did not confirm the media upload; retry with the same receipt.");
  }
 }
 async read(id:string){
  const row=await this.authorized(id);if(row.state!=="ready" || !row.object_key)throw fail(409,"media_not_ready","Media artifact is not ready.");
  const object=await this.bucket().get(row.object_key);if(!object)throw fail(404,"not_found","Media bytes are unavailable.");
  return {row,object};
 }
 async image(id:string){const {row,object}=await this.read(id),bytes=new Uint8Array(await object.arrayBuffer());if(bytes.length!==Number(row.byte_size)||createHash("sha256").update(bytes).digest("hex")!==row.sha256)throw fail(502,"invalid_media","Stored media failed integrity verification.");return {type:"image" as const,mimeType:row.media_type,data:Buffer.from(bytes).toString("base64")};}
 async attach(client:DatabaseClient,runId:string,ids:string[]){
  let total=0;
  for(const id of [...new Set(ids)].sort()){const row=await this.authorized(id,client);total+=Number(row.byte_size);if(total>16*1024*1024)throw fail(413,"media_context_too_large","Launch media exceeds the 16 MiB per-turn byte budget.");const locked=(await client.query("SELECT state FROM app.run_media WHERE tenant_id=$1 AND id=$2 FOR UPDATE",[this.identity.tenantId,id])).rows[0];if(locked?.state!=="ready")throw fail(409,"media_not_ready","All launch attachments must finish uploading before admission.");await client.query("INSERT INTO app.run_media_links(tenant_id,run_id,media_id,role) VALUES($1,$2,$3,'input') ON CONFLICT(tenant_id,run_id,media_id) DO UPDATE SET role='input'",[this.identity.tenantId,runId,row.id]);}
 }
 async retainResults(runId:string,value:unknown){
  const ids=new Set<string>();const visit=(item:any)=>{if(!item||typeof item!=="object")return;if(typeof item.artifactId==="string"&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(item.artifactId))ids.add(item.artifactId);Object.values(item).forEach(visit);};visit(value);
  if(!ids.size)return;
  await this.db.transaction(async client=>{
   for(const id of [...ids].sort()){await this.authorized(id,client);const row=(await client.query("SELECT state FROM app.run_media WHERE tenant_id=$1 AND id=$2 FOR UPDATE",[this.identity.tenantId,id])).rows[0];if(row?.state!=="ready")throw fail(409,"media_not_ready","A result references media that is not retained.");
    await client.query("INSERT INTO app.run_media_links(tenant_id,run_id,media_id,role) VALUES($1,$2,$3,'result') ON CONFLICT(tenant_id,run_id,media_id) DO UPDATE SET role=CASE WHEN app.run_media_links.role='input' THEN 'input' ELSE 'result' END",[this.identity.tenantId,runId,id]);
   }
  });
 }
 async store(bytes:Uint8Array,mimeType:string,key:string){
  const sha256=createHash("sha256").update(bytes).digest("hex");const receipt=await this.create({mediaType:mediaType.parse(mimeType),byteSize:bytes.byteLength,sha256,idempotencyKey:key});
  if(receipt.state!=="ready")await this.upload(receipt.artifactId,new Request(this.env.APP_ORIGIN,{method:"PUT",headers:{"Content-Type":mimeType},body:bytes as Uint8Array<ArrayBuffer>}));
  return {type:"image" as const,mimeType,data:MEDIA_DATA_PREFIX+receipt.artifactId};
 }
 async externalize<T>(value:T):Promise<T>{
  if(!value || typeof value!=="object")return value;
  if(Array.isArray(value)){const result=[];for(const item of value)result.push(await this.externalize(item));return result as T;}
  const block=value as any;
  if(block.type==="image" && typeof block.data==="string" && typeof block.mimeType==="string"){
   if(block.data.startsWith(MEDIA_DATA_PREFIX))return value;
   if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(block.data))throw fail(400,"invalid_media","Image content is not valid base64.");
   const bytes=new Uint8Array(Buffer.from(block.data,"base64"));const sha=createHash("sha256").update(bytes).digest("hex");
   return {...block,...await this.store(bytes,block.mimeType,`pi:${this.identity.runId}:${sha}:${block.mimeType}`)};
  }
  const result:Record<string,unknown>={};for(const [key,item] of Object.entries(value))result[key]=await this.externalize(item);return result as T;
 }
 async hydrate<T>(value:T,budget={bytes:0}):Promise<T>{
  if(!value || typeof value!=="object")return value;if(Array.isArray(value)){const result=[];for(const item of value)result.push(await this.hydrate(item,budget));return result as T;}
  const block=value as any;
  if(block.type==="image" && typeof block.data==="string" && block.data.startsWith(MEDIA_DATA_PREFIX)){
   const id=block.data.slice(MEDIA_DATA_PREFIX.length),row=await this.authorized(id);budget.bytes+=Number(row.byte_size);
   if(budget.bytes>16*1024*1024)throw fail(413,"media_context_too_large","Pi media content exceeds the 16 MiB per-turn byte budget.");
   return {...block,...await this.image(id)};
  }
  const result:Record<string,unknown>={};for(const [key,item] of Object.entries(value))result[key]=key==="details"?item:await this.hydrate(item,budget);return result as T;
 }
}
export async function mediaForRun(db:Database,env:Env,tenantId:string,runId:string){
 const owner=(await db.pool.query("SELECT user_id FROM app.run_authorizations WHERE tenant_id=$1 AND run_id=$2",[tenantId,runId])).rows[0];
 if(!owner)throw fail(403,"forbidden","Run input ownership is unavailable.");return new RunMedia(db,env,{tenantId,userId:owner.user_id,runId});
}

export function containsMedia(value:unknown):boolean {
 if(!value || typeof value!=="object")return false;if(Array.isArray(value))return value.some(containsMedia);
 const block=value as any;return block.type==="image" && typeof block.data==="string" || Object.values(value).some(containsMedia);
}

export function containsMediaResult(value:unknown):boolean {if(!value||typeof value!=="object")return false;return typeof (value as any).artifactId==="string" || Object.values(value).some(containsMediaResult);}
