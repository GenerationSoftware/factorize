import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

test("Google authorization code POST succeeds in workerd and rejects upstream redirects", async () => {
  const received = [];
  const upstream = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const form = Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString()));
    received.push({ method: request.method, path: request.url, form });
    if (request.url !== "/token") {
      response.writeHead(204).end();
      return;
    }
    if (form.code === "fixture-code") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ id_token: "fixture-token" }));
    } else if (form.code === "fixture-invalid") {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "invalid_grant" }));
    } else {
      response.writeHead(Number(form.code), { "Content-Type": "application/json", Location: "/unexpected" });
      response.end(JSON.stringify({ error: "invalid_grant" }));
    }
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");

  let worker;
  try {
    const fixtureEndpoint = "http://127.0.0.1:" + upstream.address().port + "/token";
    const result = await build({ stdin: { resolveDir: process.cwd(), contents: [
      "import { requestGoogleIdToken } from './packages/api/src/auth/transport/google-token.ts';",
      "import { GoogleCallbackFailure } from './packages/api/src/auth/transport/google-callback-diagnostics.ts';",
      "const workerdFetch = globalThis.fetch.bind(globalThis);",
      // Remap only the fixed Google token endpoint and preserve all fetch options.
      "globalThis.fetch = (url, init) => {",
      "  if (url !== 'https://oauth2.googleapis.com/token') throw new Error('Unexpected fixture destination');",
      "  return workerdFetch(" + JSON.stringify(fixtureEndpoint) + ", init);",
      "};",
      "export default { async fetch(request) {",
      "  try { return Response.json({ idToken: await requestGoogleIdToken(await request.json()) }); }",
      "  catch (error) {",
      "    if (error instanceof GoogleCallbackFailure) return Response.json({ stage: error.code }, { status: 502 });",
      "    throw error;",
      "  }",
      "} };",
    ].join("\n") }, bundle: true, platform: "browser", format: "esm", write: false });
    worker = new Miniflare({ workers: [{ config: {
      name: "google-token-test", type: "worker", compatibilityDate: "2026-09-10",
      manifest: { mainModule: "worker.js", modules: { "worker.js": { type: "esm", contents: result.outputFiles[0].text } } },
    } }] });
    const form = code => ({
      grant_type: "authorization_code", code, client_id: "fixture-client", client_secret: "fixture-secret",
      redirect_uri: "https://factorize.test/oauth/google/sign-in/callback", code_verifier: "fixture-verifier",
    });
    const invoke = code => worker.dispatchFetch("https://google-token-test.invalid/", { method: "POST", body: JSON.stringify(form(code)) });
    const valid = await invoke("fixture-code");
    assert.equal(valid.status, 200);
    assert.deepEqual(await valid.json(), { idToken: "fixture-token" });
    const invalid = await invoke("fixture-invalid");
    assert.equal(invalid.status, 502);
    assert.deepEqual(await invalid.json(), { stage: "token_invalid_grant" });
    const redirects = ["302", "307", "308"];
    for (const code of redirects) {
      const response = await invoke(code);
      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), { stage: "token_rejected" });
    }
    assert.deepEqual(received, ["fixture-code", "fixture-invalid", ...redirects]
      .map(code => ({ method: "POST", path: "/token", form: form(code) })));
  } finally {
    try { await worker?.dispose(); }
    finally { await new Promise((resolve, reject) => upstream.close(error => error ? reject(error) : resolve())); }
  }
});
