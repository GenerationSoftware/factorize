import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { withSkillGit } from "../src/skill-git";
import { markdown, snapshotFiles } from "../src/skill-files";
import { librarySource } from "../src/skill-library-contract";
import { API_ROUTES } from "../src/api-contract";
import { FACTORIZE_JOB_LAUNCHER } from "../src/factorize-job-launcher";

it("round trips skill directories through a real Git HTTPS-protocol backend and stages pinned bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "skills-git-"));
  const remotePath = join(root, "skills.git");
  execFileSync("git", ["init", "--bare", "-q", "-b", "main", remotePath]);
  execFileSync("git", ["-C", remotePath, "config", "http.receivepack", "true"]);
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://localhost");
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const response = execFileSync("git", ["http-backend"], {
      input: Buffer.concat(chunks),
      env: {
        ...process.env,
        GIT_PROJECT_ROOT: root,
        GIT_HTTP_EXPORT_ALL: "yes",
        PATH_INFO: url.pathname,
        QUERY_STRING: url.search.slice(1),
        REQUEST_METHOD: req.method,
        CONTENT_TYPE: req.headers["content-type"],
        HTTP_GIT_PROTOCOL: req.headers["git-protocol"] as string,
      },
    });
    const split = response.toString("latin1").indexOf("\r\n\r\n");
    for (const line of response.subarray(0, split).toString().split("\r\n")) {
      const index = line.indexOf(": ");
      res.setHeader(line.slice(0, index), line.slice(index + 2));
    }
    res.end(response.subarray(split + 4));
  });
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = "http://127.0.0.1:" + (server.address() as { port: number }).port + "/skills.git";
    const remote = { url, branch: "main", headers: {} };
    const files = [
      markdown("One"),
      { path: "scripts/count", executable: true, content: btoa("#!/bin/sh\nprintf staged") },
    ];
    const first = await withSkillGit(remote, (repo) =>
      repo.write("skills", [{ key: "example", files }], "first"),
    );
    const snapshot = snapshotFiles([{ key: "example", body: "One", version: { commit: first, files } }]);
    await withSkillGit(remote, async (repo) => {
      expect(repo.head).toBe(first);
      expect(await repo.directories("skills")).toEqual([{ key: "example", files }]);
      await repo.write("skills", [{ key: "example", files: [markdown("Two")] }], "second");
    });
    expect(
      execFileSync("git", ["-C", remotePath, "show", "main:skills/example/SKILL.md"], { encoding: "utf8" }),
    ).toBe("Two");
    expect(await withSkillGit({ ...remote, commit: first }, repo => repo.directories("skills"))).toEqual([{ key: "example", files }]);
    const launcher = FACTORIZE_JOB_LAUNCHER.replace("/home/exedev/.factorize-job", join(root, "guest"));
    const payload = {
      version: 1,
      runId: "fixture",
      prompt: "",
      skillFiles: snapshot,
      harness: {
        executable: "sh",
        args: [
          "-c",
          'cat "$FACTORIZE_SKILLS_DIR/example/SKILL.md"; "$FACTORIZE_SKILLS_DIR/example/scripts/count"',
        ],
        env: {},
      },
    };
    expect(
      execFileSync("python3", ["-c", launcher, "launch", "--foreground"], {
        input: JSON.stringify(payload),
        encoding: "utf8",
      }),
    ).toBe("Onestaged");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { force: true, recursive: true });
  }
});

it("protects skill repository operations and validates directory selection", () => {
  const routes = API_ROUTES.filter((route) => route.path.startsWith("/api/v1/skill-library"));
  expect(routes).toHaveLength(4);
  for (const route of routes)
    expect(route.scope).toBe(route.method === "GET" ? "skills:read" : "skills:write");
  expect(
    librarySource.safeParse({
      kind: "github",
      branch: "main",
      folder: "../private",
      installationId: 1,
      repositoryId: 2,
    }).success,
  ).toBe(false);
});

it("updates only the configured GitHub folder and uses a non-forced ref update anchored to the observed head", async () => {
  const { GitHubSkills } = await import("../src/skill-github");
  const { vi } = await import("vitest");
  const calls: { path: string; body: any }[] = [];
  const stub = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, options) => {
    const path = new URL(String(url)).pathname.replace("/repos/org/repo", "");
    const body = options?.body && JSON.parse(String(options.body));
    calls.push({ path, body });
    if (path === "/git/ref/heads/team/main") return Response.json({ object: { sha: "parent" } });
    if (path === "/git/commits/parent") return Response.json({ tree: { sha: "root" } });
    if (path === "/git/trees/root")
      return Response.json({ tree: [{ path: "skills", type: "tree", sha: "subtree" }], truncated: false });
    if (path === "/git/trees/subtree")
      return Response.json({
        tree: [{ path: "review/SKILL.md", type: "blob", mode: "100644", sha: "old", size: 4 }],
        truncated: false,
      });
    if (path === "/git/blobs") return Response.json({ sha: "new-blob" });
    if (path === "/git/trees") return Response.json({ sha: "new-tree" });
    if (path === "/git/commits") return Response.json({ sha: "new-head" });
    if (path === "/git/refs/heads/team/main") return new Response(null, { status: 422 });
    throw new Error("Unexpected GitHub request " + path);
  });
  try {
    const repo = new GitHubSkills("https://api.github.com/repos/org/repo", "installation-token", "team/main");
    await repo.open();
    await expect(
      repo.write("skills", [{ key: "review", files: [markdown("New")] }], "Edit skill"),
    ).rejects.toThrow("422");
    expect(calls.slice(-3)).toEqual([
      {
        path: "/git/trees",
        body: {
          base_tree: "root",
          tree: [{ path: "skills/review/SKILL.md", type: "blob", mode: "100644", sha: "new-blob" }],
        },
      },
      { path: "/git/commits", body: { tree: "new-tree", parents: ["parent"], message: "Edit skill" } },
      { path: "/git/refs/heads/team/main", body: { sha: "new-head", force: false } },
    ]);
  } finally {
    stub.mockRestore();
  }
});
