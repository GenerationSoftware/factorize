import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, watch, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FACTORIZE_JOB_LAUNCHER } from "../src/factorize-job-launcher";

describe("shared factorize-job launcher", () => {
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
