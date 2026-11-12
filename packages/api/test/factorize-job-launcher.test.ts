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
});
