import assert from "node:assert/strict";
import { test } from "node:test";
import { createProxyRuntime } from "../src/runtime.mjs";

const bootEpoch = "11111111-1111-4111-8111-111111111111";

function connection(runId, connectionId) {
  return { authenticated: true, enrollmentConsumed: true, runId, connectionId, bootEpoch };
}

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
