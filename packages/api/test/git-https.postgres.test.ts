import { afterEach, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadingFixture } from "./helpers/loading-fixture";
import { gitHttpsFetch, issueGitCredential, skillCloneInfo } from "../src/git-https";
import { SkillLibrary } from "../src/skill-library";
import { ApiService } from "../src/api-service";
import { protectedApiFetch } from "../src/protected-api";
import { installationToken } from "../src/github";
import { GitHubRepository } from "../src/postgres/github-repository";
import type { Env } from "../src/types";
vi.mock("cloudflare:workers", () => ({ WorkflowEntrypoint: class {}, WorkerEntrypoint: class {}, DurableObject: class {} }));
vi.mock("@cloudflare/workers-oauth-provider", () => ({ OAuthProvider: class {}, AuthorizationError: class extends Error {}, getOAuthApi: vi.fn() }));
vi.mock("../src/github", async original => ({ ...(await original<typeof import("../src/github")>()), installationToken: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
const exec = promisify(execFile);
const git = (args: string[], cwd?: string) => exec("git", args, { cwd, maxBuffer: 20 * 1024 * 1024, timeout: 20_000 });

it.skipIf(!process.env.AUTH_TEST_DATABASE_URL)("clones and pushes real Git packs through HTTPS, publishes skills, and rejects expired, cross-team, revoked and mirror credentials", async () => {
  const f = await loadingFixture(process.env.AUTH_TEST_DATABASE_URL!);
  const root = await mkdtemp(join(tmpdir(), "factorize-git-https-"));
  const pending: Promise<unknown>[] = [], ctx = { waitUntil: (promise: Promise<unknown>) => { pending.push(promise); } };
  const originalFetch = globalThis.fetch;
  let server: ReturnType<typeof createServer> | undefined;
  try {
    const issued = vi.fn(async (_scope: string, _ttl: number) => ({ plaintext: "artifact-fixture", expiresAt: new Date(Date.now() + 3600_000).toISOString() }));
    f.env.SKILL_ARTIFACTS = {
      create: async (name: string) => { await git(["init", "--bare", "--initial-branch=main", join(root, name + ".git")]); await git(["--git-dir=" + join(root, name + ".git"), "config", "http.receivepack", "true"]); return { remote: `https://artifacts.test/${name}.git`, token: "artifact-fixture" }; },
      get: async () => ({ createToken: issued }),
    } as unknown as Env["SKILL_ARTIFACTS"];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, { ...init, duplex: "half" } as RequestInit), url = new URL(request.url);
      if (url.hostname !== "artifacts.test") return originalFetch(input, init);
      expect(request.headers.get("Authorization")).toBe("Bearer artifact-fixture");
      const body = request.body ? Buffer.from(await request.arrayBuffer()) : Buffer.alloc(0);
      const output = await new Promise<Buffer>((resolve, reject) => {
        const child = spawn("git", ["http-backend"], { env: { ...process.env, GIT_PROJECT_ROOT: root, GIT_HTTP_EXPORT_ALL: "1", PATH_INFO: url.pathname, QUERY_STRING: url.search.slice(1), REQUEST_METHOD: request.method, CONTENT_TYPE: request.headers.get("Content-Type") ?? "", CONTENT_LENGTH: String(body.length), HTTP_GIT_PROTOCOL: request.headers.get("Git-Protocol") ?? "", REMOTE_USER: "fixture" } });
        child.stdin.on("error", (error: NodeJS.ErrnoException) => { if (error.code !== "EPIPE") reject(error); });
        const chunks: Buffer[] = []; child.stdout.on("data", chunk => chunks.push(chunk)); child.stderr.resume(); child.on("error", reject); child.on("close", code => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error("git-http-backend failed"))); child.stdin.end(body);
      });
      const boundary = output.indexOf("\r\n\r\n"), header = output.subarray(0, boundary).toString(), headers = new Headers(); let status = 200;
      for (const line of header.split("\r\n")) { const colon = line.indexOf(":"); if (colon < 0) continue; const name = line.slice(0, colon), value = line.slice(colon + 1).trim(); if (name === "Status") status = Number(value.split(" ")[0]); else headers.set(name, value); }
      return new Response(Uint8Array.from(output.subarray(boundary + 4)).buffer, { status, headers });
    });
    await f.db.pool.query("UPDATE app.auth_users SET username='acme-team' WHERE id=$1", [f.userId]);
    await new SkillLibrary(f.env, f.tenantId).configure({ kind: "managed" });
    const service = new ApiService(f.env, { ...f.auth, scopes: [...f.auth.scopes, "skills:read", "skills:write"] });
    await service.createSkill({ key: "sample", body: "Initial instructions" });
    const clone = await skillCloneInfo(f.env, f.tenantId);
    expect(clone).toMatchObject({ url: "https://git.factorize.sh/acme-team/skills.git", writable: true });
    await f.db.pool.query("UPDATE app.auth_users SET username='renamed-team' WHERE id=$1", [f.userId]);
    expect((await skillCloneInfo(f.env, f.tenantId)).url).toBe(clone.url);
    const sessionAuth = { ...f.auth, scopes: ["skills:read", "skills:write"] };
    const response = await protectedApiFetch(new Request(f.env.APP_ORIGIN + "/api/v1/skill-library/git-token", { method: "POST", headers: { Origin: f.env.APP_ORIGIN } }), f.env, sessionAuth, {} as ExecutionContext);
    expect(response.status).toBe(200); const credential = await response.json() as { token: string; username: string };
    expect(credential.username).toBe("git");
    const stored = await f.db.pool.query("SELECT digest FROM app.skill_git_tokens WHERE tenant_id=$1", [f.tenantId]); expect(stored.rows[0].digest).not.toContain(credential.token);
    const authorization = "Basic " + Buffer.from(`git:${credential.token}`).toString("base64");
    const probe = (slug = "acme-team", token = authorization) => gitHttpsFetch(new Request(`https://git.factorize.sh/${slug}/skills.git/info/refs?service=git-upload-pack`, { headers: { Authorization: token } }), f.env, ctx);
    expect((await probe("another-team")).status).toBe(401); expect((await probe("acme-team", "")).status).toBe(401);
    server = createServer(async (req, res) => {
      try {
        const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const request = new Request("https://git.factorize.sh" + req.url, { method: req.method, headers: req.headers as Record<string, string>, body: req.method === "POST" ? Buffer.concat(chunks) : undefined });
        const result = await gitHttpsFetch(request, f.env, ctx); const resultHeaders: Record<string, string> = {}; result.headers.forEach((value, key) => { resultHeaders[key] = value; }); res.writeHead(result.status, resultHeaders); res.end(Buffer.from(await result.arrayBuffer()));
      } catch { res.statusCode = 500; res.end("Fixture failed"); }
    });
    await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number }, working = join(root, "working");
    const header = ["-c", `http.extraHeader=Authorization: ${authorization}`];
    await git([...header, "clone", `http://127.0.0.1:${address.port}/acme-team/skills.git`, working]);
    expect(await readFile(join(working, "skills/sample/SKILL.md"), "utf8")).toContain("Initial instructions");
    await writeFile(join(working, "skills/sample/SKILL.md"), "Updated through HTTPS Git\n");
    await git(["add", "."], working); await git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "Update skill"], working);
    await git([...header, "push", "origin", "main"], working); await Promise.all(pending);
    expect((await service.getSkill("sample")).body).toContain("Updated through HTTPS Git");
    expect(issued.mock.calls.some(call => call[0] === "write")).toBe(true);
    await f.db.pool.query("UPDATE app.skill_git_tokens SET expires_at=now()-interval '1 second' WHERE tenant_id=$1", [f.tenantId]); expect((await probe()).status).toBe(401);
    const renewed = await issueGitCredential(f.env, f.auth); const renewedAuth = "Basic " + Buffer.from(`git:${renewed.token}`).toString("base64");
    await f.db.pool.query("UPDATE app.members SET session_version=session_version+1 WHERE tenant_id=$1 AND user_id=$2", [f.tenantId, f.userId]); expect((await probe("acme-team", renewedAuth)).status).toBe(401);
    await f.db.pool.query("UPDATE app.skill_libraries SET source=$2 WHERE tenant_id=$1", [f.tenantId, { kind: "github", installationId: 123, repositoryId: 42, branch: "main", folder: "skills" }]);
    await expect(issueGitCredential(f.env, f.auth)).rejects.toMatchObject({ code: "github_source" });
    await f.db.pool.query("UPDATE app.members SET session_version=session_version-1 WHERE tenant_id=$1 AND user_id=$2", [f.tenantId, f.userId]); expect((await probe("acme-team", renewedAuth)).status).toBe(401);
    const denied = await protectedApiFetch(new Request(f.env.APP_ORIGIN + "/api/v1/skill-library/git-token", { method: "POST", headers: { Origin: f.env.APP_ORIGIN } }), f.env, { ...sessionAuth, authMethod: "oauth" }, {} as ExecutionContext); expect(denied.status).toBe(403);
  } finally { if (server) await new Promise<void>(resolve => server!.close(() => resolve())); await rm(root, { recursive: true, force: true }); await f.cleanup(); }
}, 90_000);

it.skipIf(!process.env.AUTH_TEST_DATABASE_URL)("shows the authoritative GitHub HTTPS URL and never returns an installation credential", async () => {
  const f = await loadingFixture(process.env.AUTH_TEST_DATABASE_URL!);
  try {
    await f.db.pool.query("INSERT INTO app.skill_libraries(tenant_id,repo,remote,source) VALUES($1,'mirror','https://artifacts.test/mirror.git',$2)", [f.tenantId, { kind: "github", installationId: 123, repositoryId: 42, branch: "develop", folder: "agent-skills" }]);
    await new GitHubRepository(f.db, f.tenantId).save({ installationId: 123, accountLogin: "acme", accountType: "Organization", state: "active" });
    vi.mocked(installationToken).mockResolvedValue("private-installation-token"); vi.stubGlobal("fetch", vi.fn(async () => Response.json({ full_name: "acme/automation" })));
    expect(await skillCloneInfo(f.env, f.tenantId)).toEqual({ source: "github", url: "https://github.com/acme/automation.git", writable: false, branch: "develop", folder: "agent-skills" });
    await f.db.pool.query("DELETE FROM app.github_installations WHERE tenant_id=$1", [f.tenantId]); await expect(skillCloneInfo(f.env, f.tenantId)).rejects.toMatchObject({ code: "github_unavailable" });
  } finally { await f.cleanup(); }
});
