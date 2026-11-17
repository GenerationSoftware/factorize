import { execFile, execFileSync } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { connect } from "node:net";
import { mkdir, mkdtemp, readFile, rm, watch, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FACTORIZE_JOB_LAUNCHER } from "../src/factorize-job-launcher";

describe("shared factorize-job launcher", () => {
  it.each(["agent", "code"] as const)("preserves native HTTPS proxy routing for %s jobs alongside the Factorize helper", async kind => {
    const directory = await mkdtemp(join(tmpdir(), "factorize-launcher-network-"));
    const root = join(directory, "job"), helper = join(directory, "factorize-job"), agent = join(directory, "network-agent.py");
    const key = join(directory, "key.pem"), cert = join(directory, "cert.pem");
    const tunnels: string[] = [];
    let helperRequests = 0;
    const origin = createHttpsServer();
    const nativeProxy = createHttpServer();
    const identityHelper = createHttpServer((_request, response) => { helperRequests++; response.writeHead(404).end(); });
    identityHelper.on("connect", (_request, socket) => { helperRequests++; socket.end("HTTP/1.1 405 Method Not Allowed\r\n\r\n"); });
    try {
      await mkdir(root, { mode: 0o700 });
      execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes", "-keyout", key, "-out", cert, "-days", "1", "-subj", "/CN=models.fixture"], { stdio: "ignore" });
      origin.setSecureContext({ key: await readFile(key), cert: await readFile(cert) });
      origin.on("request", (_request, response) => response.end("model-network-ok"));
      await new Promise<void>(resolve => origin.listen(0, "127.0.0.1", resolve));
      const originPort = (origin.address() as { port: number }).port;
      nativeProxy.on("connect", (request, client, head) => {
        tunnels.push(request.url!);
        const upstream = connect(originPort, "127.0.0.1", () => {
          client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          if (head.length) upstream.write(head);
          client.pipe(upstream); upstream.pipe(client);
        });
        client.on("error", () => upstream.destroy());
        client.on("close", () => upstream.destroy());
        upstream.on("error", () => client.destroy());
      });
      await new Promise<void>(resolve => nativeProxy.listen(0, "127.0.0.1", resolve));
      await new Promise<void>(resolve => identityHelper.listen(0, "127.0.0.1", resolve));
      const proxy = `http://127.0.0.1:${(nativeProxy.address() as { port: number }).port}`;
      const factorize = `http://127.0.0.1:${(identityHelper.address() as { port: number }).port}`;
      const proxyNames = ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"];
      await writeFile(helper, FACTORIZE_JOB_LAUNCHER.replace("/home/exedev/.factorize-job", root));
      await writeFile(agent, `import json, os, ssl, urllib.request\ncontext = ssl.create_default_context(cafile=${JSON.stringify(cert)})\nbody = urllib.request.urlopen('https://models.fixture/check', context=context, timeout=3).read().decode()\nprint(json.dumps({'body': body, 'factorize': os.environ['FACTORIZE_PROXY_URL'], 'proxies': {name: os.environ[name] for name in ${JSON.stringify(proxyNames)}}}))\n`);
      const payload = { version: 1, runId: "network-fixture", ...(kind === "agent"
        ? { harness: { executable: "python3", args: [agent], env: {} }, prompt: "verify networking" }
        : { code: { script: `python3 '${agent}'`, context: {} } }) };
      const stdout = await new Promise<string>((resolve, reject) => {
        const child = execFile("python3", [helper, "launch", "--foreground"], {
          timeout: 5_000,
          env: { ...process.env, ...Object.fromEntries(proxyNames.map(name => [name, proxy])), NO_PROXY: "", no_proxy: "", FACTORIZE_PROXY_URL: factorize },
        }, (error, stdout) => error ? reject(error) : resolve(stdout));
        child.stdin!.end(JSON.stringify(payload));
      });
      expect(JSON.parse(stdout)).toEqual({ body: "model-network-ok", factorize, proxies: Object.fromEntries(proxyNames.map(name => [name, proxy])) });
      expect(tunnels).toEqual(["models.fixture:443"]);
      expect(helperRequests).toBe(0);
    } finally {
      for (const server of [origin, nativeProxy, identityHelper]) await new Promise<void>(resolve => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("runs code jobs asynchronously and records process completion and output", async () => {
    const directory = await mkdtemp(join(tmpdir(), "factorize-job-launcher-"));
    const root = join(directory, "job"), log = join(directory, "factorize.log"), helper = join(directory, "factorize-job");
    const source = FACTORIZE_JOB_LAUNCHER.replace("/home/exedev/.factorize-job", root).replace("/tmp/factorize.log", log).replace("/tmp/factorize.stderr", join(directory, "factorize.stderr"));
    try {
      await writeFile(helper, source, { mode: 0o700 });
      await mkdir(root, { mode: 0o700 });
      const events = watch(root, { persistent: false });
      const completion = (async () => {
        const deadline = Date.now() + 5_000;
        for await (const _event of events) {
          try {
            const state = JSON.parse(await readFile(join(root, "process.json"), "utf8"));
            if (state.state === "exited") return state;
          } catch { /* The launcher writes process state by atomic rename. */ }
          if (Date.now() > deadline) throw new Error("factorize-job did not record completion before the test deadline");
        }
        throw new Error("factorize-job state watcher closed before completion");
      })();
      const payload = JSON.stringify({ version: 1, runId: "test-run", code: { script: "printf '%s' '{\"status\":\"succeeded\"}' > \"$FACTORIZE_RESULT_PATH\"; printf 'launcher-ok\\n'", context: { fixture: true } } });
      expect(execFileSync("python3", [helper, "launch"], { input: payload, encoding: "utf8" }).trim()).toBe("started");
      await expect(completion).resolves.toEqual({ state: "exited", exitCode: 0 });
      expect(await readFile(log, "utf8")).toContain("launcher-ok");
      expect(JSON.parse(await readFile(join(root, "results.json"), "utf8"))).toEqual({ status: "succeeded" });
      expect(JSON.parse(execFileSync("python3", [helper, "status"], { encoding: "utf8" }))).toEqual({ state: "exited", exitCode: 0 });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("preserves a failed code process exit state, structured result, and output", async () => {
    const directory = await mkdtemp(join(tmpdir(), "factorize-job-launcher-failure-"));
    const root = join(directory, "job"), log = join(directory, "factorize.log"), helper = join(directory, "factorize-job");
    const source = FACTORIZE_JOB_LAUNCHER.replace("/home/exedev/.factorize-job", root).replace("/tmp/factorize.log", log).replace("/tmp/factorize.stderr", join(directory, "factorize.stderr"));
    try {
      await writeFile(helper, source, { mode: 0o700 });
      await mkdir(root, { mode: 0o700 });
      const events = watch(root, { persistent: false });
      const completion = (async () => {
        const deadline = Date.now() + 5_000;
        for await (const _event of events) {
          try {
            const state = JSON.parse(await readFile(join(root, "process.json"), "utf8"));
            if (state.state === "exited") return state;
          } catch { /* The launcher writes process state by atomic rename. */ }
          if (Date.now() > deadline) throw new Error("factorize-job did not record failure before the test deadline");
        }
        throw new Error("factorize-job state watcher closed before failure was recorded");
      })();
      const payload = JSON.stringify({
        version: 1,
        runId: "failed-code-run",
        code: { script: "printf '%s' '{\"status\":\"failed\",\"reason\":\"fixture failure\"}' > \"$FACTORIZE_RESULT_PATH\"; printf 'failure-output\\n'; exit 7", context: {} },
      });

      expect(execFileSync("python3", [helper, "launch"], { input: payload, encoding: "utf8" }).trim()).toBe("started");
      await expect(completion).resolves.toEqual({ state: "exited", exitCode: 7 });
      expect(await readFile(log, "utf8")).toContain("failure-output");
      expect(JSON.parse(await readFile(join(root, "results.json"), "utf8"))).toEqual({ status: "failed", reason: "fixture failure" });
      expect(JSON.parse(execFileSync("python3", [helper, "status"], { encoding: "utf8" }))).toEqual({ state: "exited", exitCode: 7 });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("runs an agent harness with its prompt and environment and records its result", async () => {
    const directory = await mkdtemp(join(tmpdir(), "factorize-agent-launcher-"));
    const root = join(directory, "job"), log = join(directory, "factorize.log"), helper = join(directory, "factorize-job");
    const agent = join(directory, "fake-agent.py");
    const source = FACTORIZE_JOB_LAUNCHER.replace("/home/exedev/.factorize-job", root).replace("/tmp/factorize.log", log).replace("/tmp/factorize.stderr", join(directory, "factorize.stderr"));
    try {
      await writeFile(helper, source, { mode: 0o700 });
      await writeFile(agent, "#!/usr/bin/env python3\nimport json, os, pathlib, sys\nprompt = sys.stdin.read()\nresult = {\"status\": \"succeeded\", \"prompt\": prompt, \"account\": os.environ.get(\"FACTORIZE_FIXTURE_ACCOUNT\")}\npathlib.Path(os.environ[\"FACTORIZE_RESULT_PATH\"]).write_text(json.dumps(result))\nprint(\"agent-harness-ok\")\n", { mode: 0o700 });
      await mkdir(root, { mode: 0o700 });
      const events = watch(root, { persistent: false });
      const completion = (async () => {
        const deadline = Date.now() + 5_000;
        for await (const _event of events) {
          try {
            const state = JSON.parse(await readFile(join(root, "process.json"), "utf8"));
            if (state.state === "exited") return state;
          } catch { /* The launcher writes process state by atomic rename. */ }
          if (Date.now() > deadline) throw new Error("factorize-job did not record agent completion before the test deadline");
        }
        throw new Error("factorize-job state watcher closed before agent completion");
      })();
      const payload = JSON.stringify({
        version: 1,
        runId: "agent-fixture-run",
        prompt: "summarize the fixture",
        harness: { executable: agent, args: ["--fixture"], env: { FACTORIZE_FIXTURE_ACCOUNT: "account-a" } },
      });

      expect(execFileSync("python3", [helper, "launch"], { input: payload, encoding: "utf8" }).trim()).toBe("started");
      await expect(completion).resolves.toEqual({ state: "exited", exitCode: 0 });
      expect(await readFile(log, "utf8")).toContain("agent-harness-ok");
      expect(JSON.parse(await readFile(join(root, "results.json"), "utf8"))).toEqual({
        status: "succeeded", prompt: "summarize the fixture", account: "account-a",
      });
      expect(JSON.parse(execFileSync("python3", [helper, "status"], { encoding: "utf8" }))).toEqual({ state: "exited", exitCode: 0 });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("allows a custom image entrypoint to finish setup before execing the shared launcher", async () => {
    const directory = await mkdtemp(join(tmpdir(), "factorize-custom-image-launcher-"));
    const root = join(directory, "job"), log = join(directory, "factorize.log"), helper = join(directory, "factorize-job");
    const setup = join(directory, "image-setup.complete");
    const source = FACTORIZE_JOB_LAUNCHER.replace("/home/exedev/.factorize-job", root).replace("/tmp/factorize.log", log).replace("/tmp/factorize.stderr", join(directory, "factorize.stderr"));
    try {
      await writeFile(helper, source, { mode: 0o700 });
      await mkdir(root, { mode: 0o700 });
      const entrypoint = `printf '%s' ready > '${setup}'; exec python3 '${helper}' launch --foreground`;
      const payload = JSON.stringify({
        version: 1,
        runId: "custom-image-run",
        code: { script: "printf '%s' '{\"status\":\"succeeded\"}' > \"$FACTORIZE_RESULT_PATH\"; printf 'custom-image-ok\\n'", context: {} },
      });

      expect(execFileSync("sh", ["-c", entrypoint], { input: payload, encoding: "utf8" }).trim()).toBe("custom-image-ok");
      expect(await readFile(setup, "utf8")).toBe("ready");
      expect(JSON.parse(await readFile(join(root, "results.json"), "utf8"))).toEqual({ status: "succeeded" });
      expect(JSON.parse(await readFile(join(root, "process.json"), "utf8"))).toEqual({ state: "exited", exitCode: 0 });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
