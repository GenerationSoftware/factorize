import { connect as connectTls, createServer as createTlsServer } from "node:tls";
import { connect as connectTcp, createServer as createTcpServer } from "node:net";
import { once } from "node:events";
import { createProxyEnrollmentAuthenticator } from "./control-client.mjs";

const HANDSHAKE_LIMIT = 4096;
const HANDSHAKE_TIMEOUT_MS = 10_000;
const CONTROL_RETRY_WINDOW_MS = 5 * 60_000;
const CONTROL_RETRY_MAX_MS = 30_000;
const CONTROL_RETRY_SLOW_MS = 60_000;

export function peerIdentity(socket) {
  const certificate = socket.getPeerCertificate();
  if (!socket.authorized || !certificate?.subject?.CN || typeof certificate.subjectaltname !== "string") {
    throw new Error("tunnel client certificate is not authorized");
  }
  const identities = certificate.subjectaltname.split(/,\s*/).filter(value => value.startsWith("URI:"));
  if (identities.length !== 1) throw new Error("tunnel client certificate must contain one VM identity URI");
  const match = /^URI:urn:factorize:vm:([A-Za-z0-9_-]+)$/.exec(identities[0]);
  if (!match) throw new Error("tunnel client certificate has an invalid VM identity URI");
  const identityBytes = Buffer.from(match[1], "base64url");
  const identity = identityBytes.toString("utf8");
  if (!identity || identityBytes.toString("base64url") !== match[1]
      || identity.length > 255 || /[\u0000-\u001f\u007f]/.test(identity)
      || certificate.subject.CN !== identity) {
    throw new Error("tunnel client certificate identity is invalid or inconsistent");
  }
  return identity;
}

/**
 * Accept only a TLS client with a trusted VM certificate, consume its one-use
 * enrollment, and bridge that stream to the connection-scoped HTTP listener.
 * The bridge does not expose a shell or arbitrary destination forwarding.
 */
export function createAuthenticatedTunnelServer({ tls, runtime, authenticateEnrollment, authenticateRun, host = "127.0.0.1", port = 0 } = {}) {
  if (!tls || !runtime || (typeof authenticateEnrollment !== "function" && typeof authenticateRun !== "function")) throw new TypeError("tunnel server requires TLS, runtime and enrollment authentication");
  const connections = new Set();
  const server = createTlsServer({ ...tls, requestCert: true, rejectUnauthorized: true }, (socket) => {
    connections.add(socket);
    let handshake = Buffer.alloc(0);
    let settled = false;
    const timeout = setTimeout(() => socket.destroy(new Error("tunnel enrollment timed out")), HANDSHAKE_TIMEOUT_MS);
    timeout.unref();
    const reject = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.destroy();
    };
    socket.on("data", async (chunk) => {
      if (settled) return;
      handshake = Buffer.concat([handshake, chunk]);
      const end = handshake.indexOf("\n");
      if (end < 0) return handshake.length > HANDSHAKE_LIMIT ? reject() : undefined;
      if (end > HANDSHAKE_LIMIT) return reject();
      settled = true;
      clearTimeout(timeout);
      socket.pause();
      const line = handshake.subarray(0, end).toString("utf8").replace(/\r$/, "");
      const rest = handshake.subarray(end + 1);
      const match = /^FACTORIZE-TUNNEL\/1 ([A-Za-z0-9_-]{32,128})$/.exec(line);
      const runMatch = /^FACTORIZE-TUNNEL\/3 ([0-9a-f-]{36})$/i.exec(line);
      if ((!match || typeof authenticateEnrollment !== "function") && (!runMatch || typeof authenticateRun !== "function")) return reject();
      let listener;
      let target;
      try {
        const vmIdentity = peerIdentity(socket);
        const connection = runMatch
          ? await authenticateRun({ runId: runMatch[1], vmIdentity, bootEpoch: runtime.bootEpoch })
          : await authenticateEnrollment({ token: match[1], vmIdentity, bootEpoch: runtime.bootEpoch });
        // The production control plane returns the consumed enrollment binding.
        // Compare its VM and boot identities with the authenticated TLS peer and
        // this process so an adapter cannot accidentally attach another run's
        // grants to the tunnel.
        if (!connection || connection.authenticated !== true || connection.enrollmentConsumed !== true
          || connection.vmIdentity !== peerIdentity(socket) || connection.bootEpoch !== runtime.bootEpoch
          || typeof connection.connectionId !== "string" || connection.connectionId.length === 0) {
          throw new Error("enrollment binding does not match the authenticated tunnel");
        }
        listener = await runtime.acceptAuthenticatedConnection(connection);
        const address = listener.address;
        target = connectTcp(address.port, address.address);
        await once(target, "connect");
        if (rest.length) target.write(rest);
        socket.write("FACTORIZE-TUNNEL/1 ACCEPTED\n");
        socket.pipe(target);
        target.pipe(socket);
        socket.resume();
        const close = () => {
          socket.unpipe(target);
          target.unpipe(socket);
          target.destroy();
          void runtime.disconnect(connection.connectionId);
        };
        socket.once("close", close);
        target.once("close", close);
      } catch {
        listener && await runtime.disconnect(listener.connectionId);
        socket.destroy();
      }
    });
    socket.once("close", () => { clearTimeout(timeout); connections.delete(socket); });
    socket.once("error", () => {});
  });
  server.listen(port, host);
  return {
    server,
    listening: once(server, "listening"),
    address: () => server.address(),
    close: async () => {
      for (const socket of connections) socket.destroy();
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}

/** Start the proxy's production-shaped mTLS listener using its boot-registered
 * control credential and process-local decrypted integration grants. */
export async function startAuthenticatedProxyTunnel({
  tls, runtime, controlOrigin, controlCredential, resolveGrants, resolveRunCredential, fetchImpl = fetch, host = "127.0.0.1", port = 0,
} = {}) {
  const authenticateRun = createProxyEnrollmentAuthenticator({
    controlOrigin, controlCredential, bootEpoch: runtime?.bootEpoch, resolveGrants, resolveRunCredential, fetchImpl,
  });
  const tunnel = createAuthenticatedTunnelServer({ tls, runtime, authenticateRun, host, port });
  try {
    await tunnel.listening;
    return tunnel;
  } catch (error) {
    await tunnel.close().catch(() => {});
    throw error;
  }
}

/** Start a loopback-only HTTP tunnel helper. Each accepted stream gets fresh enrollment. */
export async function startVmTunnelHelper({ tls, enrollment, runId, proxyHost, proxyPort, host = "127.0.0.1", port = 0,
  now = Date.now, random = Math.random, wait = delay } = {}) {
  const runBasedEnrollment = typeof runId === "string" && /^[0-9a-f-]{36}$/i.test(runId);
  if (!tls || (!runBasedEnrollment && typeof enrollment !== "function")
      || typeof proxyHost !== "string" || !Number.isInteger(proxyPort)) {
    throw new TypeError("VM tunnel helper requires TLS, enrollment and proxy address");
  }
  const sockets = new Set();
  const server = createTcpServer((local) => {
    sockets.add(local);
    local.pause();
    void (async () => {
      const startedAt = now();
      let attempt = 0;
      while (!local.destroyed) {
        let remote;
        try {
          const grant = runBasedEnrollment ? undefined : await enrollment();
          if (local.destroyed) return;
          if (!runBasedEnrollment && (!grant || typeof grant.token !== "string" || !/^[A-Za-z0-9_-]{32,128}$/.test(grant.token))) throw new Error("fresh enrollment unavailable");
          remote = connectTls({ ...tls, host: proxyHost, port: proxyPort, servername: tls.servername ?? proxyHost, rejectUnauthorized: true });
          sockets.add(remote);
          const connectTimer = setTimeout(() => remote.destroy(new Error("proxy TLS connection timed out")), HANDSHAKE_TIMEOUT_MS);
          try { await once(remote, "secureConnect"); }
          finally { clearTimeout(connectTimer); }
          remote.write(runBasedEnrollment ? `FACTORIZE-TUNNEL/3 ${runId}\n` : `FACTORIZE-TUNNEL/1 ${grant.token}\n`);
          await waitForTunnelAcceptance(remote);
          local.pipe(remote);
          remote.pipe(local);
          local.resume();
          remote.once("close", () => { sockets.delete(remote); local.destroy(); });
          local.once("close", () => remote.destroy());
          return;
        } catch {
          remote?.destroy();
          if (remote) sockets.delete(remote);
          if (local.destroyed) return;
          const elapsed = now() - startedAt;
          const base = elapsed < CONTROL_RETRY_WINDOW_MS
            ? Math.min(1000 * (2 ** Math.min(attempt, 5)), CONTROL_RETRY_MAX_MS)
            : CONTROL_RETRY_SLOW_MS;
          const jittered = Math.round(base * (0.5 + random()));
          const delayMs = Math.max(1, elapsed < CONTROL_RETRY_WINDOW_MS ? Math.min(CONTROL_RETRY_MAX_MS, jittered) : jittered);
          attempt++;
          try { await wait(delayMs); } catch { local.destroy(); return; }
        }
      }
    })();
    const remove = () => { sockets.delete(local); };
    local.once("close", remove);
    local.once("error", remove);
  });
  server.listen(port, host);
  await once(server, "listening");
  const address = server.address();
  return Object.freeze({
    address,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  });
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function waitForTunnelAcceptance(socket) {
  return new Promise((resolve, reject) => {
    let response = Buffer.alloc(0);
    const cleanup = () => {
      clearTimeout(timer);
      socket.removeListener("data", onData);
      socket.removeListener("error", onError);
      socket.removeListener("close", onClose);
    };
    const onError = error => { cleanup(); reject(error); };
    const onClose = () => { cleanup(); reject(new Error("proxy closed before accepting the tunnel")); };
    const onData = chunk => {
      response = Buffer.concat([response, chunk]);
      if (response.length > HANDSHAKE_LIMIT) { cleanup(); reject(new Error("invalid proxy tunnel response")); return; }
      const end = response.indexOf(10);
      if (end < 0) return;
      const accepted = response.subarray(0, end).toString("utf8") === "FACTORIZE-TUNNEL/1 ACCEPTED";
      const trailingData = response.subarray(end + 1);
      cleanup();
      if (!accepted || trailingData.length) reject(new Error("proxy tunnel was rejected"));
      else resolve();
    };
    const timer = setTimeout(() => { cleanup(); socket.destroy(); reject(new Error("proxy tunnel acceptance timed out")); }, HANDSHAKE_TIMEOUT_MS);
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
}
