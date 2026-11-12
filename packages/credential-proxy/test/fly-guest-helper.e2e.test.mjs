import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { createServer as createHttpsServer } from "node:https";
import { connect as tcpConnect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { connect as tlsConnect } from "node:tls";
import { test } from "node:test";
import { FACTORIZE_FLY_TUNNEL_HELPER } from "../../api/src/fly-job-tunnel-helper.ts";
import { createBearerForwarder } from "../src/bearer-forwarder.mjs";
import { createAuthenticatedProxyListener } from "../src/proxy-listener.mjs";
import { createProxyRuntime } from "../src/runtime.mjs";
import { createProxyRunCredentialStore } from "../src/run-credential-store.mjs";
import { createProxyIntegrationGrantResolver } from "../src/decrypted-grants.mjs";
import { startAuthenticatedProxyTunnel, startVmTunnelHelper } from "../src/tunnel-transport.mjs";

const fixtures = new URL("./fixtures/", import.meta.url);
const key = await readFile(new URL("upstream-key.pem", fixtures));
const cert = await readFile(new URL("upstream-cert.pem", fixtures));
const proxyCert = await readFile(new URL("proxy-cert.pem", fixtures));

async function freePort() {
  const { createServer } = await import("node:net");
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitForServer(child, port) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Fly guest helper exited (${child.exitCode})`);
    try {
      const socket = await new Promise((resolve, reject) => {
        const candidate = tcpConnect(port, "127.0.0.1");
        candidate.once("connect", () => resolve(candidate));
        candidate.once("error", reject);
      });
      socket.destroy();
      return;
    } catch { await new Promise(resolve => setTimeout(resolve, 25)); }
  }
  throw new Error("Fly guest helper did not listen");
}

async function waitForProxyUnlock(port) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/integrations`, { signal: AbortSignal.timeout(250) });
      if (response.ok && (await response.json()).state === "unlocked") return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("proxy did not refresh its scoped grants after unlock");
}

test("generated Fly guest helper forwards through identity-bound mTLS and rejects another VM binding", { timeout: 10_000 }, async () => {
  let observedAuthorization;
  const upstream = createHttpsServer({ key, cert }, (request, response) => {
    observedAuthorization = request.headers.authorization;
    response.end("fly-guest-tunnel-ok");
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
  runtime.unlock("synthetic-unlock-key");
  const credentials = createProxyRunCredentialStore();
  const runId = "33333333-3333-4333-8333-333333333333";
  const crossVmRunId = "44444444-4444-4444-8444-444444444444";
  const runCredential = `fzt_run_${Buffer.from(runId).toString("base64url")}_${"R".repeat(43)}`;
  const crossVmCredential = `fzt_run_${Buffer.from(crossVmRunId).toString("base64url")}_${"S".repeat(43)}`;
  credentials.authorize({ runId, vmIdentity: "api.example.test", credential: runCredential });
  credentials.authorize({ runId: crossVmRunId, vmIdentity: "another-vm.example.test", credential: crossVmCredential });
  let enrollments = 0;
  let rejectedRunBinding = false;
  const tunnel = await startAuthenticatedProxyTunnel({
    tls: { key, cert: proxyCert, ca: cert },
    runtime,
    controlOrigin: "https://factorize.example",
    controlCredential: `fzc_${"c".repeat(43)}`,
    resolveRunCredential: (id, vmIdentity) => {
      if (id === crossVmRunId && vmIdentity === "api.example.test") rejectedRunBinding = true;
      return credentials.resolve(id, vmIdentity);
    },
    fetchImpl: async (url, init) => {
      const path = new URL(url).pathname;
      const body = JSON.parse(init.body);
      if (path.endsWith("/enroll")) {
        enrollments++;
        if (body.runId !== runId || body.vmIdentity !== "api.example.test") return Response.json({ error: "run is not bound to this VM" }, { status: 403 });
        return Response.json({ enrollmentId: `11111111-1111-4111-8111-${String(enrollments).padStart(12, "0")}`, token: "e".repeat(43), grantRevision: 7 });
      }
      const enrollmentId = `11111111-1111-4111-8111-${String(enrollments).padStart(12, "0")}`;
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
    resolveGrants: async () => [{ id: "tool-1", origin: `https://api.example.test:${upstreamPort}`, credential: "synthetic-bearer" }],
  });

  const root = await mkdtemp(join(tmpdir(), "factorize-fly-guest-"));
  const configRoot = join(root, "proxy");
  const helperPort = await freePort();
  let helper;
  try {
    await mkdir(configRoot);
    await Promise.all([
      writeFile(join(configRoot, "client.key"), key),
      writeFile(join(configRoot, "client.crt"), cert),
      writeFile(join(configRoot, "ca.crt"), cert),
      writeFile(join(configRoot, "config.json"), JSON.stringify({
        proxyHost: "127.0.0.1", proxyPort: tunnel.address().port, localPort: helperPort, runId,
      })),
    ]);
    const source = FACTORIZE_FLY_TUNNEL_HELPER.replace(
      'const root = "/home/exedev/.factorize-job/proxy";',
      `const root = ${JSON.stringify(configRoot)};`,
    );
    helper = spawn(process.execPath, ["--input-type=module", "-e", source], { stdio: "ignore" });
    await waitForServer(helper, helperPort);
    const response = await fetch(`http://127.0.0.1:${helperPort}/integrations/tool-1/echo`, {
      headers: { authorization: "Bearer caller-controlled" },
    });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "fly-guest-tunnel-ok");
    assert.equal(observedAuthorization, "Bearer synthetic-bearer");

    // This VM certificate identifies api.example.test, while the second run is
    // durably bound to another VM. The real control authenticator must fail closed.
    const secondPort = await freePort();
    const secondRoot = join(root, "other-run");
    await mkdir(secondRoot);
    await Promise.all([
      writeFile(join(secondRoot, "client.key"), key),
      writeFile(join(secondRoot, "client.crt"), cert),
      writeFile(join(secondRoot, "ca.crt"), cert),
      writeFile(join(secondRoot, "config.json"), JSON.stringify({
        proxyHost: "127.0.0.1", proxyPort: tunnel.address().port, localPort: secondPort, runId: crossVmRunId,
      })),
    ]);
    const otherSource = FACTORIZE_FLY_TUNNEL_HELPER.replace(
      'const root = "/home/exedev/.factorize-job/proxy";',
      `const root = ${JSON.stringify(secondRoot)};`,
    );
    const otherHelper = spawn(process.execPath, ["--input-type=module", "-e", otherSource], { stdio: "ignore" });
    try {
      await waitForServer(otherHelper, secondPort);
      await assert.rejects(fetch(`http://127.0.0.1:${secondPort}/integrations/tool-1/echo`, {
        signal: AbortSignal.timeout(1000),
      }), /fetch failed|aborted|timeout/i);
      assert.equal(rejectedRunBinding, true);
    } finally {
      otherHelper.kill("SIGTERM");
    }
  } finally {
    helper?.kill("SIGTERM");
    await rm(root, { recursive: true, force: true });
    await tunnel.close();
    await runtime.shutdown();
    credentials.clear();
    await new Promise((resolve, reject) => upstream.close(error => error ? reject(error) : resolve()));
  }
});

test("locked scoped run reconnects with its current grant while another VM stays denied", { timeout: 10_000 }, async () => {
  const ownerId = "owner-e2e-fixture";
  const integrationId = "scoped-metrics";
  const runId = "55555555-5555-4555-8555-555555555555";
  const otherRunId = "66666666-6666-4666-8666-666666666666";
  const vmIdentity = "api.example.test";
  const otherVmIdentity = "another-vm.example.test";
  const controlCredential = `fzc_${"c".repeat(43)}`;
  const unlockKey = `fzk1.${Buffer.from(webcrypto.getRandomValues(new Uint8Array(32))).toString("base64url")}`;
  const bootEpoch = "77777777-7777-4777-8777-777777777777";
  const grantRevision = 9;
  const runCredential = `fzt_run_${Buffer.from(runId).toString("base64url")}_${"R".repeat(43)}`;
  const otherRunCredential = `fzt_run_${Buffer.from(otherRunId).toString("base64url")}_${"S".repeat(43)}`;
  const activeRun = { vmIdentity, integrationIds: [integrationId], grantRevision };
  let selectedCredential = "initial-scoped-bearer";
  let observedAuthorizations = [];
  let snapshotReads = 0;
  const upstream = createHttpsServer({ key, cert }, (request, response) => {
    observedAuthorizations.push(request.headers.authorization);
    response.end("scoped-e2e-ok");
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const upstreamPort = upstream.address().port;
  const origin = `https://api.example.test:${upstreamPort}`;
  const forwarder = createBearerForwarder({ connectorFactory: configuredOrigin => async requestUrl => {
    assert.equal(configuredOrigin, origin);
    const url = new URL(requestUrl);
    const socket = tlsConnect({ host: "127.0.0.1", port: upstreamPort, servername: url.hostname, ca: cert });
    await once(socket, "secureConnect");
    return { socket, url };
  } });
  const runtime = createProxyRuntime({ bootEpoch, listenerFactory: ({ connection }) => createAuthenticatedProxyListener({ connection, forwarder }) });
  const credentials = createProxyRunCredentialStore();
  credentials.authorize({ runId, vmIdentity, credential: runCredential });
  credentials.authorize({ runId: otherRunId, vmIdentity: otherVmIdentity, credential: otherRunCredential });
  const recordFor = async credential => {
    const raw = Buffer.from(unlockKey.slice("fzk1.".length), "base64url");
    const material = await webcrypto.subtle.importKey("raw", raw, "HKDF", false, ["deriveKey"]);
    const aesKey = await webcrypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256",
      salt: new TextEncoder().encode("factorize.unlock-key.v1"),
      info: new TextEncoder().encode("factorize.record.aes-256-gcm.v1") }, material,
    { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
    const nonce = webcrypto.getRandomValues(new Uint8Array(12));
    const aad = new TextEncoder().encode(JSON.stringify(["factorize-record-v1", ownerId, integrationId, "bearer", origin, 1]));
    const ciphertext = await webcrypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: aad, tagLength: 128 }, aesKey, new TextEncoder().encode(credential));
    return { id: integrationId, kind: "bearer", name: "Metrics", description: "current scoped grant", origin, revision: 1,
      deletedAt: null, encryptedPayload: `${Buffer.from(nonce).toString("base64")}.${Buffer.from(ciphertext).toString("base64")}` };
  };
  const record = await recordFor(selectedCredential);
  const fetchControl = async (url, init) => {
    const path = new URL(url).pathname;
    assert.equal(new Headers(init.headers).get("authorization"), `Bearer ${controlCredential}`);
    const body = JSON.parse(init.body);
    if (path.endsWith("/enroll")) {
      assert.deepEqual(activeRun.integrationIds, [integrationId], "Factorize run snapshot contains only the selected integration");
      assert.equal(body.runId, runId);
      assert.equal(body.vmIdentity, vmIdentity);
      assert.equal(body.runCredential, runCredential);
      return Response.json({ enrollmentId: "88888888-8888-4888-8888-888888888888", token: "e".repeat(43), grantRevision });
    }
    if (path.endsWith("/consume-enrollment")) {
      assert.equal(body.runId, runId);
      assert.equal(body.vmIdentity, vmIdentity);
      return Response.json({ consumed: true, binding: { tenantId: ownerId, runId, vmIdentity,
        proxyIdentity: "proxy-fixture", bootEpoch, enrollmentId: "88888888-8888-4888-8888-888888888888", grantRevision } });
    }
    if (path.endsWith("/integration-snapshot")) {
      assert.deepEqual(body, { runId, grantRevision });
      assert.equal(activeRun.vmIdentity, vmIdentity);
      assert.deepEqual(activeRun.integrationIds, [integrationId]);
      snapshotReads++;
      return Response.json({ ownerId, records: activeRun.integrationIds.includes(record.id) ? [record] : [], modelAccount: null });
    }
    return Response.json({ error: "not found" }, { status: 404 });
  };
  const resolveGrants = createProxyIntegrationGrantResolver({ runtime, controlOrigin: "https://factorize.example",
    controlCredential, fetchImpl: fetchControl });
  const tunnel = await startAuthenticatedProxyTunnel({
    tls: { key, cert: proxyCert, ca: cert }, runtime,
    controlOrigin: "https://factorize.example", controlCredential,
    resolveGrants,
    resolveRunCredential: (id, identity) => credentials.resolve(id, identity),
    fetchImpl: fetchControl,
  });
  const helperPort = await freePort();
  const helper = await startVmTunnelHelper({
    tls: { key, cert, ca: cert }, runId,
    proxyHost: "127.0.0.1", proxyPort: tunnel.address().port, port: helperPort,
    wait: milliseconds => new Promise(resolve => setTimeout(resolve, Math.min(milliseconds, 15))),
  });
  const otherPort = await freePort();
  const otherHelper = await startVmTunnelHelper({
    tls: { key, cert, ca: cert }, runId: otherRunId,
    proxyHost: "127.0.0.1", proxyPort: tunnel.address().port, port: otherPort,
    wait: milliseconds => new Promise(resolve => setTimeout(resolve, Math.min(milliseconds, 15))),
  });
  try {
    const denied = fetch(`http://127.0.0.1:${otherPort}/integrations/${integrationId}/echo`, { signal: AbortSignal.timeout(250) });
    await assert.rejects(denied, /aborted|timeout|fetch failed/i);
    assert.equal(snapshotReads, 0, "a credential bound to another VM cannot reach the scoped snapshot");

    const waitingWhileLocked = fetch(`http://127.0.0.1:${helperPort}/integrations/${integrationId}/echo`);
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal(runtime.state, "locked");
    assert.equal(snapshotReads, 0, "locked proxy denies selected Factorize grants before decrypting a snapshot");
    assert.deepEqual(observedAuthorizations, [], "locked proxy does not forward to the upstream");

    runtime.unlock(unlockKey);
    const first = await waitingWhileLocked;
    assert.equal(first.status, 200);
    assert.equal(await first.text(), "scoped-e2e-ok");
    assert.deepEqual(observedAuthorizations, ["Bearer initial-scoped-bearer"]);
    const readsBeforeReconnect = snapshotReads;
    assert.ok(readsBeforeReconnect >= 1, "accepted scoped tunnel reads the current Factorize snapshot");

    await runtime.lock();
    selectedCredential = "updated-current-scoped-bearer";
    Object.assign(record, await recordFor(selectedCredential));
    runtime.unlock(unlockKey);
    await waitForProxyUnlock(helperPort);
    const reconnected = await fetch(`http://127.0.0.1:${helperPort}/integrations/${integrationId}/after-reconnect`);
    assert.equal(reconnected.status, 200);
    assert.equal(await reconnected.text(), "scoped-e2e-ok");
    assert.deepEqual(observedAuthorizations, ["Bearer initial-scoped-bearer", "Bearer updated-current-scoped-bearer"]);
    assert.ok(snapshotReads > readsBeforeReconnect, "reconnect performs a fresh scoped snapshot read");
  } finally {
    await helper.close();
    await otherHelper.close();
    await tunnel.close();
    credentials.clear();
    await runtime.shutdown();
    await new Promise((resolve, reject) => upstream.close(error => error ? reject(error) : resolve()));
  }
});
