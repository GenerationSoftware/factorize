import {beforeAll,afterAll,describe,it,expect,vi} from "vitest";
import {spawnSync} from "node:child_process";
import {loadingFixture} from "./helpers/loading-fixture";
import {CredentialRepository} from "../src/postgres/credential-repository";
import {PiMcpClient} from "../src/pi-mcp-client";
import {protectedApiFetch} from "../src/protected-api";
vi.mock("cloudflare:workers",()=>({WorkerEntrypoint:class{},WorkflowEntrypoint:class{},DurableObject:class{}}));
vi.mock("@cloudflare/workers-oauth-provider",()=>({OAuthProvider:class{},AuthorizationError:class extends Error{},getOAuthApi:vi.fn()}));
it("diagnoses a missing client catalog separately from authorization",()=>{
 const run=(names:string[])=>spawnSync(process.execPath,["../../scripts/diagnose-mcp-proxy.mjs"],{input:JSON.stringify({tools:names.map(name=>({name}))}),encoding:"utf8"});
 const missing=run(["get_api_reflection"]);expect(missing.status).toBe(1);expect(JSON.parse(missing.stdout).missing).toEqual(["request_api","read_api_response"]);
 expect(run(["mcp__codex_apps__factorize_get_api_reflection","mcp__codex_apps__factorize_request_api","mcp__codex_apps__factorize_read_api_response"]).status).toBe(0);
 const complete=run(["get_api_reflection","request_api","read_api_response"]);expect(complete.status).toBe(0);expect(JSON.parse(complete.stdout).status).toBe("catalog_complete");
});
describe.skipIf(!process.env.AUTH_TEST_DATABASE_URL)("proxy discovery wire contract",()=>{
 let f:Awaited<ReturnType<typeof loadingFixture>>,id:string,credential:string;
 beforeAll(async()=>{
  f=await loadingFixture(process.env.AUTH_TEST_DATABASE_URL!);credential=crypto.randomUUID();
  await new CredentialRepository(f.db,f.tenantId,f.env.CREDENTIAL_ENCRYPTION_KEY).write({id:credential,kind:"bearer",name:"Fixture API",origin:"https://fixture.example.com",description:"Read fixture status",expectedRevision:0,idempotencyKey:crypto.randomUUID(),operation:"upsert",managedSecret:"never-expose-this-secret"});
  const row=(await f.db.pool.query("UPDATE app.agent_integrations SET policy='baseline' WHERE tenant_id=$1 AND credential_id=$2 RETURNING id",[f.tenantId,credential])).rows[0];id=row.id;
 });
 afterAll(async()=>{vi.unstubAllGlobals();await f?.cleanup();});
 const client=(scopes:string[])=>new PiMcpClient(f.env.APP_ORIGIN,request=>protectedApiFetch(request,f.env,{...f.auth,authMethod:"oauth",oauthGrantId:"fixture-client",oauthClientId:"client",oauthExpiresAt:Date.now()/1000+3600,scopes},{} as any),async()=>"fixture");
 it("always discovers tools and follows reflection without a shell or credential",async()=>{
  for(const scopes of [[],["proxy:use"]]){
   const result=await client(scopes).request("tools/list");const fileTool=result.tools.find((t:any)=>t.name==="import_attachment");expect(fileTool._meta["openai/fileParams"]).toEqual(["file"]);expect(fileTool.inputSchema.properties.file.required).toEqual(["download_url","file_id"]);expect(Object.keys(fileTool.inputSchema.properties.file.properties)).toEqual(expect.arrayContaining(["download_url","file_id","mime_type","file_name"]));expect(result.tools.map((t:any)=>t.name)).toEqual(expect.arrayContaining(["get_api_reflection","request_api","read_api_response"]));
  }
  const c=client(["proxy:use"]),reflection=(await c.request("tools/call",{name:"get_api_reflection",arguments:{}})).structuredContent;
  expect(reflection.proxy.requestTool).toBe("request_api");expect(reflection.proxy.authentication).toContain("no");
  const integration=reflection.integrations.find((v:any)=>v.id===id);expect(integration.instructions).toContain("request_api");expect(JSON.stringify(reflection)).not.toContain("never-expose-this-secret");
  const observed:any[]=[];vi.stubGlobal("fetch",async(input:any,init:any)=>{observed.push([String(input),new Headers(init.headers).get("Authorization")]);return Response.json({ok:true});});
  try{const result=await c.request("tools/call",{name:"request_api",arguments:{...integration.requestExample,execution:"sync"}});expect(result.isError).not.toBe(true);expect(JSON.parse(result.structuredContent.body)).toEqual({ok:true});expect(observed).toEqual([["https://fixture.example.com/","Bearer never-expose-this-secret"]]);}finally{vi.unstubAllGlobals();}
 });
 it("serves a legacy progress-token client without requiring notifications for ordinary calls",async()=>{
  const identity={...f.auth,authMethod:"oauth" as const,oauthGrantId:"progress",oauthClientId:"client",oauthExpiresAt:Date.now()/1000+3600,scopes:["proxy:use"]};
  const response=await protectedApiFetch(new Request(f.env.APP_ORIGIN+"/mcp",{method:"POST",headers:{Host:"factorize.test","Content-Type":"application/json",Accept:"application/json, text/event-stream","MCP-Protocol-Version":"2025-11-25"},body:JSON.stringify({jsonrpc:"2.0",id:9,method:"tools/call",params:{name:"get_api_reflection",arguments:{},_meta:{progressToken:"progress-fixture"}}})}),f.env,identity,{} as any);
  const body=await response.text();expect(response.status,body).toBe(200);expect(body).toContain("notifications/progress");expect(body).toContain("progress-fixture");expect(body).toContain("request_api");
 });
 it("separates missing scope, policy and credential failures",async()=>{
  const args={integration:id,method:"GET",path:"/",execution:"sync"};
  const call=async(scopes:string[])=>JSON.stringify(await client(scopes).request("tools/call",{name:"request_api",arguments:args}));
  expect(await call([])).toContain("insufficient_scope");
  await f.db.pool.query("UPDATE app.agent_integrations SET policy='disabled' WHERE tenant_id=$1 AND id=$2",[f.tenantId,id]);expect(await call(["proxy:use"])).toContain("forbidden");
  await f.db.pool.query("UPDATE app.agent_integrations SET policy='baseline' WHERE tenant_id=$1 AND id=$2",[f.tenantId,id]);
  await f.db.pool.query("UPDATE app.integration_records SET encrypted_payload='invalid' WHERE tenant_id=$1 AND id=$2",[f.tenantId,credential]);
  const error=await call(["proxy:use"]);expect(error).toContain("credential_unavailable");expect(error).not.toContain("never-expose-this-secret");
 });
});
