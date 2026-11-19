import { createHmac } from "node:crypto";
import { encrypt, decrypt } from "../src/crypto";
import { PostgresJobRepository } from "../src/postgres/job-repository";
import { InvocationService } from "../src/job-domain";
import { SkillPushWorkflow } from "../src/cloudflare-entry";
import app from "../src/index";
import { afterEach, expect, it, vi } from "vitest";
import { loadingFixture } from "./helpers/loading-fixture";
import { SkillLibrary } from "../src/skill-library";
import { SkillRepository } from "../src/postgres/skill-repository";
import { markdown, type Directory } from "../src/skill-files";
import { withSkillGit } from "../src/skill-git";
import { GitHubRepository } from "../src/postgres/github-repository";
import { installationToken } from "../src/github";
import { protectedApiFetch } from "../src/protected-api";

vi.mock("cloudflare:workers", () => ({
  WorkflowEntrypoint: class {},
  WorkerEntrypoint: class {},
  DurableObject: class {},
}));
vi.mock("@cloudflare/workers-oauth-provider", () => ({
  OAuthProvider: class {},
  AuthorizationError: class extends Error {},
  getOAuthApi: vi.fn(),
}));
vi.mock("../src/skill-git", () => ({ withSkillGit: vi.fn() }));
vi.mock("../src/github", async (original) => ({
  ...(await original<typeof import("../src/github")>()),
  installationToken: vi.fn(),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it.skipIf(!process.env.AUTH_TEST_DATABASE_URL)(
  "publishes GitHub pushes to an Artifacts mirror and preserves referenced IDs and accepted revisions",
  async () => {
    const f = await loadingFixture(process.env.AUTH_TEST_DATABASE_URL!);
    try {
      const store = new SkillRepository(f.db, f.tenantId, f.env.CREDENTIAL_ENCRYPTION_KEY);
      const initial = await store.create("sample", "One");
      await f.db.pool.query(
        "INSERT INTO app.job_skills(tenant_id,job_id,skill_id,position) VALUES($1,$2,$3,0)",
        [f.tenantId, f.jobIds[3], initial.id],
      );
      const library = new SkillLibrary(f.env, f.tenantId);
      let commit = "a".repeat(40),
        key = "sample",
        body = "One";
      let mirrorHead: string | null = null,
        mirrored: Directory[] = [];
      const token = { plaintext: "fixture", expiresAt: "2026-11-20T00:00:00Z" };
      f.env.SKILL_ARTIFACTS = {
        create: vi.fn(async () => ({ remote: "https://fixture.test/library.git", token: "fixture" })),
        get: async () => ({ createToken: async () => token }),
      } as any;
      vi.mocked(withSkillGit).mockImplementation(async (_remote, work) =>
        work({
          head: mirrorHead,
          directories: async () => mirrored,
          write: async (_folder: string, dirs: Directory[]) => {
            mirrored = dirs;
            mirrorHead = crypto.randomUUID();
            return mirrorHead;
          },
        } as any),
      );
      await new GitHubRepository(f.db, f.tenantId).save({
        installationId: 123,
        accountLogin: "org",
        accountType: "Organization",
        state: "active",
      });
      vi.mocked(installationToken).mockResolvedValue("github-fixture");
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string) => {
          const path = new URL(input).pathname;
          if (path === "/repositories/42") return Response.json({ id: 42, full_name: "test/repo" });
          if (path.endsWith("/ref/heads/main")) return Response.json({ object: { sha: commit } });
          if (path.endsWith("/git/commits/" + commit)) return Response.json({ tree: { sha: "root" } });
          if (path.endsWith("/trees/root"))
            return Response.json({ tree: [{ path: "skills", type: "tree", sha: "skills-dir" }] });
          if (path.endsWith("/trees/skills-dir"))
            return Response.json({
              tree: key
                ? [
                    { path: key, type: "tree" },
                    { path: key + "/SKILL.md", type: "blob", sha: "blob", mode: "100644", size: body.length },
                  ]
                : [],
            });
          if (path.endsWith("/blobs/blob")) return Response.json({ encoding: "base64", content: btoa(body) });
          return new Response(null, { status: 404 });
        }),
      );
      const input = {
        kind: "github",
        installationId: 123,
        repositoryId: 42,
        branch: "main",
        folder: "skills",
      } as const;
      const url = f.env.APP_ORIGIN + "/api/v1/skill-library";
      const request = () =>
        new Request(url, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Origin: f.env.APP_ORIGIN },
          body: JSON.stringify(input),
        });
      expect(
        (
          await protectedApiFetch(
            request(),
            f.env,
            { ...f.auth, scopes: ["skills:write"] },
            {} as ExecutionContext,
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await protectedApiFetch(
            request(),
            f.env,
            { ...f.auth, scopes: ["skills:write", "integrations:write"] },
            {} as ExecutionContext,
          )
        ).status,
      ).toBe(200);
      expect(installationToken).toHaveBeenCalledWith(f.env, 123, 42);
      expect(await store.get(initial.id)).toMatchObject({ body: "One", revision: 1 });
      const crypt = (value: string) => encrypt(value, f.env.CREDENTIAL_ENCRYPTION_KEY);
      const jobs = new PostgresJobRepository(f.db, f.tenantId, crypt, (value) =>
        decrypt(value, f.env.CREDENTIAL_ENCRYPTION_KEY),
      );
      const selected = await jobs.getJob(f.jobIds[3]);
      const queued = await new InvocationService(jobs, crypt).invoke(f.jobIds[3], {
        source: "manual",
        claimKey: "snapshot",
        triggerId: selected!.triggers[0].id,
        context: {},
      });
      const pinned = mirrorHead;
      const match = { installationId: 123, repositoryId: 42, ref: "refs/heads/main" };
      body = "Two";
      commit = "b".repeat(40);
      await library.sync({ ...match, repositoryId: 43 });
      expect((await library.status()).upstreamCommit).not.toBe(commit);
      const raw = JSON.stringify({
        installation: { id: 123 },
        repository: { id: 42 },
        ref: match.ref,
        after: commit,
      });
      f.env.GITHUB_WEBHOOK_SECRET = "fixture-secret";
      const sign = createHmac("sha256", f.env.GITHUB_WEBHOOK_SECRET).update(raw).digest("hex");
      const delivery = (signature: string) =>
        app.fetch(
          new Request(f.env.APP_ORIGIN + "/webhooks/github", {
            method: "POST",
            body: raw,
            headers: {
              "X-Hub-Signature-256": "sha256=" + signature,
              "X-GitHub-Event": "push",
              "X-GitHub-Delivery": "fixture-delivery",
            },
          }),
          f.env,
        );
      expect((await delivery("invalid")).status).toBe(401);
      expect((await library.status()).upstreamCommit).not.toBe(commit);
      expect((await delivery(sign)).status).toBe(202);
      await library.sync(match);
      expect(await store.get(initial.id)).toMatchObject({
        body: "Two",
        revision: 2,
        version: { commit: mirrorHead },
      });
      expect(mirrored[0].files).toEqual([markdown("Two")]);
      const saved = (
        await f.db.pool.query(
          "SELECT encrypted_skill_snapshot FROM app.job_runs WHERE tenant_id=$1 AND id=$2",
          [f.tenantId, queued.run.id],
        )
      ).rows[0];
      expect(
        JSON.parse(await decrypt(saved.encrypted_skill_snapshot, f.env.CREDENTIAL_ENCRYPTION_KEY))[0].version,
      ).toEqual({ commit: pinned, files: [markdown("One")] });
      key = "renamed";
      commit = "c".repeat(40);
      await library.sync(match);
      expect(await store.get(initial.id)).toMatchObject({ key: "renamed", revision: 3 });
      key = "";
      commit = "d".repeat(40);
      await library.sync(match);
      expect((await library.status()).error).toContain("referenced");
      expect((await library.status()).upstreamCommit).toBe("c".repeat(40));
      expect(await store.get(initial.id)).toMatchObject({ body: "Two", revision: 3 });
      expect((await new SkillLibrary(f.env, f.otherTenant).status()).source).toBeNull();
      await library.configure({ kind: "managed" });
      const row = (
        await f.db.pool.query("SELECT repo FROM app.skill_libraries WHERE tenant_id=$1", [f.tenantId])
      ).rows[0];
      mirrorHead = "e".repeat(40);
      mirrored = [{ key: "renamed", files: [markdown("Managed push")] }];
      const workflow = Object.assign(Object.create(SkillPushWorkflow.prototype), { env: f.env });
      await workflow.run(
        {
          payload: {
            source: { namespace: "factorize-skills", repoName: row.repo },
            payload: { ref: "refs/heads/main" },
          },
        },
        { do: (_label: string, run: () => Promise<void>) => run() },
      );
      expect(await store.get(initial.id)).toMatchObject({ body: "Managed push", revision: 4 });
    } finally {
      await f.cleanup();
    }
  },
);
