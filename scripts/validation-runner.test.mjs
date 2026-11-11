import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import process from "node:process";
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
