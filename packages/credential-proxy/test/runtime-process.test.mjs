import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";

const entry = fileURLToPath(new URL("../src/main.mjs", import.meta.url));
const keyMarker = "synthetic-unlock-key-marker";
const tokenMarker = "synthetic-upstream-token-marker";

async function waitFor(predicate, label) {
  const deadline = Date.now() + 3_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`deadline exceeded: ${label}`);
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function startProxy(directory) {
  const child = spawn(process.execPath, [entry], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, FACTORIZE_PROXY_BOOTSTRAP_SOCKET: join(directory, "bootstrap.sock") } });
  let pending = "";
  let log = "";
  let stderr = "";
  const messages = [];
  child.stdout.setEncoding("utf8").on("data", (chunk) => {
    log += chunk;
    pending += chunk;
    for (;;) {
      const end = pending.indexOf("\n");
      if (end < 0) break;
      const line = pending.slice(0, end);
      pending = pending.slice(end + 1);
      try { messages.push(JSON.parse(line)); } catch { messages.push({ malformed: line }); }
    }
  });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  await waitFor(() => messages.length > 0, "proxy startup");
  const ready = messages.shift();
  assert.equal(ready.type, "ready");
  assert.equal(ready.state, "locked");
  assert.match(ready.bootEpoch, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  return {
    child,
    bootEpoch: ready.bootEpoch,
    get logs() { return `${log}${stderr}`; },
    command(command) {
      child.stdin.write(`${JSON.stringify(command)}\n`);
      return waitFor(() => messages.length > 0, `response to ${command.type}`).then(() => messages.shift());
    },
  };
}

test("process starts locked, unlocks in memory, shuts down bounded, and restarts locked", async () => {
  const directory = await mkdtemp(join(tmpdir(), "credential-proxy-"));
  const processes = [];
  try {
    await writeFile(join(directory, "identity.json"), JSON.stringify({ identity: "public-fixture", generation: 1 }));
    await writeFile(join(directory, "public-metadata.json"), JSON.stringify({ displayName: "fixture" }));
    const first = await startProxy(directory);
    processes.push(first);
    await new Promise(resolve => setTimeout(resolve, 2_200));
    assert.equal(first.child.exitCode, null, "startup must not arm the shutdown deadline");
    assert.deepEqual(await first.command({ type: "status" }), { type: "status", state: "locked", proxyControlRegistered: false });
    assert.deepEqual(await first.command({ type: "unlock", key: keyMarker }), { type: "status", state: "unlocked", proxyControlRegistered: false });
    first.child.kill("SIGTERM");
    await waitFor(() => first.child.exitCode !== null || first.child.signalCode !== null, "first process stop");
    assert.equal(first.child.exitCode, 0);

    const restarted = await startProxy(directory);
    processes.push(restarted);
    assert.notEqual(restarted.bootEpoch, first.bootEpoch, "every process restart gets a fresh enrollment epoch");
    assert.deepEqual(await restarted.command({ type: "status" }), { type: "status", state: "locked", proxyControlRegistered: false });
    assert.deepEqual(await restarted.command({ type: "unlock", key: tokenMarker }), { type: "status", state: "unlocked", proxyControlRegistered: false });
    restarted.child.stdin.write('{"type":"stop"}\n');
    await waitFor(() => restarted.child.exitCode !== null || restarted.child.signalCode !== null, "command shutdown");
    assert.equal(restarted.child.exitCode, 0);

    const crashed = await startProxy(directory);
    processes.push(crashed);
    assert.deepEqual(await crashed.command({ type: "unlock", key: keyMarker }), { type: "status", state: "unlocked", proxyControlRegistered: false });
    crashed.child.kill("SIGKILL");
    await waitFor(() => crashed.child.exitCode !== null || crashed.child.signalCode !== null, "crash stop");
    assert.equal(crashed.child.signalCode, "SIGKILL");

    const afterCrash = await startProxy(directory);
    processes.push(afterCrash);
    assert.deepEqual(await afterCrash.command({ type: "status" }), { type: "status", state: "locked", proxyControlRegistered: false });
    afterCrash.child.kill("SIGTERM");
    await waitFor(() => afterCrash.child.exitCode !== null || afterCrash.child.signalCode !== null, "post-crash shutdown");
    assert.equal(afterCrash.child.exitCode, 0);

    const persisted = await Promise.all((await readdir(directory)).map((name) => readFile(join(directory, name), "utf8")));
    for (const content of [...persisted, ...processes.map((process) => process.logs)]) {
      assert.equal(content.includes(keyMarker), false, "unlock key was persisted or logged");
      assert.equal(content.includes(tokenMarker), false, "token marker was persisted or logged");
    }
  } finally {
    for (const process of processes) {
      if (process.child.exitCode === null && process.child.signalCode === null) {
        process.child.kill("SIGKILL");
        await once(process.child, "exit");
      }
    }
    await rm(directory, { recursive: true, force: true });
  }
});
