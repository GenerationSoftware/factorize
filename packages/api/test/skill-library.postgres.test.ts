import { SkillContent } from "../src/skill-content";
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
      async function seedLegacy(key: string, body: string) {
        const id = crypto.randomUUID();
        await f.db.pool.query("INSERT INTO app.skills(tenant_id,id,key,encrypted_body) VALUES($1,$2,$3,$4)", [
          f.tenantId,
          id,
          key,
          await encrypt(body, f.env.CREDENTIAL_ENCRYPTION_KEY),
        ]);
        return { id };
      }
      const initial = await seedLegacy("sample", "One");
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
      const issueToken = vi.fn(async (_scope: string, _ttl: number) => token);
      let failMirror = false;
      f.env.SKILL_ARTIFACTS = {
        create: vi.fn(async () => ({ remote: "https://fixture.test/library.git", token: "fixture" })),
        get: async () => ({ createToken: issueToken }),
      } as any;
      const store = new SkillRepository(
        f.db,
        f.tenantId,
        f.env.CREDENTIAL_ENCRYPTION_KEY,
        undefined,
        new SkillContent(f.env.SKILL_ARTIFACTS),
      );
      const snapshots = new Map<string, Directory[]>();
      vi.mocked(withSkillGit).mockImplementation(async (_remote, work) =>
        work({
          head: mirrorHead,
          directories: async () => (_remote.commit ? snapshots.get(_remote.commit)! : mirrored),
          write: async (_folder: string, dirs: Directory[]) => {
            if (failMirror) throw new Error("Mirror temporarily unavailable");
            mirrored = dirs;
            mirrorHead = crypto.randomUUID();
            snapshots.set(mirrorHead, structuredClone(dirs));
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
        vi.fn(async (input: string, options?: RequestInit) => {
          const path = new URL(input).pathname;
          if (options?.method === "POST" && path.endsWith("/git/blobs"))
            return Response.json({ sha: "edited-blob" });
          if (options?.method === "POST" && path.endsWith("/git/trees"))
            return Response.json({ sha: "edited-tree" });
          if (options?.method === "POST" && path.endsWith("/git/commits"))
            return Response.json({ sha: "edited-commit" });
          if (options?.method === "PATCH" && path.endsWith("/git/refs/heads/main")) {
            commit = "edited-commit";
            body = "Committed via Factorize";
            return Response.json({ object: { sha: commit } });
          }
          if (path === "/repositories/42") return Response.json({ id: 42, full_name: "test/repo" });
          if (path.endsWith("/ref/heads/main")) return Response.json({ object: { sha: commit } });
          if (path.endsWith("/git/commits/" + commit)) return Response.json({ tree: { sha: "root" } });
          if (path.endsWith("/trees/root"))
            return Response.json({ tree: [{ path: "skills", type: "tree", sha: "dir-" + key + body }] });
          if (path.includes("/trees/dir-"))
            return Response.json({
              tree: key
                ? [
                    ...(commit === "a".repeat(40)
                      ? [
                          { path: "new-key", type: "tree" },
                          {
                            path: "new-key/SKILL.md",
                            type: "blob",
                            sha: "replacement-blob",
                            mode: "100644",
                            size: 13,
                          },
                        ]
                      : []),
                    { path: key, type: "tree" },
                    { path: key + "/SKILL.md", type: "blob", sha: "blob", mode: "100644", size: body.length },
                  ]
                : [],
            });
          if (path.endsWith("/blobs/replacement-blob"))
            return Response.json({ encoding: "base64", content: btoa("Keep this too") });
          if (path.endsWith("/blobs/blob")) return Response.json({ encoding: "base64", content: btoa(body) });
          return new Response(null, { status: 404 });
        }),
      );
      const unused = await seedLegacy("unused", "Keep this too");
      await library.migrate();
      await library.migrate();
      expect(mirrored.map((dir) => dir.key)).toContain("unused");
      expect(
        (
          await f.db.pool.query(
            "SELECT count(*)::int n FROM app.skills WHERE tenant_id=$1 AND encrypted_body IS NOT NULL",
            [f.tenantId],
          )
        ).rows[0].n,
      ).toBe(0);
      expect((await library.token()).remote).toContain("fixture.test");
      expect(issueToken).toHaveBeenLastCalledWith("write", 3600);
      const input = {
        kind: "github",
        confirmOverwrite: true,
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
      const unconfirmed = new Request(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Origin: f.env.APP_ORIGIN },
        body: JSON.stringify({ ...input, confirmOverwrite: undefined }),
      });
      expect(
        (
          await protectedApiFetch(
            unconfirmed,
            f.env,
            { ...f.auth, scopes: ["skills:write", "integrations:write"] },
            {} as ExecutionContext,
          )
        ).status,
      ).toBe(409);
      expect((await library.status()).source?.kind).toBe("managed");
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
      expect(await store.get("unused")).toBeNull();
      expect(await store.get(unused.id)).toBeNull();
      expect(await store.get("new-key")).toMatchObject({ body: "Keep this too" });
      expect((await library.token()).remote).toContain("fixture.test");
      expect(issueToken).toHaveBeenLastCalledWith("read", 3600);
      expect(installationToken).toHaveBeenCalledWith(f.env, 123, 42);
      expect(await store.get(initial.id)).toMatchObject({ body: "One", revision: 1 });
      const crypt = (value: string) => encrypt(value, f.env.CREDENTIAL_ENCRYPTION_KEY);
      const jobs = new PostgresJobRepository(
        f.db,
        f.tenantId,
        crypt,
        (value) => decrypt(value, f.env.CREDENTIAL_ENCRYPTION_KEY),
        new SkillContent(f.env.SKILL_ARTIFACTS),
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
      failMirror = true;
      await expect(
        library.edit((repository) =>
          repository.update(initial.id, { expectedRevision: 3, body: "Committed via Factorize" }),
        ),
      ).rejects.toThrow("Mirror temporarily unavailable");
      expect(commit).toBe("edited-commit");
      expect(await store.get(initial.id)).toMatchObject({ body: "Two", revision: 3 });
      failMirror = false;
      await library.sync(match);
      expect(await store.get(initial.id)).toMatchObject({ body, revision: 4 });
      // A new commit outside the skills folder does not download the directory again.
      vi.mocked(fetch).mockClear();
      commit = "unrelated-commit";
      await library.sync(match);
      expect((await library.status()).upstreamCommit).toBe(commit);
      expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("/git/blobs/"))).toBe(false);
      key = "";
      commit = "d".repeat(40);
      await library.sync(match);
      expect((await library.status()).error).toBeNull();
      expect((await library.status()).upstreamCommit).toBe(commit);
      expect(await store.get(initial.id)).toBeNull();
      expect(await store.jobs(initial.id)).toEqual([]);
      expect((await new SkillLibrary(f.env, f.otherTenant).status()).source).toEqual({ kind: "managed" });
      await library.configure({ kind: "managed" });
      const row = (
        await f.db.pool.query("SELECT repo FROM app.skill_libraries WHERE tenant_id=$1", [f.tenantId])
      ).rows[0];
      mirrorHead = "e".repeat(40);
      mirrored = [{ key: "renamed", files: [markdown("Managed push")] }];
      snapshots.set(mirrorHead, mirrored);
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
      expect(await store.get("renamed")).toMatchObject({ body: "Managed push", revision: 1 });
    } finally {
      await f.cleanup();
    }
  },
);
