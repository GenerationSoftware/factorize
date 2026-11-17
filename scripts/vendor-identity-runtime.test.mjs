import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

test("vendor discovery and signing keys use Worker-compatible requests and reject redirects", async () => {
  const result = await build({
    stdin: { resolveDir: process.cwd(), contents: `
      import { discoverVendorIssuerTrust } from './packages/api/src/vendor-run-identity.ts';
      export default { async fetch(request) {
        const scenario = new URL(request.url).pathname;
        const issuer = 'https://exe.dev/issuer/test';
        const fetcher = async (input, init) => {
          // Construct with workerd's Request, which rejects redirect: "error"
          // before network I/O. Node's Request accepts it and hid this failure.
          const outbound = new Request(input, init);
          if (outbound.redirect !== 'manual') throw new Error('Redirects must not be followed');
          const discovery = outbound.url.endsWith('/.well-known/openid-configuration');
          if ((discovery && scenario === '/discovery-redirect') || (!discovery && scenario === '/keys-redirect')) {
            return Response.redirect('https://untrusted.example/keys', 302);
          }
          return Response.json(discovery
            ? { issuer, jwks_uri: 'https://exe.dev/keys' }
            : { keys: [{ kid: 'test-key', kty: 'RSA' }] });
        };
        try {
          const trust = await discoverVendorIssuerTrust({ provider: 'exe.dev', issuer, fetcher });
          const key = await trust.resolveKey('test-key', false);
          return Response.json({ issuer: trust.issuer, keyId: key?.kid });
        } catch (error) {
          return Response.json({ error: error.message }, { status: 502 });
        }
      }};
    ` },
    bundle: true, platform: "browser", format: "esm", write: false,
  });
  const worker = new Miniflare({ workers: [{ config: {
    name: "vendor-identity", type: "worker",
    manifest: { mainModule: "identity.js", modules: { "identity.js": { type: "esm", contents: result.outputFiles[0].text } } },
    compatibilityDate: "2026-09-10", compatibilityFlags: ["global_fetch_strictly_public"],
  } }] });
  try {
    const success = await worker.dispatchFetch("https://identity.test/success");
    assert.equal(success.status, 200);
    assert.deepEqual(await success.json(), { issuer: "https://exe.dev/issuer/test", keyId: "test-key" });
    for (const [path, expected] of [["discovery-redirect", "Vendor issuer metadata unavailable (302)"], ["keys-redirect", "Vendor signing keys unavailable (302)"]]) {
      const response = await worker.dispatchFetch(`https://identity.test/${path}`);
      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), { error: expected });
    }
  } finally { await worker.dispose(); }
});
