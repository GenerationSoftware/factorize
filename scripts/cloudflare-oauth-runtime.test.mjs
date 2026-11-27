import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

test("Cloudflare token exchanges and refresh use real workerd fetch without following redirects", async () => {
  const received = [];
  const upstream = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const form = Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString()));
    received.push({ path: request.url, method: request.method, form });
    if (request.url === "/redirect-trap") {
      response.writeHead(204).end();
      return;
    }
    if (form.code === "fixture-redirect-code" || form.refresh_token === "fixture-redirect-refresh") {
      const status = form.code ? 307 : 308;
      response.writeHead(status, { Location: "http://127.0.0.1:" + upstream.address().port + "/redirect-trap" });
      response.end("fixture redirect body");
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ access_token: form.code ? "fixture-access" : "fixture-refreshed",
      refresh_token: "fixture-refresh", token_type: "bearer", expires_in: 300 }));
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");

  let worker;
  try {
    const fixtureOrigin = "http://127.0.0.1:" + upstream.address().port;
    const result = await build({ stdin: { resolveDir: process.cwd(), contents: [
      "import { exchangeCloudflareToken, TokenFailure } from './packages/api/src/integrations/providers/cloudflare-token.ts';",
      "const workerdFetch = globalThis.fetch.bind(globalThis);",
      // Redirect only the fixed provider address to the fixture; pass options
      // through unchanged to the real runtime's fetch implementation.
      "globalThis.fetch = (url, init) => {",
      "  if (url !== 'https://dash.cloudflare.com/oauth2/token') throw new Error('Unexpected fixture destination');",
      "  return workerdFetch(" + JSON.stringify(fixtureOrigin + "/oauth2/token") + ", init);",
      "};",
      "export default { async fetch(request) {",
      "  const input = await request.json();",
      "  try {",
      "    const tokens = await exchangeCloudflareToken({ CLOUDFLARE_OAUTH_CLIENT_ID: 'fixture-client', CLOUDFLARE_OAUTH_CLIENT_SECRET: 'fixture-secret' }, input);",
      "    return Response.json({ access: tokens.access });",
      "  } catch (error) {",
      "    if (error instanceof TokenFailure) return Response.json({ diagnostic: error.diagnostic }, { status: 502 });",
      "    throw error;",
      "  }",
      "} };",
    ].join("\n") }, bundle: true, platform: "browser", format: "esm", write: false });
    worker = new Miniflare({ workers: [{ config: {
      name: "cloudflare-token-test", type: "worker", compatibilityDate: "2026-09-10",
      manifest: { mainModule: "worker.js", modules: { "worker.js": { type: "esm", contents: result.outputFiles[0].text } } },
    } }] });
    const invoke = input => worker.dispatchFetch("https://cloudflare-token-test.invalid/", { method: "POST", body: JSON.stringify(input) });
    const code = value => ({ grant_type: "authorization_code", code: value, code_verifier: "fixture-verifier",
      redirect_uri: "https://factorize.test/oauth/cloudflare/callback" });
    const refresh = value => ({ grant_type: "refresh_token", refresh_token: value });
    for (const [input, expected] of [[code("fixture-code"), "fixture-access"], [refresh("fixture-refresh"), "fixture-refreshed"]]) {
      const response = await invoke(input);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { access: expected });
    }
    for (const input of [code("fixture-redirect-code"), refresh("fixture-redirect-refresh")]) {
      const response = await invoke(input);
      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), { diagnostic: "token_rejected" });
    }
    assert.deepEqual(received, [code("fixture-code"), refresh("fixture-refresh"), code("fixture-redirect-code"), refresh("fixture-redirect-refresh")]
      .map(form => ({ path: "/oauth2/token", method: "POST", form: { ...form, client_id: "fixture-client", client_secret: "fixture-secret" } })));
  } finally {
    try { await worker?.dispose(); }
    finally { await new Promise((resolve, reject) => upstream.close(error => error ? reject(error) : resolve())); }
  }
});
