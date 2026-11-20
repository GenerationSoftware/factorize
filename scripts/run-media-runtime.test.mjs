import {test} from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {Miniflare,convertV4MiniflareOptions} from "miniflare";
test("media uses incremental hashing and fixed-length streaming into R2 in the Worker runtime",async()=>{
 const source=`import {RunMedia} from './packages/api/src/run-media.ts';import {createHash} from 'node:crypto';
 export default {async fetch(request,env){
 const bytes=new Uint8Array([137,80,78,71,0,1,2,255]),sha256=createHash('sha256').update(bytes).digest('hex');
 let row;const client={async query(sql,args){
  if(sql.startsWith('INSERT INTO app.run_media(')){row={tenant_id:args[0],id:args[1],owner_user_id:args[2],owner_run_id:null,media_type:args[5],byte_size:args[6],sha256:args[7],state:'pending',object_key:null};return {rows:[row],rowCount:1};}
  if(sql.startsWith('SELECT * FROM app.run_media'))return {rows:[row],rowCount:1};
  if(sql.startsWith("UPDATE app.run_media SET state='uploading'")){row={...row,state:'uploading',lease_id:args[2]};return {rows:[row],rowCount:1};}
  if(sql.startsWith("UPDATE app.run_media SET state='ready'")){row={...row,state:'ready',object_key:args[3]};return {rows:[row],rowCount:1};}
  return {rows:[],rowCount:1};
 }};const db={pool:client,transaction:action=>action(client)};
 const media=new RunMedia(db,{RUN_ARTIFACTS:env.RUN_ARTIFACTS,APP_ORIGIN:'https://media.test'},{tenantId:'11111111-1111-4111-8111-111111111111',userId:'22222222-2222-4222-8222-222222222222'});
 const receipt=await media.create({mediaType:'image/png',byteSize:bytes.length,sha256,idempotencyKey:'worker-media'});
 const stream=new ReadableStream({start(controller){controller.enqueue(bytes.slice(0,3));controller.enqueue(bytes.slice(3));controller.close();}});
 await media.upload(receipt.artifactId,new Request('https://media.test',{method:'PUT',headers:{'Content-Type':'image/png'},body:stream}));
 const stored=await media.read(receipt.artifactId);return Response.json({state:stored.row.state,bytes:Array.from(new Uint8Array(await stored.object.arrayBuffer())),sha256:stored.row.sha256});
 }};`;
 const result=await build({stdin:{contents:source,resolveDir:process.cwd()},bundle:true,platform:"browser",format:"esm",external:["node:*","cloudflare:workers"],write:false});
 const worker=new Miniflare(convertV4MiniflareOptions({name:"media",modules:true,script:result.outputFiles[0].text,compatibilityDate:"2026-09-10",compatibilityFlags:["nodejs_compat"],r2Buckets:["RUN_ARTIFACTS"]}));
 try{const response=await worker.dispatchFetch("https://media.test");const text=await response.text();assert.equal(response.status,200,text);const body=JSON.parse(text);assert.equal(body.state,"ready");assert.deepEqual(body.bytes,[137,80,78,71,0,1,2,255]);assert.match(body.sha256,/^[a-f0-9]{64}$/);}finally{await worker.dispose();}
});
