import assert from "node:assert/strict";
import { test } from "node:test";
import { createBearerForwarder } from "../src/bearer-forwarder.mjs";

const integration = { id: "integration-1", origin: "https://api.example.test", credential: "synthetic-token" };

test("forwards only through the granted origin and replaces unsafe routing and authorization headers", async () => {
  const connections = [];
  const calls = [];
  const forwarder = createBearerForwarder({
    connectorFactory: origin => async url => {
      connections.push({ origin, url });
      return { socket: { fixture: true }, url: new URL(url) };
    },
    request: async request => { calls.push(request); return { status: 201, body: Buffer.from("created") }; },
  });
  const result = await forwarder.forward(integration, {
    method: "post",
    url: "https://api.example.test/v1/items?source=job",
    headers: {
      Authorization: "Bearer attacker-token",
      Host: "attacker.example",
      Connection: "keep-alive, x-routing-hint",
      "X-Routing-Hint": "attacker",
      "X-Forwarded-Host": "attacker.example",
      "Content-Type": "application/json",
    },
    body: Buffer.from('{"ok":true}'),
  });
  assert.deepEqual(result, { status: 201, body: Buffer.from("created") });
  assert.deepEqual(connections, [{ origin: integration.origin, url: "https://api.example.test/v1/items?source=job" }]);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].headers.authorization, "Bearer synthetic-token");
  assert.equal(calls[0].headers.host, undefined);
  assert.equal(calls[0].headers["x-routing-hint"], undefined);
  assert.equal(calls[0].headers["x-forwarded-host"], undefined);
  assert.equal(calls[0].headers["content-type"], "application/json");
});

test("rejects requests outside the grant origin without sending them upstream", async () => {
  let sent = false;
  const forwarder = createBearerForwarder({
    connectorFactory: () => async () => { throw new TypeError("request URL does not match the configured HTTPS origin"); },
    request: async () => { sent = true; },
  });
  await assert.rejects(forwarder.forward(integration, { url: "https://169.254.169.254/latest/meta-data" }), /configured HTTPS origin/);
  assert.equal(sent, false);
  assert.equal(forwarder.activeRequests, 0);
});

test("applies an explicit per-proxy concurrent request bound", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const forwarder = createBearerForwarder({
    connectorFactory: () => async url => ({ socket: {}, url: new URL(url) }),
    request: async () => gate,
    limits: { requestMs: 10_000 },
  });
  const started = [];
  for (let i = 0; i < 16; i++) started.push(forwarder.forward(integration, { url: "https://api.example.test/" }));
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(forwarder.forward(integration, { url: "https://api.example.test/" }), /concurrent request limit/);
  release({ status: 200 });
  await Promise.all(started);
  assert.equal(forwarder.activeRequests, 0);
});

test("rejects oversized caller headers before upstream dispatch", async () => {
  let sent = false;
  const forwarder = createBearerForwarder({
    connectorFactory: () => async url => ({ socket: {}, url: new URL(url) }),
    request: async () => { sent = true; },
    limits: { headerBytes: 20 },
  });
  await assert.rejects(forwarder.forward(integration, { url: "https://api.example.test/", headers: { "x-large": "x".repeat(50) } }), /headers exceed/);
  assert.equal(sent, false);
});
