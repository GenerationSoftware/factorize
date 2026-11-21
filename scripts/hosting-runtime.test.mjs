import { apiWranglerCli } from "./api-wrangler.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import https from "node:https";
import pg from "pg";
import { createHmac, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

function read(port, path, method = "GET", headers = {}, body) {
  return new Promise((resolve, reject) => {
    const request = https.request({ hostname: "localhost", port, path, method, headers, rejectUnauthorized: false }, response => {
      const chunks = []; response.on("data", chunk => chunks.push(chunk)); response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() }));
    });
    request.setTimeout(10_000, () => request.destroy(new Error("Hosting request timed out")));
    request.on("error", reject); request.end(body);
  });
}
test("actual Cloudflare local runtime enforces static/API/protocol ownership, headers and cache policy", { timeout: 60_000 }, async () => {
  const socket = createServer(); await new Promise(resolve => socket.listen(0, "127.0.0.1", resolve)); const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  const databaseUrl = new URL(process.env.AUTH_TEST_DATABASE_URL ?? "postgresql://postgres@localhost/factorize_test");
  if (!databaseUrl.password) databaseUrl.password = "local-runtime-only";
  const tenantId=randomUUID(), userId=randomUUID(), signingSecret=randomUUID(), encryptionKey=Buffer.alloc(32,1).toString("base64");
  let admin, databaseName;
  if (process.env.AUTH_TEST_DATABASE_URL) {
    admin = new pg.Client({ connectionString: databaseUrl.href }); await admin.connect();
    databaseName = "hosting_test_" + randomUUID().replaceAll("-", "");
    await admin.query(`CREATE DATABASE "${databaseName}"`); databaseUrl.pathname = "/" + databaseName;
    const migrated = new pg.Client({ connectionString: databaseUrl.href }); await migrated.connect();
    try { for (const file of (await readdir("packages/api/migrations")).filter(file => file.endsWith(".sql")).sort()) await migrated.query(await readFile("packages/api/migrations/" + file, "utf8"));
      await migrated.query("INSERT INTO app.tenants(id) VALUES($1)",[tenantId]);
      await migrated.query("INSERT INTO app.auth_users(id,email,email_verified) VALUES($1,'skills@fixture.test',true)",[userId]);
      await migrated.query("INSERT INTO app.members(tenant_id,user_id,email,role,session_version) VALUES($1,$2,'skills@fixture.test','owner',1)",[tenantId,userId]);
    }
    finally { await migrated.end(); }
  }
  const database = databaseUrl.href;
  assert.ok(["localhost", "127.0.0.1"].includes(new URL(database).hostname), "Hosting runtime requires a local database URL");
  // Keep the application origin distinct from Wrangler's preview host: its proxy
  // rewrites URL-valued headers that match the local listening host.
  const appOrigin = "https://factorize.test";
  const wranglerCli = apiWranglerCli;
  const child = spawn(process.execPath, [wranglerCli, "dev", "--local", "--local-protocol", "https", "--local-upstream", "factorize.test", "--port", String(port), "--var", `APP_ORIGIN:${appOrigin}`, "--var", `SESSION_SIGNING_SECRET:${signingSecret}`, "--var", `CREDENTIAL_ENCRYPTION_KEY:${encryptionKey}`], { cwd: fileURLToPath(new URL("../packages/api/", import.meta.url)), env: { ...process.env, CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: database }, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  const ready = new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error("Local Worker did not start: " + output)), 30_000);
    const chunk = value => { output += value.toString(); if (output.includes("Ready on")) { clearTimeout(deadline); resolve(); } };
    child.stdout.on("data", chunk); child.stderr.on("data", chunk);
    child.once("exit", code => { clearTimeout(deadline); reject(new Error(`Local Worker exited ${code}: ${output}`)); });
  });
  try {
    await ready;
    for (const path of ["/projects/id/runs", "/projects/id/settings", "/projects/id/settings/", "/future-feature/nested/page?tab=one", "/unknown", "/skills", "/skills/id", "/triggers/id/edit", "/triggers/id/settings", "/runs", "/runs/id", "/settings/authorized-clients", "/auth/verify?token=test-token"]) {
      const page = await read(port, path); assert.equal(page.status, 200); assert.match(page.headers["content-type"], /text\/html/); assert.equal(page.headers["cache-control"], "no-cache, must-revalidate"); assert.match(page.headers["content-security-policy"], /script-src 'self'/); assert.ok(!page.headers["content-security-policy"].includes("unsafe-inline")); assert.equal(page.headers["x-content-type-options"], "nosniff");
      const assetPath = page.body.match(/src="(\/assets\/[^"/]+\.js)"/)?.[1]; assert.ok(assetPath);
      const asset = await read(port, assetPath); assert.equal(asset.status, 200); assert.equal(asset.headers["cache-control"], "public, max-age=31536000, immutable");
    }
    const head = await read(port, "/triggers/id", "HEAD"); assert.equal(head.status, 200); assert.equal(head.body, "");
    const health = await read(port, "/healthz"); assert.equal(health.status, 200); assert.deepEqual(JSON.parse(health.body), { ok: true });
    const session = await read(port, "/api/v1/session"); assert.equal(session.status, 200); assert.equal(session.headers["x-factorize-contract"], "gen-2157-static-v1"); assert.deepEqual(JSON.parse(session.body), { authenticated: false });
    for (const [path, method, expected] of [["/api/unknown", "GET", 404], ["/api/v2/unknown", "GET", 404], ["/healthz/unknown", "GET", 404], ["/assets/subdir/missing.js", "GET", 404], ["/skills", "POST", 404], ["/api/v1/unknown", "GET", 401], ["/api/v1/triggers", "PATCH", 401], ["/oauth/unknown", "GET", 404], ["/auth/unknown", "GET", 404], ["/internal/unknown", "GET", 404], ["/webhooks/unknown", "GET", 404], ["/mcp", "GET", 401], ["/assets/missing.js", "GET", 404], ["/triggers", "POST", 404], ["/auth/logout", "GET", 404]]) {
      const result = await read(port, path, method); assert.equal(result.status, expected, path); assert.ok(!result.headers["content-type"]?.includes("text/html"), path); assert.equal(result.headers["cache-control"], "no-store", path);
    }
    // Unknown protocol requests fail validation before onboarding; they cannot become return cookies.
    for (const path of ["/authorize?client_id=client", ...(admin ? ["/device?user_code=ABCD-2345"] : [])]) { const result = await read(port, path); assert.equal(result.status, 400, path + ": " + result.body); assert.equal(result.headers["set-cookie"], undefined); }
    const csrf = await read(port, "/api/v1/auth/login", "POST", { Origin: "https://untrusted.test", "Content-Type": "application/json" }); assert.equal(csrf.status, 403);
    if (admin) {
      const session=Buffer.from(JSON.stringify({tenantId,userId,email:"skills@fixture.test",sessionVersion:1,exp:Math.floor(Date.now()/1000)+60})).toString("base64url");
      const signature=createHmac("sha256",signingSecret).update(session).digest("base64");
      const headers={Cookie:"factorize_session="+encodeURIComponent(session+"."+signature),Origin:appOrigin,"Content-Type":"application/json"};
      const created=await read(port,"/api/v1/skills","POST",headers,JSON.stringify({key:"review",body:"Original"}));
      assert.equal(created.status,201,created.body);
      const skill=JSON.parse(created.body);
      const credential=await read(port,"/api/v1/skill-library/token","POST",headers);
      assert.equal(credential.status,200);
      const {remote,token}=JSON.parse(credential.body);
      assert.equal(new URL(remote).hostname,"127.0.0.1");
      const directory=await mkdtemp(join(tmpdir(),"managed-skills-"));
      const git=(...args)=>execFileSync("git",args,{cwd:directory,stdio:"pipe",env:{...process.env,GIT_CONFIG_COUNT:"1",GIT_CONFIG_KEY_0:"http.extraHeader",GIT_CONFIG_VALUE_0:"Authorization: Bearer "+token}});
      try {
        git("clone","-q",remote,".");
        assert.equal(await readFile(join(directory,"skills/review/SKILL.md"),"utf8"),"Original");
        await writeFile(join(directory,"skills/review/SKILL.md"),"Updated via Git");
        git("-c","user.name=Fixture","-c","user.email=fixture@example.test","commit","-qam","Update skill");
        git("push","origin","main");
        // Local Artifacts supports Git but only emits repository lifecycle and token events.
        // Exercise the same publishing path invoked by the deployed push Workflow.
        const synced=await read(port,"/api/v1/skill-library/sync","POST",headers);
        assert.equal(synced.status,200);
        assert.equal(JSON.parse(synced.body).error,null);
        const published=JSON.parse((await read(port,"/api/v1/skills/"+skill.id,"GET",headers)).body);
        assert.equal(published.body,"Updated via Git");
        assert.equal(published.revision,2);
      } finally {await rm(directory,{recursive:true,force:true});}
    }
    const metadata = await read(port, "/.well-known/oauth-authorization-server"); assert.equal(metadata.status, 200); assert.equal(JSON.parse(metadata.body).issuer, appOrigin); assert.equal(JSON.parse(metadata.body).device_authorization_endpoint, `${appOrigin}/oauth/device_authorization`);
  } finally {
    try { process.kill(-child.pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; } await new Promise(resolve => { if (child.exitCode !== null || child.signalCode !== null) resolve(); else child.once("exit", resolve); });
    if (admin) { await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`); await admin.end(); }
  }
});
