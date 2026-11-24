import {beforeAll,afterAll,describe,it,expect,vi} from "vitest";
import {loadingFixture} from "./helpers/loading-fixture";
import {CredentialRepository} from "../src/postgres/credential-repository";
import {ProxyOperations,processProxyOperation} from "../src/proxy-operations";
import {AgentApiService} from "../src/agent-api";
import {requestApiInput} from "../src/agent-api-contracts";
import {proxyResultSize} from "../src/proxy-result";
vi.mock("cloudflare:workers",()=>({WorkerEntrypoint:class{},WorkflowEntrypoint:class{},DurableObject:class{}}));
vi.mock("@cloudflare/workers-oauth-provider",()=>({OAuthProvider:class{},AuthorizationError:class extends Error{},getOAuthApi:vi.fn()}));
describe.skipIf(!process.env.AUTH_TEST_DATABASE_URL)("durable HTTP operation fixture",()=>{
 let f:Awaited<ReturnType<typeof loadingFixture>>,operations:ProxyOperations,integration:string,auth:any;const objects=new Map<string,Uint8Array>();const wakes:any[]=[];
 beforeAll(async()=>{
  f=await loadingFixture(process.env.AUTH_TEST_DATABASE_URL!);const id=crypto.randomUUID();
  await new CredentialRepository(f.db,f.tenantId,f.env.CREDENTIAL_ENCRYPTION_KEY).write({id,kind:"bearer",name:"Fixture",origin:"https://fixture.example.com",description:null,expectedRevision:0,idempotencyKey:crypto.randomUUID(),operation:"upsert",managedSecret:"secret"});integration=(await f.db.pool.query("UPDATE app.agent_integrations SET policy='baseline' WHERE tenant_id=$1 AND credential_id=$2 RETURNING id",[f.tenantId,id])).rows[0].id;
  f.env.PROXY_ARTIFACTS={put:async(k:string,v:ArrayBuffer)=>objects.set(k,new Uint8Array(v).slice()),get:async(k:string,o:any)=>{const v=objects.get(k);if(!v)return null;const bytes=v.slice(o.range.offset,o.range.offset+o.range.length);return {arrayBuffer:async()=>bytes.buffer};}} as any;
  f.env.SCHEDULER={idFromName:(v:string)=>v,get:()=>({fetch:async(_url:string,init:any)=>{if(init.body)wakes.push(JSON.parse(init.body));return Response.json({scheduled:true});}})} as any;
  auth={...f.auth,authMethod:"oauth",oauthGrantId:"operations",oauthClientId:"fixture",oauthExpiresAt:Date.now()/1000+3600,scopes:["proxy:use"]};operations=new ProxyOperations(f.env,auth);
 });
 afterAll(async()=>{vi.unstubAllGlobals();vi.restoreAllMocks();await f?.cleanup();});
 const start=(extra:object={})=>operations.start(requestApiInput.parse({integration,method:"GET",path:"/",...extra}));
 const execute=(id:string)=>processProxyOperation(f.env,f.tenantId,id);
 function mockUpstream(init?: ResponseInit) {
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  let started!: () => void;
  const dispatched = new Promise<void>(resolve => { started = resolve; });
  const body = new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } });
  vi.stubGlobal("fetch", async () => {
   started();
   return new Response(body, init);
  });
  return {
   stream,
   ready: (running: Promise<void>) => Promise.race([
    dispatched,
    running.then(() => { throw new Error("Operation completed before it reached the upstream"); }),
   ]),
  };
 }
 it("streams incremental SSE/chunked bytes independently of the requesting client and exposes non-2xx status", async () => {
  const upstream = mockUpstream({ status: 429, headers: { "Content-Type": "text/event-stream" } });
  let running: Promise<void> | undefined;
  try {
   const operation = await start();
   expect(operation.state).toBe("queued");
   expect(proxyResultSize(operation)).toBeLessThan(4096);
   expect(wakes.at(-1).operationId).toBe(operation.operationId);
   running = execute(operation.operationId);
   await upstream.ready(running);
   upstream.stream.enqueue(new TextEncoder().encode("data: first\n\n"));
   await vi.waitFor(async () => expect((await operations.get(operation.operationId)).size).toBe(13), { timeout: 5000 });
   // A new tool-only client with the same OAuth connection reconnects.
   const reconnect = new ProxyOperations(f.env, { ...auth });
   const chunk = await reconnect.read({ operationId: operation.operationId, offset: 0, limit: 384 });
   expect(Buffer.from(chunk.body, "base64").toString()).toBe("data: first\n\n");
   expect(chunk.done).toBe(false);
   upstream.stream.enqueue(new TextEncoder().encode("data: last\n\n"));
   upstream.stream.close();
   await running;
   const done = await reconnect.get(operation.operationId);
   expect(done).toMatchObject({ state: "complete", status: 429, size: 25, responseHandle: operation.operationId });
   const bytes = await new AgentApiService(f.env, auth).read({ handle: done.responseHandle!, offset: 0 });
   expect(Buffer.from(bytes.body, "base64").toString()).toBe("data: first\n\ndata: last\n\n");
  } finally {
   upstream.stream.error(new Error("Test finished"));
   try { await running; } finally { vi.unstubAllGlobals(); }
  }
 });
 it("idempotently accepts requests and fails closed after interrupted dispatch without replay",async()=>{
  const key=crypto.randomUUID(),first=await start({method:"POST",body:"effect",idempotencyKey:key});expect((await start({method:"POST",body:"effect",idempotencyKey:key})).operationId).toBe(first.operationId);
  await expect(start({method:"POST",body:"different",idempotencyKey:key})).rejects.toMatchObject({code:"idempotency_conflict"});
  await f.db.pool.query("UPDATE app.proxy_operations SET state='running',updated_at=now()-interval '1 minute' WHERE tenant_id=$1 AND id=$2",[f.tenantId,first.operationId]);const fetch=vi.fn();vi.stubGlobal("fetch",fetch);
  try{await execute(first.operationId);await execute(first.operationId);expect(fetch).not.toHaveBeenCalled();expect(await operations.get(first.operationId)).toMatchObject({state:"uncertain",effectsUncertain:true,error:{code:"interrupted"}});}finally{vi.unstubAllGlobals();}
 });
 it("cancels active streams and surfaces partial-data disconnects and fixed duration limits", async () => {
  for (const failure of ["disconnect", "cancel", "timeout"]) {
   const deadline = new AbortController();
   const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
   const upstream = mockUpstream();
   let running: Promise<void> | undefined;
   try {
    const operation = await start({ method: "POST", body: "write" });
    running = execute(operation.operationId);
    await upstream.ready(running);
    upstream.stream.enqueue(new TextEncoder().encode("partial"));
    await vi.waitFor(async () => expect((await operations.get(operation.operationId)).size).toBe(7), { timeout: 5000 });
    if (failure === "disconnect") upstream.stream.error(new Error("secret request disconnected"));
    else if (failure === "timeout") deadline.abort();
    else await operations.cancel(operation.operationId);
    await running;
    const state = await operations.get(operation.operationId);
    expect(state.partial).toBe(true);
    expect(state.effectsUncertain).toBe(true);
    expect(state.error?.code).toBe(failure === "cancel" ? "canceled" : failure === "timeout" ? "upstream_timeout" : "upstream_disconnected");
    expect(JSON.stringify(state)).not.toContain("secret request");
    expect(timeout).toHaveBeenCalledWith(900000);
    expect(Buffer.from((await operations.read({ operationId: operation.operationId, offset: 0, limit: 384 })).body, "base64").toString()).toBe("partial");
   } finally {
    upstream.stream.error(new Error("Test finished"));
    try { await running; } finally {
     timeout.mockRestore();
     vi.unstubAllGlobals();
    }
   }
  }
 });
 it("surfaces size limits and revocation without returning foreign handles",async()=>{
  await expect(start({method:"POST",body:"x".repeat(32*1024*1024+1)})).rejects.toMatchObject({code:"request_too_large"});
  const operation=await start();let calls=0;
  vi.stubGlobal("fetch",async()=>new Response(new ReadableStream({pull(c){if(calls++<65)c.enqueue(new Uint8Array(1024*1024));else c.close();}})));
  try{await execute(operation.operationId);expect(await operations.get(operation.operationId)).toMatchObject({state:"failed",error:{code:"response_too_large"},partial:true});}finally{vi.unstubAllGlobals();}
  const foreign=new ProxyOperations(f.env,{...auth,oauthGrantId:"foreign"});await expect(foreign.get(operation.operationId)).rejects.toMatchObject({status:404});
  const revoked=await start();await f.db.pool.query("UPDATE app.agent_integrations SET policy='disabled' WHERE tenant_id=$1 AND id=$2",[f.tenantId,integration]);await execute(revoked.operationId);await expect(operations.get(revoked.operationId)).rejects.toMatchObject({status:403});expect((await f.db.pool.query("SELECT state,error_code FROM app.proxy_operations WHERE tenant_id=$1 AND id=$2",[f.tenantId,revoked.operationId])).rows[0]).toMatchObject({state:"failed",error_code:"forbidden"});
 });
});
