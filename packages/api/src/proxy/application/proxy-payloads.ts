import {Buffer} from "node:buffer";
import {createHash} from "node:crypto";
import {z} from "zod";
import {databaseFor} from "../../postgres/database";
import {IdentityRepository} from "../../postgres/identity-repository";
import {AgentApiService} from "./agent-api";
import {AgentApiError} from "../api/agent-api-error";
import {isPublicHttpsOrigin} from "../transport/public-address";
import type {Env,OAuthProps} from "../../types";
import {createPayloadInput,payloadRef,appendPayloadInput,finalizePayloadInput,attachmentInput,payloadReceipt,requestBodySource,multipartPart} from "../api/proxy-payload-contracts";
export {createPayloadInput,payloadRef,appendPayloadInput,finalizePayloadInput,attachmentInput,payloadReceipt,requestBodySource,multipartPart} from "../api/proxy-payload-contracts";
type Row={tenant_id:string;id:string;identity_id:string;owner_user_id:string;name:string;media_type:string;size:number;declared_size:number|null;state:"pending"|"uploading"|"finalizing"|"ready";sha256:string|null;expires_at:Date;lease_id:string|null};
const fail=(status:number,code:string,message:string)=>new AgentApiError(status,code,message);
export class ProxyPayloads {
 private db;
 constructor(private env:Env,private auth:OAuthProps){this.db=databaseFor(env);}
 private api(){return new AgentApiService(this.env,this.auth);}
 private async identity(){const identity=await this.api().identity();if(identity.kind==="oauth"&&(!this.auth.scopes.includes("proxy:use")||identity.policy.disabled_scopes.includes("proxy:use")))throw fail(403,"insufficient_scope","The proxy:use scope is required for request payloads.");return identity;}
 private bucket(){if(!this.env.PROXY_ARTIFACTS)throw fail(503,"payload_unavailable","Artifact storage is unavailable.");return this.env.PROXY_ARTIFACTS;}
 private receipt(row:Row){return {handle:row.id,name:row.name,mediaType:row.media_type,size:row.size,state:row.state,sha256:row.sha256,expiresAt:row.expires_at.toISOString(),uploadUrl:`${this.env.APP_ORIGIN}/api/v1/proxy-payloads/${row.id}/bytes`,browserUploadUrl:`${this.env.APP_ORIGIN}/uploads/proxy/${row.id}`};}
 async authorized(id:string){
  const row=(await this.db.pool.query<Row>("SELECT * FROM app.proxy_payloads WHERE tenant_id=$1 AND id=$2 AND expires_at>now()",[this.auth.tenantId,id])).rows[0];
  if(!row)throw fail(404,"not_found","Payload not found or expired.");
  if(this.auth.authMethod==="session"){
   const member=await new IdentityRepository(this.db,this.auth.tenantId).member(this.auth.userId);
   if(row.owner_user_id!==this.auth.userId||member?.role!=="owner"||member.sessionVersion!==this.auth.sessionVersion)throw fail(403,"forbidden","This upload belongs to another identity.");
   const owner=(await this.db.pool.query("SELECT revoked_at FROM app.agent_identities WHERE tenant_id=$1 AND id=$2",[row.tenant_id,row.identity_id])).rows[0];if(!owner||owner.revoked_at)throw fail(403,"forbidden","The originating connection was revoked.");
  }else if((await this.identity()).id!==row.identity_id)throw fail(403,"forbidden","Payload belongs to another connection.");
  return row;
 }
 async create(input:z.infer<typeof createPayloadInput>){
  const value=createPayloadInput.parse(input),identity=await this.identity();this.bucket();
  const row=(await this.db.pool.query<Row>("INSERT INTO app.proxy_payloads(tenant_id,id,identity_id,owner_user_id,name,media_type,declared_size) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",[this.auth.tenantId,crypto.randomUUID(),identity.id,this.auth.userId,value.name,value.mediaType,value.byteSize??null])).rows[0];
  if(this.env.SCHEDULER)await this.env.SCHEDULER.get(this.env.SCHEDULER.idFromName("global")).fetch("https://scheduler/wake",{method:"POST"});return this.receipt(row);
 }
 async get(id:string){return this.receipt(await this.authorized(id));}
 private async appendBytes(id:string,offset:number,bytes:Uint8Array,lease?:string){
  await this.authorized(id);const hash=createHash("sha256").update(bytes).digest("hex");
  await this.db.transaction(async client=>{
   const row=(await client.query<Row>("SELECT * FROM app.proxy_payloads WHERE tenant_id=$1 AND id=$2 AND expires_at>now() FOR UPDATE",[this.auth.tenantId,id])).rows[0];if(!row)throw fail(404,"not_found","Payload expired.");
   if(row.state!=="pending"&&!(row.state==="uploading"&&row.lease_id===lease))throw fail(409,"payload_immutable","Payload is finalized or currently being uploaded.");
   const previous=(await client.query("SELECT byte_size,sha256 FROM app.proxy_payload_chunks WHERE tenant_id=$1 AND payload_id=$2 AND byte_offset=$3",[row.tenant_id,id,offset])).rows[0];
   if(previous){if(previous.byte_size!==bytes.length||previous.sha256!==hash)throw fail(409,"chunk_conflict","A different chunk already occupies this offset.");return;}
   if(offset!==row.size)throw fail(409,"invalid_offset","Append at the returned payload size; chunks must be contiguous.");
   if(offset+bytes.length>32*1024*1024||row.declared_size!==null&&offset+bytes.length>row.declared_size)throw fail(413,"request_too_large","Upload exceeds its declared size or fixed 32 MiB limit.");
   if(!bytes.length)return;
   const key=`proxy-payloads/${row.tenant_id}/${id}/${offset}-${hash}`;await this.bucket().put(key,bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer);
   await client.query("INSERT INTO app.proxy_payload_chunks(tenant_id,payload_id,byte_offset,byte_size,sha256,object_key) VALUES($1,$2,$3,$4,$5,$6)",[row.tenant_id,id,offset,bytes.length,hash,key]);
   await client.query("UPDATE app.proxy_payloads SET size=size+$3,lease_expires_at=CASE WHEN lease_id IS NULL THEN NULL ELSE now()+interval '5 minutes' END WHERE tenant_id=$1 AND id=$2",[row.tenant_id,id,bytes.length]);
  });return this.get(id);
 }
 async append(input:z.infer<typeof appendPayloadInput>){
  const value=appendPayloadInput.parse(input);if(value.encoding==="base64"&&Buffer.from(value.body,"base64").toString("base64")!==value.body)throw fail(400,"invalid_request","Supply canonical base64.");
  return this.appendBytes(value.handle,value.offset,Buffer.from(value.body,value.encoding==="base64"?"base64":"utf8"));
 }
 private source(row:Row){
  let offset=0;const self=this;
  return new ReadableStream<Uint8Array>({async pull(controller){
   await self.authorized(row.id);if(offset>=row.size){controller.close();return;}
   const chunk=(await self.db.pool.query("SELECT byte_size,object_key FROM app.proxy_payload_chunks WHERE tenant_id=$1 AND payload_id=$2 AND byte_offset=$3",[row.tenant_id,row.id,offset])).rows[0];
   if(!chunk)throw fail(503,"payload_incomplete","Stored payload is incomplete.");const object=await self.bucket().get(chunk.object_key);if(!object)throw fail(503,"payload_unavailable","Stored payload bytes are unavailable.");const bytes=new Uint8Array(await object.arrayBuffer());if(bytes.length!==chunk.byte_size)throw fail(503,"payload_incomplete","Stored chunk is incomplete.");offset+=bytes.length;controller.enqueue(bytes);
  }});
 }
 async finalize(input:z.infer<typeof finalizePayloadInput>,lease?:string){
  const value=finalizePayloadInput.parse(input);let row=await this.authorized(value.handle);if(row.state==="ready"){if(value.sha256&&value.sha256!==row.sha256)throw fail(409,"checksum_mismatch","Payload checksum differs.");return this.receipt(row);}
  row=(await this.db.pool.query<Row>("UPDATE app.proxy_payloads SET state='finalizing' WHERE tenant_id=$1 AND id=$2 AND (state='pending' OR state='uploading' AND lease_id=$3) AND (declared_size IS NULL OR size=declared_size) RETURNING *",[row.tenant_id,row.id,lease??null])).rows[0];if(!row)throw fail(409,"payload_incomplete","Upload must finish before finalization.");
  try{const hash=createHash("sha256"),reader=this.source(row).getReader();for(;;){const next=await reader.read();if(next.done)break;hash.update(next.value);}const sha=hash.digest("hex");if(value.sha256&&value.sha256!==sha)throw fail(400,"checksum_mismatch","Upload checksum does not match.");await this.authorized(row.id);await this.db.pool.query("UPDATE app.proxy_payloads SET state='ready',sha256=$3,lease_id=NULL,lease_expires_at=NULL WHERE tenant_id=$1 AND id=$2 AND state='finalizing'",[row.tenant_id,row.id,sha]);return this.get(row.id);
  }catch(error){await this.db.pool.query("UPDATE app.proxy_payloads SET state='pending' WHERE tenant_id=$1 AND id=$2 AND state='finalizing'",[row.tenant_id,row.id]);throw error;}
 }
 async upload(id:string,request:Request){
  const row=await this.authorized(id);if(row.state==="ready"){await request.body?.cancel();return this.receipt(row);}const lease=crypto.randomUUID();
  const claim=await this.db.pool.query("UPDATE app.proxy_payloads SET state='uploading',lease_id=$3,lease_expires_at=now()+interval '5 minutes' WHERE tenant_id=$1 AND id=$2 AND state='pending' AND size=0 RETURNING id",[row.tenant_id,id,lease]);if(!claim.rowCount)throw fail(409,"upload_in_progress","Upload is active or partially staged; append at its current offset.");
  if(!request.body){await this.db.pool.query("UPDATE app.proxy_payloads SET state='pending' WHERE tenant_id=$1 AND id=$2",[row.tenant_id,id]);return this.finalize({handle:id},lease);}
  const reader=request.body.getReader();let offset=0;
  try{for(;;){const next=await reader.read();if(next.done)break;if(offset+next.value.length>32*1024*1024||row.declared_size!==null&&offset+next.value.length>row.declared_size)throw fail(413,"request_too_large","Upload exceeds its declared size or fixed 32 MiB limit.");for(let at=0;at<next.value.length;at+=65536){const bytes=next.value.subarray(at,at+65536);await this.appendBytes(id,offset,bytes,lease);offset+=bytes.length;}}return await this.finalize({handle:id},lease);}catch(error){void reader.cancel().catch(()=>{});await this.db.pool.query("UPDATE app.proxy_payloads SET state='pending',lease_id=NULL,lease_expires_at=NULL WHERE tenant_id=$1 AND id=$2 AND lease_id=$3",[row.tenant_id,id,lease]);throw error;}
 }
 async importAttachment(input:z.infer<typeof attachmentInput>){
  await this.identity();const {file}=attachmentInput.parse(input),url=new URL(file.download_url);
  if(!isPublicHttpsOrigin(url.origin,this.env.APP_ORIGIN)||!/(?:^|\.)(?:oaiusercontent\.com|openai\.com)$/.test(url.hostname)||url.username||url.password||url.hash)throw fail(400,"invalid_attachment","Expected a temporary ChatGPT file download URL. Use browserUploadUrl when native file handoff is unavailable.");
  let response:Response;try{response=await fetch(url,{redirect:"manual",signal:AbortSignal.timeout(120000)});}catch{throw fail(502,"attachment_unavailable","Attachment download failed; attach again or use the Factorize upload page.");}
  if(!response.ok){void response.body?.cancel();throw fail(400,"attachment_unavailable","Attachment URL expired, redirected, or could not be downloaded; attach again or use the upload page.");}
  const payload=await this.create(createPayloadInput.parse({name:file.file_name??"attachment",mediaType:file.mime_type??response.headers.get("content-type")?.split(";")[0]??"application/octet-stream"}));
  return this.upload(payload.handle,new Request(this.env.APP_ORIGIN,{method:"PUT",body:response.body,duplex:"half"} as RequestInit));
 }
 async importIntegration(input:{integration:string;path:string;name?:string;mediaType?:string}){
  const response=await this.api().request({integration:input.integration,method:"GET",path:input.path,headers:{},encoding:"utf8",maxResultBytes:2048});
  if(response.status<200||response.status>=300)throw fail(502,"upstream_status",`Integration returned HTTP ${response.status}; no upload was created.`);
  if(response.size>32*1024*1024)throw fail(413,"request_too_large","Integration file exceeds fixed 32 MiB request limit.");
  const payload=await this.create(createPayloadInput.parse({name:input.name??"integration-file",mediaType:input.mediaType??response.headers["content-type"]?.split(";")[0]??"application/octet-stream",byteSize:response.size}));
  const stream=response.handle?await (await this.body({kind:"response",handle:response.handle})).stream():new ReadableStream<Uint8Array>({start(c){c.enqueue(Buffer.from(response.body??"",response.encoding==="base64"?"base64":"utf8"));c.close();}});
  return this.upload(payload.handle,new Request(this.env.APP_ORIGIN,{method:"PUT",body:stream,duplex:"half"} as RequestInit));
 }
 async body(source:z.infer<typeof requestBodySource>):Promise<{size:number;stream:()=>Promise<ReadableStream<Uint8Array>>}>{
  if(source.kind==="payload"){const row=await this.authorized(source.handle);if(row.state!=="ready")throw fail(409,"payload_incomplete","Finalize the payload before using it.");return {size:row.size,stream:async()=>this.source(await this.authorized(source.handle))};}
  if(source.kind==="response"){
   const row=await this.api().authorizeRead({handle:source.handle,offset:0}),api=this.api();let offset=0;
   return {size:row.size,stream:async()=>new ReadableStream({async pull(c){if(offset>=row.size){c.close();return;}const chunk=await api.read({handle:source.handle,offset});offset=chunk.nextOffset;c.enqueue(Buffer.from(chunk.body,"base64"));}})};
  }
  throw fail(400,"invalid_request","Unsupported request body source.");
 }
}
export async function cleanupProxyPayloads(env:Env){
 if(!env.PROXY_ARTIFACTS)return;const db=databaseFor(env),rows=(await db.pool.query("SELECT tenant_id,id FROM app.proxy_payloads WHERE expires_at<now() LIMIT 50")).rows;
 for(const row of rows){let cursor:string|undefined;do{const page=await env.PROXY_ARTIFACTS.list({prefix:`proxy-payloads/${row.tenant_id}/${row.id}/`,cursor});if(page.objects.length)await env.PROXY_ARTIFACTS.delete(page.objects.map(object=>object.key));cursor=page.truncated?page.cursor:undefined;}while(cursor);await db.pool.query("DELETE FROM app.proxy_payloads WHERE tenant_id=$1 AND id=$2 AND expires_at<now()",[row.tenant_id,row.id]);}
 await db.pool.query("UPDATE app.proxy_payloads SET state='pending',lease_id=NULL,lease_expires_at=NULL WHERE state='uploading' AND lease_expires_at<now()");
}
export async function proxyRequestBody(env:Env,auth:OAuthProps,input:{body?:string;encoding:"utf8"|"base64";bodySource?:z.infer<typeof requestBodySource>;multipart?:z.infer<typeof multipartPart>[];headers:Record<string,string>}){
 const payloads=new ProxyPayloads(env,auth),headers={...input.headers};
 if(input.bodySource){const source=await payloads.body(input.bodySource);if(source.size>32*1024*1024)throw fail(413,"request_too_large","Source exceeds fixed 32 MiB request limit.");return {body:await source.stream(),headers};}
 if(!input.multipart)return {body:input.body===undefined?undefined:Buffer.from(input.body,input.encoding==="base64"?"base64":"utf8"),headers};
 const boundary="factorize-"+crypto.randomUUID(),pieces:{size:number;stream:()=>Promise<ReadableStream<Uint8Array>>}[]=[];
 const literal=(value:string)=>{const bytes=new TextEncoder().encode(value);return {size:bytes.length,stream:async()=>new ReadableStream<Uint8Array>({start(c){c.enqueue(bytes);c.close();}})};};
 for(const part of input.multipart){pieces.push(literal(`--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"${part.filename?`; filename="${part.filename}"`:""}\r\n${part.mediaType?`Content-Type: ${part.mediaType}\r\n`:""}\r\n`));pieces.push(part.source?await payloads.body(part.source):literal(part.text!));pieces.push(literal("\r\n"));}pieces.push(literal(`--${boundary}--\r\n`));
 if(pieces.reduce((size,part)=>size+part.size,0)>32*1024*1024)throw fail(413,"request_too_large","Multipart body exceeds fixed 32 MiB request limit including boundaries.");
 for(const key of Object.keys(headers))if(key.toLowerCase()==="content-type")delete headers[key];headers["Content-Type"]=`multipart/form-data; boundary=${boundary}`;
 let index=0,reader:ReadableStreamDefaultReader<Uint8Array>|undefined;return {headers,body:new ReadableStream<Uint8Array>({async pull(c){while(index<pieces.length){reader??=(await pieces[index].stream()).getReader();const next=await reader.read();if(!next.done){c.enqueue(next.value);return;}reader=undefined;index++;}c.close();},async cancel(){await reader?.cancel();}})};
}
