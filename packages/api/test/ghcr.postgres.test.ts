import { expect, it, vi } from "vitest";
import worker from "../src/worker";
import { ghcrReadPath } from "../src/integrations/providers/ghcr";
import { loadingFixture } from "./helpers/loading-fixture";
import { mcpRequest } from "./helpers/mcp-request";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {}, WorkflowEntrypoint: class {}, DurableObject: class {} }));
vi.mock("@cloudflare/workers-oauth-provider", () => ({ OAuthProvider: class {}, AuthorizationError: class extends Error {}, getOAuthApi: vi.fn() }));
const database = process.env.AUTH_TEST_DATABASE_URL;
const endpoint = "/api/v1/integrations/ghcr";
const image = "fixture-owner/private-image";
const token = "syntheticFixtureToken123456";
const replacement = "syntheticReplacementToken789";
const registryToken = "synthetic.RegistryToken";

it("limits registry operations to read-only metadata under the existing image", () => {
  expect(ghcrReadPath(image,"/tags/list?n=2&last=fixture","GET")).toBe("/v2/"+image+"/tags/list?n=2&last=fixture");
  expect(ghcrReadPath(image,"/manifests/sha256:" + "0".repeat(64),"HEAD")).toBe("/v2/"+image+"/manifests/sha256:" + "0".repeat(64));
  for (const [path,method] of [
    ["/tags/list","POST"], ["/tags/list?n=101","GET"], ["/tags/list?n=1&n=2","GET"],
    ["/tags/list?scope=repository:another:pull","GET"], ["/manifests/latest?token=x","GET"],
    ["/manifests/../other","GET"], ["/manifests/%2e%2e","GET"], ["//alternate.trap","GET"],
    ["/v2/other/path/tags/list","GET"], ["/token","GET"], ["/blobs/sha256:" + "0".repeat(64),"GET"],
  ]) expect(() => ghcrReadPath(image,path,method)).toThrow();
});

it.skipIf(!database)("allows granted clients to inspect one image while keeping registry secrets and other operations private", async () => {
  const f = await loadingFixture(database!);
  const call = (method: string, path: string, body?: unknown) => worker.fetch(new Request(f.env.APP_ORIGIN + path, {
    method, headers: { Cookie: f.cookie, Origin: f.env.APP_ORIGIN, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), f.env, { waitUntil() {} } as any);
  const upstream = vi.fn<typeof fetch>();
  let expectedPat = token;
  try {
    const created = await call("POST",endpoint,{ image, username:"fixture-user", token });
    expect(created.status).toBe(201);
    const row = await created.json() as { id: string; revision: number };
    expect(row).toMatchObject({ image, username:"fixture-user", revision:0 });
    expect(row).not.toHaveProperty("token");
    expect(await (await call("GET",endpoint)).json()).toEqual([row]);
    expect((await call("POST",endpoint,{ image, username:"fixture-user", token })).status).toBe(409);
    const stored = (await f.db.pool.query("SELECT encrypted_token FROM app.ghcr_connections WHERE tenant_id=$1 AND id=$2",[f.tenantId,row.id])).rows[0];
    expect(stored.encrypted_token).not.toContain(token);
    const integration = (await f.db.pool.query<{ id:string; epoch:number }>(
      "SELECT id,epoch FROM app.agent_integrations WHERE tenant_id=$1 AND kind='ghcr' AND credential_id=$2",[f.tenantId,row.id])).rows[0];
    const auth = { ...f.auth, authMethod: "oauth" as const, oauthGrantId:"ghcr-fixture", oauthClientId:"test-client",
      oauthExpiresAt:Date.now()/1000+600, explicitIntegrationScopes:true, scopes:["proxy:use",`integration:${integration.id}:${integration.epoch}`] };
    const invoke = (method: string, path: string, credentials = auth) => mcpRequest(f.env,credentials)("tools/call", {
      name:"request_api", arguments:{ integration:integration.id, method, path, execution:"sync", headers:{authorization:"untrusted"} },
    });
    upstream.mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      const headers = new Headers(init?.headers);
      expect(url.origin).toBe("https://ghcr.io");
      expect(init?.redirect).toBe("manual");
      if (url.pathname === "/token") {
        expect([...url.searchParams]).toEqual([["service","ghcr.io"],["scope",`repository:${image}:pull`]]);
        expect(headers.get("authorization")).toBe("Basic " + btoa("fixture-user:" + expectedPat));
        return Response.json({ token:registryToken });
      }
      expect(headers.get("authorization")).toBe("Bearer " + registryToken);
      expect(url.pathname).toMatch(/^\/v2\/fixture-owner\/private-image\/(?:tags\/list|manifests\/latest)$/);
      const output = { headers: { "docker-content-digest":"sha256:abc", "x-private-token":registryToken, "location":"https://storage.example/signed" } };
      return init?.method === "HEAD" ? new Response(null, output) : Response.json({tags:["fixture"]},output);
    });
    vi.stubGlobal("fetch",upstream);
    expect((await invoke("GET","/tags/list",{ ...auth, scopes:["proxy:use"] })).status).toBe(403);
    for (const [method,path] of [["POST","/tags/list"],["GET","/blobs/digest"],["GET","/token"],["GET","/manifests/%2E"]])
      expect((await invoke(method,path)).message.result.isError).toBe(true);
    expect(upstream).not.toHaveBeenCalled();
    const tags = (await invoke("GET","/tags/list?n=25")).message.result.structuredContent;
    expect(tags).toMatchObject({ status:200, body:JSON.stringify({tags:["fixture"]}) });
    expect(JSON.stringify(tags)).not.toMatch(/synthetic|signed|location/i);
    expect((await invoke("HEAD","/manifests/latest")).message.result.structuredContent).toMatchObject({status:200,headers:{"docker-content-digest":"sha256:abc"}});

    expect((await call("PUT",endpoint+"/"+row.id,{ username:"fixture-user", token:replacement, expectedRevision:99 })).status).toBe(409);
    expect((await call("PUT",endpoint+"/"+row.id,{ username:"fixture-user", token:replacement, expectedRevision:row.revision })).status).toBe(200);
    expectedPat = replacement;
    expect((await invoke("GET","/tags/list")).message.result.structuredContent.status).toBe(200);

    upstream.mockImplementationOnce(async () => new Response("secret redirect",{status:307,headers:{Location:"https://evil.example"}}));
    expect((await invoke("GET","/tags/list")).message.result.isError).toBe(true);
    expect(upstream.mock.calls).toHaveLength(7);
    const target = { kind:"ghcr", id:row.id };
    const impact = await (await call("POST","/api/v1/integrations/removal/preview",target)).json() as {fingerprint:string;needsConfirmation:boolean};
    expect((await call("POST","/api/v1/integrations/removal/confirm",{...target,fingerprint:impact.fingerprint,confirmImpact:impact.needsConfirmation})).status).toBe(200);
    expect((await call("GET",endpoint)).status).toBe(200);
    expect(await (await call("GET",endpoint)).json()).toEqual([]);
    expect((await invoke("GET","/tags/list")).message.result.isError).toBe(true);
    expect(upstream.mock.calls).toHaveLength(7);
  } finally { vi.unstubAllGlobals(); await f.cleanup(); }
});
