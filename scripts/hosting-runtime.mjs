import assert from "node:assert/strict";

export async function checkHosting({ read, appOrigin, cookie }) {
  for (const path of ["/projects/id/settings", "/projects/id/settings/", "/future-feature/nested/page?tab=one", "/unknown", "/workloads", "/workloads/id", "/apps", "/settings/apps", "/triggers/id/edit", "/triggers/id/settings", "/settings/authorized-clients", "/auth/verify?token=test-token"]) {
    const page = await read(path); assert.equal(page.status, 200); assert.match(page.headers["content-type"], /text\/html/); assert.equal(page.headers["cache-control"], "no-cache, must-revalidate"); assert.match(page.headers["content-security-policy"], /script-src 'self'/); assert.ok(!page.headers["content-security-policy"].includes("unsafe-inline")); assert.equal(page.headers["x-content-type-options"], "nosniff");
    const assetPath = page.body.match(/src="(\/assets\/[^"/]+\.js)"/)?.[1]; assert.ok(assetPath);
    const asset = await read(assetPath); assert.equal(asset.status, 200); assert.equal(asset.headers["cache-control"], "public, max-age=31536000, immutable");
  }
  const head = await read("/triggers/id", "HEAD"); assert.equal(head.status, 200); assert.equal(head.body, "");
  const health = await read("/healthz"); assert.equal(health.status, 200); assert.deepEqual(JSON.parse(health.body), { ok: true });
  const session = await read("/api/v1/session"); assert.equal(session.status, 200); assert.equal(session.headers["x-factorize-contract"], "gen-2157-static-v1"); assert.deepEqual(JSON.parse(session.body), { authenticated: false });
  for (const [path, method, expected] of [["/api/unknown", "GET", 404], ["/api/v2/unknown", "GET", 404], ["/healthz/unknown", "GET", 404], ["/assets/subdir/missing.js", "GET", 404], ["/skills", "POST", 404], ["/api/v1/unknown", "GET", 401], ["/api/v1/triggers", "PATCH", 401], ["/oauth/unknown", "GET", 404], ["/auth/unknown", "GET", 404], ["/internal/unknown", "GET", 404], ["/webhooks/unknown", "GET", 404], ["/mcp", "GET", 401], ["/assets/missing.js", "GET", 404], ["/triggers", "POST", 404], ["/auth/logout", "GET", 404]]) {
    const result = await read(path, method); assert.equal(result.status, expected, path); assert.ok(!result.headers["content-type"]?.includes("text/html"), path); assert.equal(result.headers["cache-control"], "no-store", path);
  }
  // Unknown protocol requests fail validation before onboarding; they cannot become return cookies.
  for (const path of ["/authorize?client_id=client", "/device?user_code=ABCD-2345"]) { const result = await read(path); assert.equal(result.status, 400, path + ": " + result.body); assert.equal(result.headers["set-cookie"], undefined); }
  const csrf = await read("/api/v1/auth/login", "POST", undefined, { Origin: "https://untrusted.test", "Content-Type": "application/json" }); assert.equal(csrf.status, 403);
  {
    const headers = { Cookie: cookie, Origin: appOrigin, "Content-Type": "application/json" };
    for (const path of ["/api/v1/skills", "/api/v1/skill-library", "/api/v1/search?q=review"]) {
      const retired = await read(path, "GET", undefined, headers);
      assert.equal(retired.status, 404, path);
    }
  }
  const metadata = await read("/.well-known/oauth-authorization-server"); assert.equal(metadata.status, 200); assert.equal(JSON.parse(metadata.body).issuer, appOrigin); assert.equal(JSON.parse(metadata.body).device_authorization_endpoint, `${appOrigin}/oauth/device_authorization`);
}
