import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

test("Hetzner inventory, AWS STS and signed AWS MCP reach workerd upstreams without following redirects", async () => {
  const seen = [];
  let redirectEndpoint = "";
  const upstream = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    const path = new URL(request.url, "http://fixture.test").pathname;
    seen.push({ path, method: request.method, authorization: request.headers.authorization, body });
    if (path === redirectEndpoint) {
      response.writeHead(307, { Location: "/redirect-trap" }).end("fixture redirect");
      return;
    }
    const json = data => response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(data));
    if (path === "/hetzner/v1/servers") return json({ servers: [], meta: { pagination: { next_page: null } } });
    if (path === "/sts/") {
      return response.writeHead(200, { "Content-Type": "text/xml" }).end(
        "<AssumeRoleWithWebIdentityResponse><AssumeRoleWithWebIdentityResult><Credentials>" +
        "<AccessKeyId>ASIAAAAAAAAAAAAAAAAA</AccessKeyId><SecretAccessKey>" + "S".repeat(40) + "</SecretAccessKey>" +
        "<SessionToken>syntheticSessionTokenForTesting</SessionToken><Expiration>" + new Date(Date.now() + 900_000).toISOString() +
        "</Expiration></Credentials></AssumeRoleWithWebIdentityResult></AssumeRoleWithWebIdentityResponse>");
    }
    if (path === "/mcp/mcp") {
      const rpc = JSON.parse(body);
      if (rpc.method === "initialize") return json({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-11-25" } });
      if (rpc.method === "notifications/initialized") return response.writeHead(202).end();
      return json({ jsonrpc: "2.0", id: 2, result: { structuredContent: { status: "success", return_value: "fixture result" } } });
    }
    response.writeHead(204).end();
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  let worker;
  try {
    const origin = "http://127.0.0.1:" + upstream.address().port;
    const result = await build({ stdin: { resolveDir: process.cwd(), contents: `
      import { createHetznerCloudClient } from './packages/api/src/integrations/providers/hetzner-cloud.ts';
      import { exchangeAwsWorkload } from './packages/api/src/integrations/providers/aws/sts.ts';
      import { runAwsScript } from './packages/api/src/integrations/providers/aws/mcp-client.ts';
      const fixtureOrigin = ${JSON.stringify(origin)};
      const workerdFetch = globalThis.fetch.bind(globalThis);
      globalThis.fetch = (input, init) => {
        const request = new Request(input, init);
        const target = new URL(request.url);
        const fixture = { "https://api.hetzner.cloud": "/hetzner", "https://sts.us-east-1.amazonaws.com": "/sts",
          "https://aws-mcp.us-east-1.api.aws": "/mcp" }[target.origin];
        if (!fixture) throw new Error("Unexpected fixture destination");
        return workerdFetch(new Request(fixtureOrigin + fixture + target.pathname + target.search, request));
      };
      export default { async fetch(request) {
        const provider = new URL(request.url).pathname.slice(1);
        try {
          if (provider === "hetzner") {
            await createHetznerCloudClient().validate("fixtureHetzner");
            return Response.json({ ok: true });
          }
          const credentials = await exchangeAwsWorkload("us-east-1", "arn:aws:iam::123456789012:role/Fixture",
            "syntheticWorkloadToken", "fixture");
          if (provider === "sts") return Response.json({ ok: !!credentials.sessionToken });
          return Response.json(await runAwsScript(credentials, "us-east-1", "'fixture'", async () => {}));
        } catch (error) {
          return Response.json({ reason: error.reason, status: error.upstreamStatus ?? error.status }, { status: 502 });
        }
      } };
    ` }, bundle: true, platform: "browser", format: "esm", write: false });
    worker = new Miniflare({ workers: [{ config: {
      name: "provider-redirect-test", type: "worker", compatibilityDate: "2026-09-10",
      manifest: { mainModule: "worker.js", modules: { "worker.js": { type: "esm", contents: result.outputFiles[0].text } } },
    } }] });
    const invoke = provider => worker.dispatchFetch("https://provider-redirect-test.invalid/" + provider);
    for (const provider of ["hetzner", "sts"]) {
      const response = await invoke(provider);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true });
    }
    assert.deepEqual(await (await invoke("mcp")).json(), { status: "completed", result: "fixture result" });
    assert.deepEqual(seen.map(x => x.path), ["/hetzner/v1/servers", "/sts/", "/sts/", "/mcp/mcp", "/mcp/mcp", "/mcp/mcp"]);
    assert.equal(seen[0].authorization, "Bearer fixtureHetzner");
    assert.equal(new URLSearchParams(seen[1].body).get("WebIdentityToken"), "syntheticWorkloadToken");
    assert.match(seen[3].authorization, /^AWS4-HMAC-SHA256 /);

    for (const [provider, endpoint, expected] of [
      ["hetzner", "/hetzner/v1/servers", { reason: "unexpected_status", status: 307 }],
      ["sts", "/sts/", { status: 307 }],
      ["mcp", "/mcp/mcp", { status: 307 }],
    ]) {
      redirectEndpoint = endpoint;
      const before = seen.length;
      const response = await invoke(provider);
      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), expected);
      assert.deepEqual(seen.slice(before).map(x => x.path), provider === "mcp" ? ["/sts/", endpoint] : [endpoint]);
    }
    assert.equal(seen.some(x => x.path === "/redirect-trap"), false);
  } finally {
    try { await worker?.dispose(); }
    finally { await new Promise((resolve, reject) => upstream.close(error => error ? reject(error) : resolve())); }
  }
});
