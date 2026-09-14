import { chmod, mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { describe, expect, it } from "vitest";
import { launchAgentCommand, type ExeConnection } from "../src/exe";

const runFile = promisify(execFile);
const fixture = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/fake-herdr.sh");
const jsonLines = (output: string) => output.trim().split("\n").map(line => JSON.parse(line));

describe("agent launch and prompt delivery", () => {
  it("delivers the exact prompt as part of the fake agent launch", async () => {
    const root = await mkdtemp(`${tmpdir()}/factorize-agent-e2e-`);
    try {
      const repository = resolve(root, "repo");
      const runPath = resolve(repository, ".factorize-runs/run-e2e");
      const stateDir = resolve(root, "fake-herdr-state");
      const promptDirectory = "/tmp/factorize-prompts/run-e2e";
      await mkdir(repository, { recursive: true });
      await chmod(fixture, 0o755);

      const connection: ExeConnection = {
        vmName: "unused",
        apiToken: "unused",
        agentKind: "codex",
        cwd: repository,
        herdrCommand: fixture,
      };
      const environment = {
        ...process.env,
        FAKE_HERDR_STATE_DIR: stateDir,
        FAKE_HERDR_RUN_PATH: runPath,
      };

      const prompt = "Fix the launch race.\n\nConfirm readiness before starting.";
      const launched = await runFile("bash", ["-c", launchAgentCommand("run-e2e", connection, "flow-e2e", runPath, "lease-e2e", prompt)], { env: environment });
      expect(jsonLines(launched.stdout).at(-1)?.result.agent).toMatchObject({ name: "run-e2e", agent_status: "working", interactive_ready: true });
      await expect(readFile(resolve(promptDirectory, "prompt.md"), "utf8")).resolves.toBe(prompt);
      await expect(readFile(resolve(stateDir, "launch-instruction"), "utf8")).resolves.toBe(`Read and follow the complete task instructions in ${promptDirectory}/prompt.md`);
      await expect(readFile(resolve(stateDir, "status"), "utf8")).resolves.toBe("working");
      await expect(readFile(resolve(stateDir, "events"), "utf8")).resolves.toBe("workspace list\nworkspace create\ntab rename\nagent get\nagent start\nagent get\n");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm("/tmp/factorize-prompts/run-e2e", { recursive: true, force: true });
    }
  });
});
