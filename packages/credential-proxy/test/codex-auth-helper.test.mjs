import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCodexAuthHelper, CODEX_AUTH_HELPER_VERSION } from "../src/codex-auth-helper.mjs";

const accountA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const accountB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function fakeCodex() {
  const calls = [], children = [];
  const spawnProcess = (command, args, options) => {
    calls.push({ command, args, options });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.kill = signal => {
      child.killed = signal;
      queueMicrotask(() => child.emit("close", null, signal));
      return true;
    };
    children.push(child);
    if (args[0] !== "login" || args[1] !== "--device-auth") {
      queueMicrotask(() => {
        child.stdout.end(args[0] === "--version" ? `${CODEX_AUTH_HELPER_VERSION}\n` : "authenticated\n");
        child.stderr.end();
        child.emit("close", 0, null);
      });
    }
    return child;
  };
  return { calls, children, spawnProcess };
}

test("Codex auth helper constrains commands and isolates account credential homes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "factorize-codex-auth-"));
  try {
    const fake = fakeCodex();
    const helper = createCodexAuthHelper({ codexPath: "/opt/codex", accountHomeRoot: directory, spawnProcess: fake.spawnProcess });
    assert.deepEqual(await helper.invoke({ method: "account-status", accountId: accountA }), { state: "authenticated" });
    assert.deepEqual(await helper.invoke({ method: "refresh", accountId: accountB }), { state: "refreshed" });
    assert.deepEqual(fake.calls.map(call => call.args), [
      ["--version"], ["login", "status"], ["--version"], ["login", "status"],
    ]);
    assert.ok(fake.calls.every(call => call.command === "/opt/codex"));
    assert.equal(fake.calls[0].options.env.CODEX_HOME, join(directory, accountA));
    assert.equal(fake.calls[3].options.env.CODEX_HOME, join(directory, accountB));
    assert.equal(fake.calls[0].options.env.HOME, join(directory, accountA));
    assert.equal("OPENAI_API_KEY" in fake.calls[0].options.env, false);
    await assert.rejects(helper.invoke({ method: "exec", accountId: accountA, args: ["--dangerously-bypass-approvals-and-sandbox"] }), /unsupported Codex authentication operation/);
    await assert.rejects(helper.invoke({ method: "logout", accountId: "../../outside" }), /invalid model account id/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("device authorization runs as a separate cancellable login process", async () => {
  const directory = await mkdtemp(join(tmpdir(), "factorize-codex-auth-"));
  try {
    const fake = fakeCodex();
    const helper = createCodexAuthHelper({ accountHomeRoot: directory, spawnProcess: fake.spawnProcess });
    const result = await helper.invoke({ method: "device-login", accountId: accountA });
    assert.equal(result.state, "pending");
    assert.deepEqual(fake.calls.map(call => call.args), [["--version"], ["login", "--device-auth"]]);
    assert.equal(fake.calls[1].options.env.CODEX_HOME, join(directory, accountA));
    assert.deepEqual(await helper.invoke({ method: "cancel", accountId: accountA }), { state: "canceled" });
    await assert.rejects(result.completion, /stopped/);
    assert.deepEqual(await helper.invoke({ method: "cancel", accountId: accountA }), { state: "idle" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("logout terminates pending device login and invokes only Codex logout", async () => {
  const directory = await mkdtemp(join(tmpdir(), "factorize-codex-auth-"));
  try {
    const fake = fakeCodex();
    const helper = createCodexAuthHelper({ accountHomeRoot: directory, spawnProcess: fake.spawnProcess });
    const result = await helper.invoke({ method: "device-login", accountId: accountA });
    assert.deepEqual(await helper.invoke({ method: "logout", accountId: accountA }), { state: "logged-out" });
    await assert.rejects(result.completion, /stopped/);
    assert.deepEqual(fake.calls.map(call => call.args), [["--version"], ["login", "--device-auth"], ["--version"], ["logout"]]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
