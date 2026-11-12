import assert from "node:assert/strict";
import { test } from "node:test";
import { createProxyRuntime } from "../src/runtime.mjs";
import { startProxyRunRevocationMonitor } from "../src/control-client.mjs";

const bootEpoch = "11111111-1111-4111-8111-111111111111";

function connection(runId, connectionId) {
  return { authenticated: true, enrollmentConsumed: true, runId, connectionId, bootEpoch };
}

test("unlock keeps proxy access closed until encrypted account reconciliation finishes", async () => {
  const runtime = createProxyRuntime({ bootEpoch, listenerFactory: async ({ connection: value }) => ({ connectionId: value.connectionId, close: async () => {} }) });
  let finishPreparation;
  let preparing;
  const started = new Promise(resolve => { preparing = resolve; });
  const prepared = new Promise(resolve => { finishPreparation = resolve; });
  try {
    const unlocking = runtime.unlockAndPrepare("synthetic-unlock-key", async () => {
      assert.equal(runtime.state, "preparing");
      assert.equal(runtime.getUnlockKey(), "synthetic-unlock-key");
      preparing();
      await prepared;
    });
    await started;
    await assert.rejects(runtime.acceptAuthenticatedConnection(connection("run-pending", "connection-pending")), /locked/);
    assert.equal(runtime.state, "preparing");
    finishPreparation();
    await unlocking;
    assert.equal(runtime.state, "unlocked");
    const listener = await runtime.acceptAuthenticatedConnection(connection("run-pending", "connection-ready"));
    assert.equal(listener.connectionId, "connection-ready");
  } finally {
    finishPreparation();
    await runtime.shutdown();
  }
});

test("unlock preparation failure clears the key and leaves proxy locked", async () => {
  const runtime = createProxyRuntime({ bootEpoch });
  try {
    await assert.rejects(runtime.unlockAndPrepare("synthetic-unlock-key", async () => {
      assert.equal(runtime.getUnlockKey(), "synthetic-unlock-key");
      throw new Error("snapshot reconciliation failed");
    }), /snapshot reconciliation failed/);
    assert.equal(runtime.state, "locked");
    assert.throws(() => runtime.getUnlockKey(), /locked/);
    await assert.rejects(runtime.acceptAuthenticatedConnection(connection("run-failed", "connection-failed")), /locked/);
  } finally {
    await runtime.shutdown();
  }
});

test("run revocation closes every established connection and rejects later enrollment", async () => {
  const closed = [];
  const runtime = createProxyRuntime({
    bootEpoch,
    listenerFactory: async ({ connection: value }) => ({
      connectionId: value.connectionId,
      close: async () => { closed.push(value.connectionId); },
    }),
  });
  runtime.unlock("synthetic-unlock-key");
  try {
    await runtime.acceptAuthenticatedConnection(connection("run-a", "connection-a1"));
    await runtime.acceptAuthenticatedConnection(connection("run-a", "connection-a2"));
    await runtime.acceptAuthenticatedConnection(connection("run-b", "connection-b1"));

    assert.equal(await runtime.revokeRun("run-a"), 2);
    assert.deepEqual(closed.sort(), ["connection-a1", "connection-a2"]);
    await assert.rejects(runtime.acceptAuthenticatedConnection(connection("run-a", "connection-a3")), /revoked/);

    const stillActive = await runtime.acceptAuthenticatedConnection(connection("run-b", "connection-b2"));
    assert.equal(stillActive.connectionId, "connection-b2");
    assert.equal(await runtime.revokeRun("run-a"), 0);
    assert.deepEqual(closed.sort(), ["connection-a1", "connection-a2"]);
  } finally {
    await runtime.shutdown();
  }
});

test("revocation racing listener creation closes the new listener before accepting it", async () => {
  let resolveListener;
  let closed = false;
  const runtime = createProxyRuntime({
    bootEpoch,
    listenerFactory: async () => new Promise(resolve => { resolveListener = resolve; }),
  });
  runtime.unlock("synthetic-unlock-key");
  try {
    const accepting = runtime.acceptAuthenticatedConnection(connection("run-race", "connection-race"));
    await new Promise(resolve => setImmediate(resolve));
    await runtime.revokeRun("run-race");
    resolveListener({ connectionId: "connection-race", close: async () => { closed = true; } });
    await assert.rejects(accepting, /revoked/);
    assert.equal(closed, true);
  } finally {
    await runtime.shutdown();
  }
});

test("an established run stays available during a control outage and closes when revocation arrives", async () => {
  let releaseRevocation;
  let observedSecondPoll;
  const secondPoll = new Promise(resolve => { observedSecondPoll = resolve; });
  const revocationResponse = new Promise(resolve => { releaseRevocation = resolve; });
  const closePromises = new Map();
  const runtime = createProxyRuntime({
    bootEpoch,
    listenerFactory: async ({ connection: value }) => ({
      connectionId: value.connectionId,
      close: async () => closePromises.get(value.connectionId)?.(),
    }),
  });
  runtime.unlock("synthetic-unlock-key");
  let closed = false;
  let resolveClosed;
  const didClose = new Promise(resolve => { resolveClosed = resolve; });
  closePromises.set("connection-outage", () => { closed = true; resolveClosed(); });
  const revokedRunId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  await runtime.acceptAuthenticatedConnection(connection(revokedRunId, "connection-outage"));

  let polls = 0;
  const monitor = startProxyRunRevocationMonitor({
    controlOrigin: "https://factorize.example",
    controlCredential: `fzc_${"A".repeat(43)}`,
    bootEpoch,
    runtime,
    intervalMs: 100,
    fetchImpl: async () => {
      polls += 1;
      if (polls === 1) throw new Error("control plane unavailable");
      observedSecondPoll();
      return revocationResponse;
    },
  });
  try {
    await secondPoll;
    assert.equal(closed, false, "a failed control-plane poll does not impose a connection lease");
    releaseRevocation(Response.json({ revokedRunIds: [revokedRunId] }));
    await didClose;
    assert.equal(closed, true, "durable revocation closes the established connection when delivered");
  } finally {
    releaseRevocation(Response.json({ revokedRunIds: [] }));
    await monitor.close();
    await runtime.shutdown();
  }
});

test("connection grant refresh swaps current integrations and tolerates failed polls", async () => {
  let grants = ["initial"];
  let attempts = 0;
  const replaced = [];
  let firstAttempt;
  let secondReplacement;
  const attempted = new Promise(resolve => { firstAttempt = resolve; });
  const replacedUpdated = new Promise(resolve => { secondReplacement = resolve; });
  const runtime = createProxyRuntime({
    bootEpoch,
    grantRefreshIntervalMs: 100,
    listenerFactory: async ({ connection: value }) => ({
      connectionId: value.connectionId,
      replaceGrants: next => { replaced.push(next); if (next[0] === "updated") secondReplacement(); },
      close: async () => {},
    }),
  });
  runtime.unlock("synthetic-unlock-key");
  try {
    await runtime.acceptAuthenticatedConnection({ ...connection("run-refresh", "connection-refresh"), refreshGrants: async () => {
      attempts += 1;
      if (attempts === 1) { firstAttempt(); throw new Error("temporary control-plane outage"); }
      return grants;
    } });
    await attempted;
    assert.deepEqual(replaced, [], "a failed refresh preserves the established grants");
    grants = ["updated"];
    await replacedUpdated;
    assert.deepEqual(replaced, [["updated"]]);
  } finally {
    await runtime.shutdown();
  }
});

test("a delayed grant refresh cannot restore access after run revocation", async () => {
  let resolveRefresh;
  let refreshStarted;
  const started = new Promise(resolve => { refreshStarted = resolve; });
  const refreshed = new Promise(resolve => { resolveRefresh = resolve; });
  const replaced = [];
  let closed = false;
  const runId = "run-refresh-revoked";
  const runtime = createProxyRuntime({
    bootEpoch,
    grantRefreshIntervalMs: 100,
    listenerFactory: async ({ connection: value }) => ({
      connectionId: value.connectionId,
      replaceGrants: grants => replaced.push(grants),
      close: async () => { closed = true; },
    }),
  });
  runtime.unlock("synthetic-unlock-key");
  try {
    await runtime.acceptAuthenticatedConnection({
      ...connection(runId, "connection-refresh-revoked"),
      refreshGrants: async () => { refreshStarted(); return refreshed; },
    });
    await started;
    assert.equal(await runtime.revokeRun(runId), 1);
    assert.equal(closed, true);

    resolveRefresh(["stale-restored-grant"]);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(replaced, [], "a delayed snapshot must not replace grants after revocation");
  } finally {
    resolveRefresh([]);
    await runtime.shutdown();
  }
});
