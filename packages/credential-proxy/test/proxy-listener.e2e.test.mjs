import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer as createHttpsServer } from "node:https";
import { once } from "node:events";
import { connect as tlsConnect } from "node:tls";
import { test } from "node:test";
import { createBearerForwarder } from "../src/bearer-forwarder.mjs";
import { createAuthenticatedProxyListener } from "../src/proxy-listener.mjs";
import { createProxyRuntime } from "../src/runtime.mjs";
import { createProxyRunCredentialStore } from "../src/run-credential-store.mjs";
import { createOriginConnector } from "../src/destination-policy.mjs";
import { createAuthenticatedTunnelServer, peerIdentity, startAuthenticatedProxyTunnel, startVmTunnelHelper } from "../src/tunnel-transport.mjs";

const fixtures = new URL("./fixtures/", import.meta.url);
const key = await readFile(new URL("upstream-key.pem", fixtures));
const cert = await readFile(new URL("upstream-cert.pem", fixtures));

async function waitForEvent(emitter, event) {
  const pending = once(emitter, event);
  return pending;
}

test("mTLS VM identity comes from one canonical URI SAN bound to the certificate CN", () => {
  const identity = "api.example.test";
  const encoded = Buffer.from(identity).toString("base64url");
  const socket = (subjectaltname, commonName = identity, authorized = true) => ({
    authorized,
    getPeerCertificate: () => ({ subject: { CN: commonName }, subjectaltname }),
  });
  assert.equal(peerIdentity(socket(`DNS:api.example.test, URI:urn:factorize:vm:${encoded}`)), identity);
  assert.throws(() => peerIdentity(socket("DNS:api.example.test")), /one VM identity URI/);
  assert.throws(() => peerIdentity(socket(`URI:urn:factorize:vm:${encoded}, URI:urn:factorize:vm:${encoded}`)), /one VM identity URI/);
  assert.throws(() => peerIdentity(socket("URI:urn:factorize:vm:not_canonical=")), /invalid VM identity URI/);
  assert.throws(() => peerIdentity(socket(`URI:urn:factorize:vm:${encoded}`, "other-vm")), /inconsistent/);
  assert.throws(() => peerIdentity(socket(`URI:urn:factorize:vm:${encoded}`, identity, false)), /not authorized/);
});

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
      bootEpoch: runtime.bootEpoch,
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

test("reflection exposes safe metadata for only the authenticated VM connection and tracks live grant changes", { timeout: 5_000 }, async () => {
  const runtime = createProxyRuntime();
  const connections = [];
  let first;
  let second;
  let firstLiveGrants;
  try {
    runtime.unlock("synthetic-unlock-key");
    firstLiveGrants = [
      { id: "selected-1", name: "Billing API", description: "Billing help", origin: "https://billing.example", credential: "secret-first" },
      { id: "selected-2", name: "Metrics API", description: null, origin: "https://metrics.example", credential: "secret-second" },
    ];
    first = await runtime.acceptAuthenticatedConnection({
      authenticated: true, enrollmentConsumed: true, bootEpoch: runtime.bootEpoch,
      connectionId: "reflection-connection-1", runId: "run-1", vmId: "vm-1",
      grants: firstLiveGrants,
      refreshGrants: async () => firstLiveGrants,
    });
    second = await runtime.acceptAuthenticatedConnection({
      authenticated: true, enrollmentConsumed: true, bootEpoch: runtime.bootEpoch,
      connectionId: "reflection-connection-2", runId: "run-2", vmId: "vm-2",
      grants: [{ id: "other-vm-only", name: "Private API", description: "other VM", origin: "https://private.example", credential: "secret-other-vm" }],
    });
    connections.push(first, second);

    const reflect = async listener => {
      const address = listener.address;
      assert.equal(address.address, "127.0.0.1");
      const response = await fetch(`http://127.0.0.1:${address.port}/integrations`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      return response.json();
    };
    const firstReflection = await reflect(first);
    assert.equal(firstReflection.state, "unlocked");
    assert.deepEqual(firstReflection.integrations, [
      { id: "selected-1", source: "portable", name: "Billing API", description: "Billing help", endpoint: "/integrations/selected-1/", example: 'curl "$FACTORIZE_PROXY_URL/integrations/selected-1/"', availability: "available" },
      { id: "selected-2", source: "portable", name: "Metrics API", description: null, endpoint: "/integrations/selected-2/", example: 'curl "$FACTORIZE_PROXY_URL/integrations/selected-2/"', availability: "available" },
    ]);
    assert.equal(JSON.stringify(firstReflection).includes("secret-"), false);
    assert.equal(JSON.stringify(firstReflection).includes("https://billing.example"), false);

    const secondReflection = await reflect(second);
    assert.deepEqual(secondReflection.integrations.map(item => item.id), ["other-vm-only"]);
    assert.equal(JSON.stringify(secondReflection).includes("selected-1"), false);

    first.replaceGrants([{ id: "selected-2", name: "Metrics API", description: "current help", origin: "https://metrics.example", credential: "replacement-secret" }]);
    const refreshed = await reflect(first);
    assert.deepEqual(refreshed.integrations.map(item => [item.id, item.description]), [["selected-2", "current help"]]);
    assert.equal(JSON.stringify(refreshed).includes("replacement-secret"), false);

    await runtime.lock();
    const locked = await reflect(first);
    assert.deepEqual(locked, { state: "locked", integrations: [
      { id: "selected-2", source: "portable", name: "Metrics API", description: "current help", endpoint: "/integrations/selected-2/", example: 'curl "$FACTORIZE_PROXY_URL/integrations/selected-2/"', availability: "locked" },
    ] });
    assert.equal((await fetch(`http://127.0.0.1:${first.address.port}/integrations/selected-2/`)).status, 423);
    firstLiveGrants = [{ id: "selected-2", name: "Metrics API", description: "after unlock", origin: "https://metrics.example", credential: "fresh-secret" }];
    await runtime.unlockAndPrepare("synthetic-unlock-key", async () => {});
    const unlocked = await reflect(first);
    assert.equal(unlocked.state, "unlocked");
    assert.deepEqual(unlocked.integrations.map(item => [item.id, item.description]), [["selected-2", "after unlock"]]);
    assert.equal(JSON.stringify(unlocked).includes("fresh-secret"), false);

    const methodDenied = await fetch(`http://127.0.0.1:${first.address.port}/integrations`, { method: "POST" });
    assert.equal(methodDenied.status, 405);
  } finally {
    await runtime.shutdown();
  }
});

test("live integration edits replace credentials and deletion removes access from an established grant", { timeout: 5_000 }, async () => {
  const observed = [];
  const upstream = createHttpsServer({ key, cert }, (request, response) => {
    observed.push(request.headers.authorization);
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("ok");
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const port = upstream.address().port;
  const forwarder = createBearerForwarder({ connectorFactory: origin => async requestUrl => {
    assert.equal(origin, `https://api.example.test:${port}`);
    const url = new URL(requestUrl);
    const socket = tlsConnect({ host: "127.0.0.1", port, servername: url.hostname, ca: cert });
    await once(socket, "secureConnect");
    return { socket, url };
  } });
  let grants = [{ id: "tool-1", origin: `https://api.example.test:${port}`, credential: "first-secret" }];
  const runtime = createProxyRuntime({
    grantRefreshIntervalMs: 100,
    listenerFactory: ({ connection }) => createAuthenticatedProxyListener({ connection, forwarder }),
  });
  let listener;
  try {
    runtime.unlock("synthetic-unlock-key");
    listener = await runtime.acceptAuthenticatedConnection({
      authenticated: true, enrollmentConsumed: true, bootEpoch: runtime.bootEpoch,
      connectionId: "live-integration-connection", runId: "live-integration-run", vmId: "live-integration-vm",
      grants, refreshGrants: async () => grants,
    });
    const base = `http://127.0.0.1:${listener.address.port}`;
    assert.equal((await fetch(`${base}/integrations/tool-1/echo`)).status, 200);
    grants = [{ id: "tool-1", origin: `https://api.example.test:${port}`, credential: "replacement-secret" }];
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal((await fetch(`${base}/integrations/tool-1/echo`)).status, 200);
    grants = [];
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal((await fetch(`${base}/integrations/tool-1/echo`)).status, 403);
    assert.deepEqual(observed, ["Bearer first-secret", "Bearer replacement-secret"]);
  } finally {
    if (listener) await runtime.disconnect("live-integration-connection");
    await runtime.shutdown();
    await new Promise(resolve => upstream.close(resolve));
  }
});

test("listener refuses an unconsumed or unauthenticated connection", async () => {
  await assert.rejects(createAuthenticatedProxyListener({ connection: {
    authenticated: true, connectionId: "connection", runId: "run", vmId: "vm", grants: [],
  } }), /authenticated consumed connection/);
});

test("runtime rejects a consumed enrollment from an earlier proxy boot", async () => {
  const runtime = createProxyRuntime({ bootEpoch: "11111111-1111-4111-8111-111111111111" });
  runtime.unlock("synthetic-unlock-key");
  try {
    await assert.rejects(runtime.acceptAuthenticatedConnection({
      authenticated: true,
      enrollmentConsumed: true,
      bootEpoch: "22222222-2222-4222-8222-222222222222",
      connectionId: "stale-enrollment",
      runId: "run-1",
      vmId: "vm-1",
      grants: [],
    }), /different proxy boot/);
  } finally {
    await runtime.shutdown();
  }
});

test("VM helper uses mutual TLS and consumed enrollment to reach only its granted integration listener", { timeout: 5_000 }, async () => {
  let observedAuthorization;
  let enrollmentCount = 0;
  let authenticationCount = 0;
  let mismatchReachedResolve;
  const mismatchReached = new Promise(resolve => { mismatchReachedResolve = resolve; });
  const upstream = createHttpsServer({ key, cert }, (request, response) => {
    observedAuthorization = request.headers.authorization;
    response.end("transport-ok");
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
  const runtime = createProxyRuntime({ listenerFactory: ({ connection }) => createAuthenticatedProxyListener({ connection, forwarder }) });
  const tunnel = createAuthenticatedTunnelServer({
    tls: { key, cert, ca: cert },
    runtime,
    authenticateEnrollment: async ({ token, vmIdentity, bootEpoch }) => {
      authenticationCount++;
      assert.ok(["A", "B", "C", "X"].some(value => token === value.repeat(43)));
      assert.equal(vmIdentity, "api.example.test");
      assert.equal(bootEpoch, runtime.bootEpoch);
      if (token === "A".repeat(43)) throw new Error("temporary control-plane outage");
      if (token === "X".repeat(43)) mismatchReachedResolve();
      return {
        authenticated: true,
        enrollmentConsumed: true,
        vmIdentity: token === "X".repeat(43) ? "other-vm" : vmIdentity,
        bootEpoch,
        connectionId: "transport-enrollment-1",
        runId: "run-transport-1",
        vmId: vmIdentity,
        grants: [{ id: "tool-1", origin: `https://api.example.test:${upstreamPort}`, credential: "synthetic-bearer" }],
      };
    },
  });
  await tunnel.listening;
  runtime.unlock("synthetic-unlock-key");
  const local = await startVmTunnelHelper({
    tls: { key, cert, ca: cert, servername: "api.example.test" },
    enrollment: async () => ({ token: ["A", "B", "C"][enrollmentCount++ % 3].repeat(43) }),
    proxyHost: "127.0.0.1",
    proxyPort: tunnel.address().port,
    wait: async () => {},
  });
  let mismatchLocal;
  try {
    const response = await fetch(`http://127.0.0.1:${local.address.port}/integrations/tool-1/echo`, {
      headers: { authorization: "Bearer caller-token" },
    });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "transport-ok");
    assert.equal(observedAuthorization, "Bearer synthetic-bearer");
    const denied = await fetch(`http://127.0.0.1:${local.address.port}/integrations/other-tool/echo`);
    assert.equal(denied.status, 403);
    assert.ok(enrollmentCount >= 3, "failed setup and local connections get fresh one-use enrollment");
    assert.equal(enrollmentCount, authenticationCount, "each enrollment is independently consumed by the proxy transport");
    mismatchLocal = await startVmTunnelHelper({
      tls: { key, cert, ca: cert, servername: "api.example.test" },
      enrollment: async () => ({ token: (enrollmentCount++, "X".repeat(43)) }),
      proxyHost: "127.0.0.1",
      proxyPort: tunnel.address().port,
    });
    const rejectedRequest = fetch(`http://127.0.0.1:${mismatchLocal.address.port}/integrations/tool-1/echo`);
    await mismatchReached;
    await mismatchLocal.close();
    mismatchLocal = undefined;
    await assert.rejects(rejectedRequest, /fetch failed/, "mismatched VM binding is rejected");
    assert.equal(authenticationCount, enrollmentCount);
  } finally {
    await mismatchLocal?.close();
    await local.close();
    await tunnel.close();
    await runtime.shutdown();
    await new Promise((resolve, reject) => upstream.close(error => error ? reject(error) : resolve()));
  }
});

test("VM helper authenticates the active run while the proxy performs authenticated enrollment", { timeout: 5_000 }, async () => {
  const runtime = createProxyRuntime();
  const runCredentials = createProxyRunCredentialStore();
  const requests = [];
  let enrollmentSequence = 0;
  const runId = "33333333-3333-4333-8333-333333333333";
  const runCredential = `fzt_run_${Buffer.from(runId).toString("base64url")}_${"R".repeat(43)}`;
  runCredentials.authorize({ runId, vmIdentity: "api.example.test", credential: runCredential });
  const tunnel = await startAuthenticatedProxyTunnel({
    tls: { key, cert, ca: cert },
    runtime,
    controlOrigin: "https://factorize.example",
    controlCredential: `fzc_${"c".repeat(43)}`,
    resolveRunCredential: (id, vmIdentity) => runCredentials.resolve(id, vmIdentity),
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body);
      requests.push({ url: String(url), authorization: init.headers.Authorization, body });
      if (String(url).endsWith("/enroll")) {
        enrollmentSequence++;
        return Response.json({ enrollmentId: `11111111-1111-4111-8111-${String(enrollmentSequence).padStart(12, "0")}`, token: "e".repeat(43), grantRevision: 7 });
      }
      const enrollmentId = `11111111-1111-4111-8111-${String(enrollmentSequence).padStart(12, "0")}`;
      return Response.json({ consumed: true, binding: {
        tenantId: "22222222-2222-4222-8222-222222222222",
        runId,
        vmIdentity: "api.example.test",
        proxyIdentity: "proxy-fixture",
        bootEpoch: runtime.bootEpoch,
        enrollmentId,
        grantRevision: 7,
      } });
    },
    resolveGrants: async binding => {
      assert.equal(binding.runId, runId);
      assert.equal(binding.bootEpoch, runtime.bootEpoch);
      return [];
    },
  });
  runtime.unlock("synthetic-unlock-key");
  const local = await startVmTunnelHelper({
    tls: { key, cert, ca: cert, servername: "api.example.test" },
    runId,
    proxyHost: "127.0.0.1",
    proxyPort: tunnel.address().port,
  });
  try {
    for (let index = 0; index < 2; index++) {
      const response = await fetch(`http://127.0.0.1:${local.address.port}/unrecognized`, { headers: { connection: "close" } });
      assert.equal(response.status, 404);
    }
    assert.deepEqual(requests.map(({ url, authorization, body }) => ({
      path: new URL(url).pathname, authorization, body,
    })), [
      { path: "/internal/credential-proxy/enroll", authorization: `Bearer fzc_${"c".repeat(43)}`, body: { runId, vmIdentity: "api.example.test", runCredential } },
      { path: "/internal/credential-proxy/consume-enrollment", authorization: `Bearer fzc_${"c".repeat(43)}`, body: { runId, vmIdentity: "api.example.test", enrollmentToken: "e".repeat(43) } },
      { path: "/internal/credential-proxy/enroll", authorization: `Bearer fzc_${"c".repeat(43)}`, body: { runId, vmIdentity: "api.example.test", runCredential } },
      { path: "/internal/credential-proxy/consume-enrollment", authorization: `Bearer fzc_${"c".repeat(43)}`, body: { runId, vmIdentity: "api.example.test", enrollmentToken: "e".repeat(43) } },
    ]);
  } finally {
    await local.close();
    await tunnel.close();
    await runtime.shutdown();
    runCredentials.clear();
  }
});

test("authenticated reconnect receives current grants after live changes and lock/unlock", { timeout: 10_000 }, async () => {
  let currentGrants = [{ id: "tool-1", origin: "https://api.example.test", credential: "initial-grant" }];
  const observedAuthorization = [];
  let authentications = 0;
  const upstream = createHttpsServer({ key, cert }, (_request, response) => {
    observedAuthorization.push(_request.headers.authorization);
    response.end("current-grant");
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const upstreamPort = upstream.address().port;
  const forwarder = createBearerForwarder({
    connectorFactory: configuredOrigin => async requestUrl => {
      assert.equal(configuredOrigin, `https://api.example.test:${upstreamPort}`);
      const url = new URL(requestUrl);
      const socket = tlsConnect({ host: "127.0.0.1", port: upstreamPort, servername: url.hostname, ca: cert });
      await once(socket, "secureConnect");
      return { socket, url };
    },
  });
  const runtime = createProxyRuntime({
    listenerFactory: ({ connection }) => createAuthenticatedProxyListener({ connection, forwarder }),
  });
  const tunnel = createAuthenticatedTunnelServer({
    tls: { key, cert, ca: cert },
    runtime,
    authenticateRun: async ({ runId, vmIdentity, bootEpoch }) => {
      authentications++;
      if (runtime.state !== "unlocked") throw new Error("proxy is locked");
      return {
        authenticated: true,
        enrollmentConsumed: true,
        vmIdentity,
        bootEpoch,
        connectionId: `reconnect-${authentications}`,
        runId,
        vmId: vmIdentity,
      grants: currentGrants.map(grant => ({ ...grant, origin: `https://api.example.test:${upstreamPort}` })),
      };
    },
  });
  await tunnel.listening;
  runtime.unlock("synthetic-unlock-key");
  const local = await startVmTunnelHelper({
    tls: { key, cert, ca: cert, servername: "api.example.test" },
    runId: "33333333-3333-4333-8333-333333333333",
    proxyHost: "127.0.0.1",
    proxyPort: tunnel.address().port,
    wait: milliseconds => new Promise(resolve => setTimeout(resolve, Math.min(milliseconds, 10))),
  });
  const request = async id => {
    const response = await fetch(`http://127.0.0.1:${local.address.port}/integrations/${id}/echo`, {
      headers: { connection: "close" },
    });
    return { status: response.status, body: await response.text() };
  };
  try {
    assert.deepEqual(await request("tool-1"), { status: 200, body: "current-grant" });
    assert.deepEqual(observedAuthorization, ["Bearer initial-grant"]);

    currentGrants = [{ id: "tool-2", origin: "https://api.example.test", credential: "live-update" }];
    assert.deepEqual(await request("tool-1"), { status: 403, body: "" }, "a new authenticated tunnel cannot retain an old grant");
    assert.deepEqual(await request("tool-2"), { status: 200, body: "current-grant" });
    assert.deepEqual(observedAuthorization, ["Bearer initial-grant", "Bearer live-update"]);

    await runtime.lock();
    currentGrants = [{ id: "tool-3", origin: "https://api.example.test", credential: "after-unlock" }];
    const pending = request("tool-3");
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.ok(authentications >= 5, "the helper retries with fresh authenticated connections while locked");
    runtime.unlock("synthetic-unlock-key");
    assert.deepEqual(await pending, { status: 200, body: "current-grant" });
    assert.deepEqual(observedAuthorization, ["Bearer initial-grant", "Bearer live-update", "Bearer after-unlock"]);
  } finally {
    await local.close();
    await tunnel.close();
    await runtime.shutdown();
    await new Promise((resolve, reject) => upstream.close(error => error ? reject(error) : resolve()));
  }
});

test("TLS forwarding keeps the configured origin through redirects and never replays an interrupted write", { timeout: 10_000 }, async () => {
  let requests = 0;
  let writeStartedResolve;
  const writeStarted = new Promise(resolve => { writeStartedResolve = resolve; });
  const upstream = createHttpsServer({ key, cert }, async (request, response) => {
    requests++;
    if (request.url === "/redirect") {
      response.writeHead(302, { location: "https://other.example.test/should-not-be-requested" }).end();
      return;
    }
    if (request.url === "/write") {
      writeStartedResolve();
      request.resume();
      await new Promise(resolve => request.socket.once("close", resolve));
      return;
    }
    response.end("bound-origin");
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const upstreamPort = upstream.address().port;
  const origin = `https://api.example.test:${upstreamPort}`;
  const forwarder = createBearerForwarder({
    connectorFactory: configuredOrigin => createOriginConnector(configuredOrigin, {
      resolve: async hostname => {
        assert.equal(hostname, "api.example.test");
        return [{ address: "93.184.216.34", family: 4 }];
      },
      connect: async ({ hostname, port, address }) => {
        const socket = tlsConnect({ host: "127.0.0.1", port, servername: hostname, ca: cert });
        await once(socket, "secureConnect");
        // The fixture maps a validated public test address to this local TLS upstream.
        Object.defineProperty(socket, "remoteAddress", { value: address });
        return socket;
      },
    }),
  });
  const runtime = createProxyRuntime({
    listenerFactory: ({ connection }) => createAuthenticatedProxyListener({ connection, forwarder }),
  });
  runtime.unlock("synthetic-unlock-key");
  const listener = await runtime.acceptAuthenticatedConnection({
    authenticated: true,
    enrollmentConsumed: true,
    bootEpoch: runtime.bootEpoch,
    connectionId: "destination-boundary-connection",
    runId: "destination-boundary-run",
    vmId: "destination-boundary-vm",
    grants: [{ id: "tool-1", origin, credential: "synthetic-bearer" }],
  });
  const tunnel = createAuthenticatedTunnelServer({
    tls: { key, cert, ca: cert },
    runtime,
    authenticateEnrollment: async ({ token, vmIdentity, bootEpoch }) => ({
      authenticated: true,
      enrollmentConsumed: true,
      vmIdentity,
      bootEpoch,
      connectionId: `destination-${token.slice(0, 4)}`,
      runId: "destination-boundary-run",
      vmId: vmIdentity,
      grants: [{ id: "tool-1", origin, credential: "synthetic-bearer" }],
    }),
  });
  await tunnel.listening;
  const local = await startVmTunnelHelper({
    tls: { key, cert, ca: cert, servername: "api.example.test" },
    enrollment: async () => ({ token: "E".repeat(43) }),
    proxyHost: "127.0.0.1",
    proxyPort: tunnel.address().port,
    wait: async () => {},
  });
  const base = `http://127.0.0.1:${local.address.port}`;
  try {
    const ok = await fetch(`${base}/integrations/tool-1/safe/path?next=https%3A%2F%2Fother.example.test`, { headers: { connection: "close" } });
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), "bound-origin");

    const redirected = await fetch(`${base}/integrations/tool-1/redirect`, { headers: { connection: "close" } });
    assert.equal(redirected.status, 502, "a redirect response is surfaced as an upstream failure");
    assert.equal(requests, 2, "the redirect target is never contacted");

    const interrupted = fetch(`${base}/integrations/tool-1/write`, {
      method: "POST",
      headers: { connection: "close", "content-type": "text/plain" },
      body: "single-write",
    });
    await writeStarted;
    await runtime.lock();
    const interruptedResponse = await interrupted;
    assert.equal(interruptedResponse.status, 499, "the interrupted operation is reported as cancelled");
    assert.equal(await interruptedResponse.text(), "request cancelled");
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(requests, 3, "the interrupted POST was sent once and never replayed");
    assert.equal(forwarder.activeRequests, 0);
  } finally {
    await local.close();
    await tunnel.close();
    await runtime.disconnect(listener.connectionId);
    await runtime.shutdown();
    await new Promise((resolve, reject) => upstream.close(error => error ? reject(error) : resolve()));
  }
});
