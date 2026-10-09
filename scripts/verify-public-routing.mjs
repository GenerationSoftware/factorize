import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
export const STATIC_CONTRACT = "gen-2157-static-v1";
export async function requireApiReady(origin, fetcher = fetch) {
  const response = await fetcher(`${origin}/api/v1/session`, { redirect: "manual", signal: AbortSignal.timeout(15_000) });
  assert.equal(response.status, 200, "Deploy API compatibility stage ff4b51b before static cutover: public session is unavailable");
  assert.equal(response.headers.get("X-Factorize-Contract"), STATIC_CONTRACT, "Deploy API compatibility stage ff4b51b before static cutover: complete contract marker is missing");
  assert.deepEqual(await response.json(), { authenticated: false });
}
export async function verifyPublicRouting(origin) {
  await requireApiReady(origin);
  for (const path of ["/jobs", "/jobs/route-probe/edit", "/job-runs/route-probe", "/settings/api-keys", "/auth/password-reset?token=route-probe"]) {
    const response = await fetch(origin + path, { redirect: "manual", signal: AbortSignal.timeout(15_000) });
    assert.equal(response.status, 200, path); assert.match(response.headers.get("Content-Type"), /text\/html/);
    assert.equal(response.headers.get("Cache-Control"), "no-cache, must-revalidate");
    const policy = response.headers.get("Content-Security-Policy"); assert.match(policy, /script-src 'self'/); assert.ok(!/unsafe-inline|nonce-/.test(policy));
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    const body = await response.text(), assetPath = body.match(/src="(\/assets\/[^"/]+\.js)"/)?.[1]; assert.ok(assetPath, "Expected an external compiled script");
    const asset = await fetch(origin + assetPath, { redirect: "manual", signal: AbortSignal.timeout(15_000) }); assert.equal(asset.status, 200); assert.match(asset.headers.get("Content-Type"), /javascript/); assert.equal(asset.headers.get("Cache-Control"), "public, max-age=31536000, immutable");
  }
  for (const path of ["/api/v1/route-probe-missing", "/oauth/route-probe-missing", "/auth/route-probe-missing", "/internal/route-probe-missing", "/webhooks/route-probe-missing", "/mcp", "/route-probe-missing", "/assets/route-probe-missing.js"]) {
    const response = await fetch(origin + path, { redirect: "manual", signal: AbortSignal.timeout(15_000) }); assert.ok([401, 404, 405].includes(response.status), path); assert.ok(!response.headers.get("Content-Type")?.includes("text/html"), path);
  }
  const metadata = await (await fetch(origin + "/.well-known/oauth-authorization-server", { signal: AbortSignal.timeout(15_000) })).json(); assert.equal(metadata.issuer, origin); assert.equal(metadata.device_authorization_endpoint, origin + "/oauth/device_authorization");
}
if (import.meta.main) {
  const origin = process.argv.slice(2).find(argument => !argument.startsWith("--")) ?? JSON.parse(readFileSync(new URL("../packages/api/wrangler.jsonc", import.meta.url))).vars.APP_ORIGIN; assert.equal(new URL(origin).origin, origin); assert.equal(new URL(origin).protocol, "https:");
  if (process.argv.includes("--api-ready")) await requireApiReady(origin); else await verifyPublicRouting(origin);
  console.log(process.argv.includes("--api-ready") ? "Public API compatibility stage verified." : "Public static/API routing, security and cache policy verified.");
}
