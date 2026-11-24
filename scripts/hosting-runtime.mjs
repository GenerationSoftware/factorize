import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

export async function checkHosting({ read, appOrigin, cookie }) {
  for (const path of ["/projects/id/settings", "/projects/id/settings/", "/future-feature/nested/page?tab=one", "/unknown", "/skills", "/skills/id", "/triggers/id/edit", "/triggers/id/settings", "/settings/authorized-clients", "/auth/verify?token=test-token"]) {
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
    const created=await read("/api/v1/skills","POST",JSON.stringify({key:"review",body:"Original"}),headers);
    assert.equal(created.status,201,created.body);
    const skill=JSON.parse(created.body);
    const credential=await read("/api/v1/skill-library/token","POST",undefined,headers);
    assert.equal(credential.status,200);
    const {remote,token}=JSON.parse(credential.body);
    assert.equal(new URL(remote).hostname,"127.0.0.1");
    const directory=await mkdtemp(join(tmpdir(),"managed-skills-"));
    const git=(...args)=>exec("git",args,{cwd:directory,stdio:"pipe",env:{...process.env,GIT_CONFIG_COUNT:"1",GIT_CONFIG_KEY_0:"http.extraHeader",GIT_CONFIG_VALUE_0:"Authorization: Bearer "+token}});
    try {
      await git("clone","-q",remote,".");
      assert.equal(await readFile(join(directory,"skills/review/SKILL.md"),"utf8"),"Original");
      await writeFile(join(directory,"skills/review/SKILL.md"),"Updated via Git");
      await git("-c","user.name=Fixture","-c","user.email=fixture@example.test","commit","-qam","Update skill");
      await git("push","origin","main");
      // Local Artifacts supports Git but only emits repository lifecycle and token events.
      // Exercise the same publishing path invoked by the deployed push Workflow.
      const synced=await read("/api/v1/skill-library/sync","POST",undefined,headers);
      assert.equal(synced.status,200);
      assert.equal(JSON.parse(synced.body).error,null);
      const published=JSON.parse((await read("/api/v1/skills/"+skill.id,"GET",undefined,headers)).body);
      assert.equal(published.body,"Updated via Git");
      assert.equal(published.revision,2);
    } finally {await rm(directory,{recursive:true,force:true});}
  }
  const metadata = await read("/.well-known/oauth-authorization-server"); assert.equal(metadata.status, 200); assert.equal(JSON.parse(metadata.body).issuer, appOrigin); assert.equal(JSON.parse(metadata.body).device_authorization_endpoint, `${appOrigin}/oauth/device_authorization`);
}
