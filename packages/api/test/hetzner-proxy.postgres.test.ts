import { expect, it, vi } from "vitest";
import { loadingFixture } from "./helpers/loading-fixture";
import { mcpRequest } from "./helpers/mcp-request";
import { processProxyOperation } from "../src/proxy/application/proxy-operations";
import { ConnectionRepository } from "../src/credentials/storage/connection-repository";
import worker from "../src/worker";
import type { OAuthProps } from "../src/types";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {}, WorkflowEntrypoint: class {}, DurableObject: class {} }));
vi.mock("@cloudflare/workers-oauth-provider", () => ({ OAuthProvider: class {}, AuthorizationError: class extends Error {}, getOAuthApi: vi.fn() }));
const url = process.env.AUTH_TEST_DATABASE_URL;
const ctx = { waitUntil() {} } as unknown as ExecutionContext;

it.skipIf(!url)("routes native Hetzner reads and writes through sync/async proxy and fences retained results with the current exact grant", async () => {
  const f = await loadingFixture(url!);
  const first = crypto.randomUUID(), second = crypto.randomUUID();
  const auth = (id = first): OAuthProps => ({ ...f.auth, scopes: ["proxy:use"], authMethod: "oauth",
    oauthInstallationId: id, oauthClientId: "same-app", oauthGrantId: "grant-" + id, oauthExpiresAt: Date.now() / 1000 + 120 });
  const mcp = mcpRequest(f.env, auth());
  const invoke = async (name: string, args: object = {}, identity = auth()) =>
    (await mcp("tools/call", { name, arguments: args }, identity)).message.result;
  const project = (body: object) => worker.fetch(new Request(f.env.APP_ORIGIN + "/api/v1/hetzner/connection", {
    method: "PUT", headers: { Cookie:f.cookie, Origin:f.env.APP_ORIGIN, "Content-Type":"application/json" }, body:JSON.stringify(body),
  }), f.env, ctx);
  const registry = async () => (await f.db.pool.query<{id:string;epoch:number}>(
    "SELECT id,epoch FROM app.agent_integrations WHERE tenant_id=$1 AND kind='hetzner'", [f.tenantId],
  )).rows[0]!;
  const ownerGrant = async (installationId: string, enabled: boolean) => {
    const { id, epoch } = await registry();
    const result = await worker.fetch(new Request(f.env.APP_ORIGIN + `/api/v1/access/authorizations/${installationId}/permissions`, {
      method: "PUT", headers: { Cookie:f.cookie, Origin:f.env.APP_ORIGIN, "Content-Type":"application/json" },
      body: JSON.stringify({ scopes:["proxy:use", ...(enabled ? [`integration:${id}:${epoch}`] : [])] }),
    }), f.env, ctx);
    expect(result.status).toBe(200);
  };
  const objects = new Map<string, Uint8Array>();
  f.env.PROXY_ARTIFACTS = {
    put: async (key: string, bytes: ArrayBuffer) => { objects.set(key, new Uint8Array(bytes).slice()); },
    get: async (key: string, { range }: {range:{offset:number;length:number}}) => {
      const bytes = objects.get(key)?.slice(range.offset, range.offset + range.length);
      return bytes ? { arrayBuffer: async () => bytes.buffer } : null;
    },
  } as unknown as R2Bucket;
  f.env.SCHEDULER = { idFromName:(v:string)=>v, get:()=>({ fetch:async()=>Response.json({scheduled:true}) }) } as unknown as DurableObjectNamespace;
  const readToken = "syntheticLegacyProjectToken", writeToken = "syntheticNativeWriteToken";
  const validations = { reads: 0, writes: 0 };
  const nativeBody = '{ "name": "demo", "image": "ubuntu-24.04", "server_type": "cx23", "ssh_keys": [123], "user_data": "#cloud-config\\n" }';
  let redirect = false, huge = false;
  const nativeReply = {server:{id:88, name:"demo"}, action:{id:35,status:"running"}, custom:"unmodified-native-response"};
  const provider = vi.fn<typeof fetch>(async (input, init) => {
    const request = new Request(input, init);
    expect(new URL(request.url).origin).toBe("https://api.hetzner.cloud");
    expect(request.redirect).toBe("manual");
    const token = request.headers.get("Authorization");
    expect(request.headers.get("X-HTTP-Method-Override")).toBeNull();
    expect(request.headers.get("Cookie")).toBeNull();
    if (redirect) return new Response(null, { status:302, headers:{Location:"https://elsewhere.example/"} });
    if (request.method === "POST") {
      expect(token).toBe("Bearer " + writeToken);
      expect(new URL(request.url).pathname).toBe("/v1/servers");
      expect(await request.text()).toBe(nativeBody);
      expect(request.headers.get("Content-Type")).toBe("application/json");
      validations.writes++;
      return Response.json(nativeReply, {status:201,headers:{"x-provider-request":"native-123","x-authorization-token":"filtered"}});
    }
    expect(request.method).toBe("GET");
    expect([readToken, writeToken].map(v=>"Bearer "+v)).toContain(token);
    validations.reads++;
    return Response.json(huge ? { servers:[], pad:"x".repeat(6000) } :
      {servers:[{id:88,name:"demo",status:"running",location:{name:"fsn1"}}],meta:{pagination:{next_page:null}}}, {headers:{"x-provider-request":"native-read"}});
  });
  vi.stubGlobal("fetch", provider);
  try {
    // A project approved for the former bounded tool is still not approved for native writes.
    await new ConnectionRepository(f.db, f.tenantId, f.env.CREDENTIAL_ENCRYPTION_KEY)
      .put("hetzner", { name:"Legacy", token:readToken, revision:crypto.randomUUID(), provisioningEnabled:true });
    const { id: integration } = await registry();
    for (const id of [first, second]) await f.db.pool.query(`INSERT INTO app.oauth_installations
      (tenant_id,user_id,id,client_id,redirect_uri,active_grant_id,active_session_version,active_scopes,selected_scopes)
      VALUES($1,$2,$3,'same-app','https://example.test',$4,$5,ARRAY['proxy:use'],ARRAY['proxy:use'])`,
    [f.tenantId,f.userId,id,"grant-"+id,f.auth.sessionVersion]);
    const get = { integration, method:"GET", path:"/v1/servers?name=demo", execution:"sync",
      headers:{Authorization:"Bearer caller-override",Cookie:"caller-cookie","X-HTTP-Method-Override":"POST"} };
    const post = { integration, method:"POST", path:"/v1/servers", headers:{"Content-Type":"application/json"}, body:nativeBody };
    expect((await invoke("request_api",get)).isError).toBe(true);
    expect(provider).not.toHaveBeenCalled();
    await ownerGrant(first,true);
    const reflection = (await invoke("get_api_reflection")).structuredContent.integrations.find((row: any)=>row.id===integration);
    expect(reflection).toMatchObject({kind:"hetzner",access:"granted",requestExample:{integration,method:"GET",path:"/v1/servers"}});
    expect(JSON.stringify(reflection)).not.toContain(readToken);
    expect((await invoke("request_api",get,auth(second))).isError).toBe(true);
    expect((await invoke("request_api",{...get,path:"/v1/../oauth/test"})).isError).toBe(true);
    expect((await invoke("request_api",{...get,path:"//elsewhere.example/v1/servers"})).isError).toBe(true);
    expect((await invoke("request_api",post)).isError).toBe(true);
    expect((await invoke("request_api",{...post,execution:"sync"})).isError).toBe(true);
    expect(provider).not.toHaveBeenCalled();
    const read = (await invoke("request_api",get)).structuredContent;
    expect(read).toMatchObject({status:200,headers:{"x-provider-request":"native-read"}});
    expect(JSON.parse(read.body)).toMatchObject({servers:[{id:88,name:"demo",location:{name:"fsn1"}}]});
    expect(String(provider.mock.calls[0]?.[0])).toBe("https://api.hetzner.cloud/v1/servers?name=demo");

    const oldKey = (await invoke("get_hetzner_ssh_public_key")).structuredContent;
    expect(oldKey.publicKey).toMatch(/^ssh-ed25519 /);
    expect(oldKey.privateKey).toBeUndefined();
    expect((await invoke("get_hetzner_ssh_public_key",{},auth(second))).isError).toBe(true);

    const turnedOn = await project({name:"Native",token:writeToken,nativeWritesEnabled:true});
    expect(await turnedOn.json()).toEqual({connection:{name:"Native",nativeWritesEnabled:true}});
    expect((await invoke("request_api",post)).isError).toBe(true);
    expect(validations.writes).toBe(0);
    await ownerGrant(first,true);
    const currentKey = (await invoke("get_hetzner_ssh_public_key")).structuredContent;
    expect((await invoke("get_hetzner_ssh_public_key")).structuredContent).toEqual(currentKey);
    await ownerGrant(second,true);
    expect((await invoke("get_hetzner_ssh_public_key",{},auth(second))).structuredContent.publicKey).not.toBe(currentKey.publicKey);

    const receipt = (await invoke("request_api",{...post,idempotencyKey:"stable-native-post"})).structuredContent;
    expect(receipt).toMatchObject({state:"queued",operationId:expect.any(String)});
    expect((await invoke("request_api",{...post,idempotencyKey:"stable-native-post"})).structuredContent.operationId).toBe(receipt.operationId);
    await processProxyOperation(f.env,f.tenantId,receipt.operationId);
    await processProxyOperation(f.env,f.tenantId,receipt.operationId);
    expect(validations.writes).toBe(1);
    expect((await invoke("get_api_operation",{operationId:receipt.operationId})).structuredContent).toMatchObject({state:"complete",status:201,responseHandle:receipt.operationId});
    const retained = (await invoke("read_api_response",{handle:receipt.operationId})).structuredContent;
    expect(JSON.parse(Buffer.from(retained.body,"base64").toString())).toEqual(nativeReply);
    expect((await invoke("read_api_response",{handle:receipt.operationId},auth(second))).isError).toBe(true);

    const live = (await invoke("request_api",{...post,execution:"sync"})).structuredContent;
    expect(live.status).toBe(201);
    expect(live.headers["x-authorization-token"]).toBeUndefined();
    expect(JSON.parse(live.body)).toEqual(nativeReply);
    redirect = true;
    expect((await invoke("request_api",get)).isError).toBe(true);
    redirect = false;
    huge = true;
    const handle = (await invoke("request_api",get)).structuredContent.handle;
    expect(handle).toBeTruthy();
    expect((await invoke("read_api_response",{handle})).isError).not.toBe(true);
    huge = false;

    const canceledGrant = (await invoke("request_api",{...post,idempotencyKey:"revoked-before-dispatch"})).structuredContent;
    await ownerGrant(first,false);
    await processProxyOperation(f.env,f.tenantId,canceledGrant.operationId);
    expect(validations.writes).toBe(2);
    expect((await invoke("get_api_operation",{operationId:canceledGrant.operationId})).isError).toBe(true);
    expect((await invoke("read_api_response",{handle:receipt.operationId})).isError).toBe(true);
    expect((await invoke("read_api_response",{handle})).isError).toBe(true);
    expect((await invoke("get_hetzner_ssh_public_key")).isError).toBe(true);
    expect((await invoke("request_api",get)).isError).toBe(true);

    await ownerGrant(first,true);
    const staleProject = (await invoke("request_api",{...post,idempotencyKey:"rotated-before-dispatch"})).structuredContent;
    const rotated = await project({name:"New read-only project",token:readToken});
    expect(await rotated.json()).toEqual({connection:{name:"New read-only project"}});
    await ownerGrant(first,true);
    await processProxyOperation(f.env,f.tenantId,staleProject.operationId);
    expect(validations.writes).toBe(2);
    expect((await invoke("get_api_operation",{operationId:staleProject.operationId})).isError).toBe(true);
    expect((await invoke("read_api_response",{handle:receipt.operationId})).isError).toBe(true);
    expect((await invoke("request_api",get)).structuredContent.status).toBe(200);
    expect((await invoke("request_api",post)).isError).toBe(true);
  } finally { vi.unstubAllGlobals(); await f.cleanup(); }
});
