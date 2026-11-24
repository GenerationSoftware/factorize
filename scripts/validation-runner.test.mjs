import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import process from "node:process";
import { scheduleValidation } from "./validation-scheduler.mjs";
import { createEphemeralHttpServer, runProcess } from "./portable-proxy-test-helpers.mjs";

const runNode = (source, options) => runProcess(process.execPath, ["--input-type=module", "-e", source], options);

function processIsRunning(pid) {
  try {
    process.kill(pid, 0);
    if (process.platform === "linux") {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      if (stat.slice(stat.lastIndexOf(")") + 2).startsWith("Z ")) return false;
    }
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

test("subprocess exits normally and propagates its exit code", async () => {
  const result = await runNode("process.exit(0)", { timeoutMs: 2_000 });
  assert.equal(result.code, 0);
  assert.equal(result.timedOut, undefined);
});

test("deadline fails and removes a hung child and grandchild process tree", async () => {
  const source = `
    const { spawn } = await import('node:child_process');
    const grandchild = spawn(process.execPath, ['-e', "console.log('GRANDCHILD_READY ' + process.pid); setInterval(() => {}, 1000)"], { stdio: ['ignore', 'inherit', 'inherit'] });
    console.log('CHILD_READY ' + process.pid);
    setInterval(() => {}, 1000);
  `;
  const pids = {};
  const result = await runNode(source, {
    timeoutMs: 1_500,
    onOutput: (_stream, chunk) => {
      for (const line of chunk.toString().split("\n")) {
        const match = /^(CHILD_READY|GRANDCHILD_READY) (\d+)$/.exec(line.trim());
        if (match) pids[match[1]] = Number(match[2]);
      }
    },
  });

  assert.equal(result.code, 124);
  assert.equal(result.timedOut, true);
  assert.ok(pids.CHILD_READY, "child started before the deadline");
  assert.ok(pids.GRANDCHILD_READY, "grandchild started before the deadline");
  assert.equal(processIsRunning(pids.CHILD_READY), false, "child was reaped");
  assert.equal(processIsRunning(pids.GRANDCHILD_READY), false, "grandchild was reaped");
});

test("abort signal stops the process tree and reports signal failure", async () => {
  const controller = new AbortController();
  let pid;
  const result = await runNode("setInterval(() => {}, 1000)", {
    timeoutMs: 5_000,
    signal: controller.signal,
    onSpawn: (child) => {
      pid = child.pid;
      controller.abort("SIGTERM");
    },
  });
  assert.equal(result.code, 143);
  assert.equal(result.aborted, true);
  assert.equal(result.signal, "SIGTERM");
  assert.equal(processIsRunning(pid), false);
});

test("ephemeral HTTP helper binds a reachable OS-selected local port", async () => {
  const server = await createEphemeralHttpServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" }).end("ready");
  });
  try {
    assert.ok(server.port > 0);
    const response = await fetch(server.origin, { signal: AbortSignal.timeout(3_000) });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "ready");
  } finally {
    await server.close();
  }
});

test("parallel validation overlaps independent checks and waits for build consumers", async () => {
  const started = [];
  const release = new Map();
  const steps = [{ id: "build" }, { id: "browser", after: ["build"] }, { id: "api" }];
  const run = step => {
    started.push(step.id);
    return new Promise(resolve => release.set(step.id, resolve));
  };
  const done = scheduleValidation(steps, { run, concurrency: 2, signal: new AbortController().signal });
  assert.deepEqual(started, ["build", "api"]);
  release.get("build")(0);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, ["build", "api", "browser"]);
  release.get("browser")(0);
  release.get("api")(0);
  assert.deepEqual((await done).map(result => result.status), ["passed", "passed", "passed"]);
});

test("validation blocks failed prerequisites and still reports independent checks", async () => {
  const steps = [{ id: "browser", after: ["build"] }, { id: "build" }, { id: "api" }];
  const started = [];
  const results = await scheduleValidation(steps, {
    concurrency: 2,
    signal: new AbortController().signal,
    async run(step) {
      started.push(step.id);
      return step.id === "build" ? 1 : 0;
    },
  });
  assert.deepEqual(started, ["build", "api"]);
  assert.deepEqual(results.map(result => result.status), ["not run", "failed", "passed"]);
});
