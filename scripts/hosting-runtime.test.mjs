import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import https from "node:https";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";

function read(port, path, method = "GET", headers = {}) {
  return new Promise((resolve, reject) => {
    const request = https.request({ hostname: "localhost", port, path, method, headers, rejectUnauthorized: false }, response => {
      const chunks = []; response.on("data", chunk => chunks.push(chunk)); response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() }));
    });
    request.setTimeout(10_000, () => request.destroy(new Error("Hosting request timed out")));
    request.on("error", reject); request.end();
  });
}
test("actual Cloudflare local runtime enforces static/API/protocol ownership, headers and cache policy", { timeout: 60_000 }, async () => {
  const socket = createServer(); await new Promise(resolve => socket.listen(0, "127.0.0.1", resolve)); const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  const databaseUrl = new URL(process.env.AUTH_TEST_DATABASE_URL ?? "postgresql://postgres@localhost/factorize_test");
  if (!databaseUrl.password) databaseUrl.password = "local-runtime-only";
  let admin, databaseName;
  if (process.env.AUTH_TEST_DATABASE_URL) {
    admin = new pg.Client({ connectionString: databaseUrl.href }); await admin.connect();
    databaseName = "hosting_test_" + randomUUID().replaceAll("-", "");
    await admin.query(`CREATE DATABASE "${databaseName}"`); databaseUrl.pathname = "/" + databaseName;
    const migrated = new pg.Client({ connectionString: databaseUrl.href }); await migrated.connect();
    try { for (const file of (await readdir("packages/api/migrations")).filter(file => file.endsWith(".sql")).sort()) await migrated.query(await readFile("packages/api/migrations/" + file, "utf8")); }
    finally { await migrated.end(); }
  }
  const database = databaseUrl.href;
  assert.ok(["localhost", "127.0.0.1"].includes(new URL(database).hostname), "Hosting runtime requires a local database URL");
  const child = spawn("npm", ["exec", "--workspace=factorize", "--", "wrangler", "dev", "--local", "--local-protocol", "https", "--port", String(port), "--var", `APP_ORIGIN:https://localhost:${port}`], { env: { ...process.env, CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: database }, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  const ready = new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error("Local Worker did not start: " + output)), 30_000);
    const chunk = value => { output += value.toString(); if (output.includes("Ready on")) { clearTimeout(deadline); resolve(); } };
    child.stdout.on("data", chunk); child.stderr.on("data", chunk);
    child.once("exit", code => { clearTimeout(deadline); reject(new Error(`Local Worker exited ${code}: ${output}`)); });
  });
  try {
    await ready;
    for (const path of ["/jobs/id/edit", "/jobs/id/settings", "/job-runs/id", "/settings/authorized-clients", "/auth/verify?token=test-token"]) {
      const page = await read(port, path); assert.equal(page.status, 200); assert.match(page.headers["content-type"], /text\/html/); assert.equal(page.headers["cache-control"], "no-cache, must-revalidate"); assert.match(page.headers["content-security-policy"], /script-src 'self'/); assert.ok(!page.headers["content-security-policy"].includes("unsafe-inline")); assert.equal(page.headers["x-content-type-options"], "nosniff");
      const assetPath = page.body.match(/src="(\/assets\/[^"/]+\.js)"/)?.[1]; assert.ok(assetPath);
      const asset = await read(port, assetPath); assert.equal(asset.status, 200); assert.equal(asset.headers["cache-control"], "public, max-age=31536000, immutable");
    }
    const head = await read(port, "/jobs/id", "HEAD"); assert.equal(head.status, 200); assert.equal(head.body, "");
    const session = await read(port, "/api/v1/session"); assert.equal(session.status, 200); assert.equal(session.headers["x-factorize-contract"], "gen-2157-static-v1"); assert.deepEqual(JSON.parse(session.body), { authenticated: false });
    for (const [path, method, expected] of [["/api/v1/unknown", "GET", 401], ["/api/v1/jobs", "PATCH", 401], ["/oauth/unknown", "GET", 404], ["/auth/unknown", "GET", 404], ["/internal/unknown", "GET", 404], ["/webhooks/unknown", "GET", 404], ["/mcp", "GET", 401], ["/unknown", "GET", 404], ["/assets/missing.js", "GET", 404], ["/jobs", "POST", 404], ["/auth/logout", "GET", 404]]) {
      const result = await read(port, path, method); assert.equal(result.status, expected, path); assert.ok(!result.headers["content-type"]?.includes("text/html"), path); assert.equal(result.headers["cache-control"], "no-store", path);
    }
    // Unknown protocol requests fail validation before onboarding; they cannot become return cookies.
    for (const path of ["/authorize?client_id=client", ...(admin ? ["/device?user_code=ABCD-2345"] : [])]) { const result = await read(port, path); assert.equal(result.status, 400, path + ": " + result.body); assert.equal(result.headers["set-cookie"], undefined); }
    const csrf = await read(port, "/api/v1/auth/login", "POST", { Origin: "https://untrusted.test", "Content-Type": "application/json" }); assert.equal(csrf.status, 403);
    const metadata = await read(port, "/.well-known/oauth-authorization-server"); assert.equal(metadata.status, 200); assert.equal(JSON.parse(metadata.body).issuer, `https://localhost:${port}`); assert.equal(JSON.parse(metadata.body).device_authorization_endpoint, `https://localhost:${port}/oauth/device_authorization`);
  } finally {
    try { process.kill(-child.pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; } await new Promise(resolve => { if (child.exitCode !== null || child.signalCode !== null) resolve(); else child.once("exit", resolve); });
    if (admin) { await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`); await admin.end(); }
  }
});
