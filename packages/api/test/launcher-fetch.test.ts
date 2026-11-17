import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FACTORIZE_JOB_LAUNCHER } from "../src/factorize-job-launcher";
import { RUN_IDENTITY_GUEST_HELPER } from "../src/run-identity-guest-helper";

const runId = "11111111-1111-4111-8111-111111111111";
async function fixture(server: Server) {
  const directory = await mkdtemp(join(tmpdir(), "factorize-fetch-"));
  const root = join(directory, "job"), launcher = join(directory, "launcher.py");
  await mkdir(root, {mode: 0o700});
  await writeFile(launcher, FACTORIZE_JOB_LAUNCHER.replace("/home/exedev/.factorize-job", root));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const proxy = `http://127.0.0.1:${(server.address() as {port: number}).port}`;
  return {
    root,
    run: () => new Promise<{error: Error | null; stdout: string; stderr: string}>(resolve => {
      const child = execFile("python3", [launcher, "launch", "--foreground", "--fetch-payload", runId], {
        timeout: 8_000, env: {...process.env, FACTORIZE_PROXY_URL: proxy, HTTP_PROXY: "http://invalid-proxy:1", http_proxy: "http://invalid-proxy:1", NO_PROXY: "", no_proxy: ""},
      }, (error, stdout, stderr) => resolve({error, stdout, stderr}));
      child.stdin!.end();
    }),
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      await rm(directory, {recursive: true, force: true});
    },
  };
}

describe("VM launch payload retrieval", () => {
  it.each(["agent", "code"] as const)("fetches a large %s payload through the vendor identity helper and retries temporary failures", async kind => {
    const helper = await import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(RUN_IDENTITY_GUEST_HELPER).toString("base64")}`);
    const prompt = "Fetched UTF-8 prompt: 🦊\n".repeat(10_000);
    const payload = {version: 1, runId, ...(kind === "agent"
      ? {prompt, harness: {executable: "python3", args: ["-c", "import sys; print(len(sys.stdin.buffer.read()))"], env: {}}}
      : {code: {script: "python3 -c 'import os,json; print(len(json.load(open(os.environ[\"FACTORIZE_INPUT_PATH\"]))[\"prompt\"].encode()))'", context: {prompt}}})};
    let tokens = 0, attempts = 0;
    const server = helper.createRunIdentityProxy({runId, backendOrigin: "https://factorize.test", provider: "exe.dev", integrationName: "fixture"}, {
      getToken: async () => `header.claims.signature${++tokens}`,
      fetcher: async (url: string, init: RequestInit) => {
        expect(url).toBe("https://factorize.test/api/v1/runtime-launch");
        expect((init.headers as Headers).get("X-Factorize-Run-Id")).toBe(runId);
        expect((init.headers as Headers).get("Authorization")).toBe(`Bearer header.claims.signature${tokens}`);
        return ++attempts === 1 ? new Response("temporary", {status: 503}) : Response.json(payload);
      },
    });
    const f = await fixture(server);
    try {
      const result = await f.run();
      expect(result.stderr).toBe("");
      expect(result.error).toBeNull();
      expect(result.stdout.trim()).toBe(String(Buffer.byteLength(prompt)));
      expect(tokens).toBe(2);
      expect(JSON.parse(await readFile(join(f.root, "process.json"), "utf8"))).toEqual({state: "exited", exitCode: 0});
      if (kind === "agent") expect(await readFile(join(f.root, "prompt.txt"), "utf8")).toBe(prompt);
    } finally { await f.close(); }
  });

  it.each(["denied", "redirect", "wrong-run", "malformed", "oversize", "unavailable"])("does not launch the harness for a %s response", async mode => {
    let requests = 0;
    const server = createServer((_request, response) => {
      requests++;
      if (mode === "denied") response.writeHead(403).end("private-backend-error");
      else if (mode === "redirect") response.writeHead(302, {Location: "/unexpected"}).end();
      else if (mode === "unavailable") response.writeHead(503).end("private-backend-error");
      else if (mode === "oversize") response.end(" ".repeat(32 * 1024 * 1024 + 1));
      else if (mode === "malformed") response.end("{}");
      else response.end(JSON.stringify({version: 1, runId: "other-run", prompt: "secret prompt", harness: {executable: "touch", args: ["should-not-run"], env: {}}}));
    });
    const f = await fixture(server);
    try {
      const result = await f.run();
      expect(result.error).not.toBeNull();
      expect(result.stderr).toContain("factorize-job:");
      expect(result.stderr).not.toMatch(/private-backend-error|secret prompt/);
      expect(requests).toBe(mode === "unavailable" ? 3 : 1);
      expect(JSON.parse(await readFile(join(f.root, "process.json"), "utf8"))).toMatchObject({state: "exited", exitCode: 1});
      await expect(readFile(join(f.root, "prompt.txt"))).rejects.toThrow();
    } finally { await f.close(); }
  });
});
