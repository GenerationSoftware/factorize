import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer as createHttpsServer } from "node:https";
import { once } from "node:events";
import { connect as tlsConnect } from "node:tls";
import { test } from "node:test";
import { createBearerForwarder } from "../src/bearer-forwarder.mjs";
import { createAuthenticatedProxyListener } from "../src/proxy-listener.mjs";
import { createProxyRuntime } from "../src/runtime.mjs";

const fixtures = new URL("./fixtures/", import.meta.url);
const key = await readFile(new URL("upstream-key.pem", fixtures));
const cert = await readFile(new URL("upstream-cert.pem", fixtures));

async function waitForEvent(emitter, event) {
  const pending = once(emitter, event);
  return pending;
}

test("authenticated tunnel listener streams over TLS, confines grants and cancels upstream work", { timeout: 5_000 }, async () => {
  let observedAuthorization;
  let upstreamEnded = false;
  let cancelUpstream;
  let finishUpstream;
  let cancelStartedResolve;
  const cancelStarted = new Promise(resolve => { cancelStartedResolve = resolve; });
  const upstream = createHttpsServer({ key, cert }, async (request, response) => {
    observedAuthorization = request.headers.authorization;
    if (request.url === "/cancel") {
      const closed = new Promise(resolve => request.socket.once("close", resolve));
      response.writeHead(200, { "content-type": "text/plain" });
      response.write("first chunk");
      cancelUpstream = closed;
      cancelStartedResolve();
      return;
    }
    const received = [];
    for await (const chunk of request) received.push(chunk);
    assert.equal(Buffer.concat(received).toString(), "request-body");
    response.writeHead(200, { "content-type": "text/plain" });
    response.write("first chunk");
    response.once("close", () => { upstreamEnded = true; });
    await new Promise(resolve => { finishUpstream = resolve; });
    response.end(" second chunk");
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const upstreamPort = upstream.address().port;
  const forwarder = createBearerForwarder({
    connectorFactory: origin => async requestUrl => {
      assert.equal(origin, `https://api.example.test:${upstreamPort}`);
      const url = new URL(requestUrl);
      const socket = tlsConnect({ host: "127.0.0.1", port: upstreamPort, servername: url.hostname, ca: cert });
      await once(socket, "secureConnect");
      return { socket, url };
    },
  });
  const runtime = createProxyRuntime({
    listenerFactory: ({ connection }) => createAuthenticatedProxyListener({ connection, forwarder }),
  });
  let listener;
  try {
    runtime.unlock("synthetic-unlock-key");
    listener = await runtime.acceptAuthenticatedConnection({
      authenticated: true,
      enrollmentConsumed: true,
      connectionId: "consumed-enrollment-1",
      runId: "run-1",
      vmId: "vm-1",
      grants: [{ id: "tool-1", origin: `https://api.example.test:${upstreamPort}`, credential: "synthetic-bearer" }],
    });
    const address = listener.address;
    assert.equal(address.address, "127.0.0.1");
    const base = `http://127.0.0.1:${address.port}`;
    const response = await fetch(`${base}/integrations/tool-1/echo?source=vm`, {
      method: "POST",
      headers: { authorization: "Bearer caller-token", "content-type": "text/plain" },
      body: "request-body",
    });
    assert.equal(response.status, 200);
    assert.equal(observedAuthorization, "Bearer synthetic-bearer");
    const reader = response.body.getReader();
    const first = await reader.read();
    assert.equal(Buffer.from(first.value).toString(), "first chunk");
    assert.equal(upstreamEnded, false, "response was delivered before the upstream finished");
    assert.equal(forwarder.activeRequests, 1, "streaming response retains its concurrency slot");
    finishUpstream();
    const second = await reader.read();
    assert.equal(Buffer.from(second.value).toString(), " second chunk");
    assert.equal((await reader.read()).done, true);
    assert.equal(forwarder.activeRequests, 0);

    const denied = await fetch(`${base}/integrations/other-tool/echo`);
    assert.equal(denied.status, 403);
    assert.equal(observedAuthorization, "Bearer synthetic-bearer", "ungranted request never reached the upstream");

    const abort = new AbortController();
    const cancelled = fetch(`${base}/integrations/tool-1/cancel`, { signal: abort.signal });
    await cancelStarted;
    abort.abort();
    await assert.rejects(cancelled, error => error.name === "AbortError");
    assert.ok(cancelUpstream, "upstream cancellation hook was installed");
    await Promise.race([cancelUpstream, new Promise((_, reject) => setTimeout(() => reject(new Error("upstream was not cancelled")), 1_000))]);
    assert.equal(forwarder.activeRequests, 0);
  } finally {
    finishUpstream?.();
    if (listener) await runtime.disconnect("consumed-enrollment-1");
    await runtime.shutdown();
    await new Promise((resolve, reject) => upstream.close(error => error ? reject(error) : resolve()));
  }
});

test("listener refuses an unconsumed or unauthenticated connection", async () => {
  await assert.rejects(createAuthenticatedProxyListener({ connection: {
    authenticated: true, connectionId: "connection", runId: "run", vmId: "vm", grants: [],
  } }), /authenticated consumed connection/);
});
