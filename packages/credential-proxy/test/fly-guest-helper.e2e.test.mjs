import assert from "node:assert/strict";
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
import { startAuthenticatedProxyTunnel } from "../src/tunnel-transport.mjs";

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
