import { connect as connectTls, createServer as createTlsServer } from "node:tls";
import { connect as connectTcp, createServer as createTcpServer } from "node:net";
import { once } from "node:events";

const HANDSHAKE_LIMIT = 4096;
const HANDSHAKE_TIMEOUT_MS = 10_000;

function peerIdentity(socket) {
  const certificate = socket.getPeerCertificate();
  if (!socket.authorized || !certificate?.subject?.CN) throw new Error("tunnel client certificate is not authorized");
  return certificate.subject.CN;
}

/**
 * Accept only a TLS client with a trusted VM certificate, consume its one-use
 * enrollment, and bridge that stream to the connection-scoped HTTP listener.
 * The bridge does not expose a shell or arbitrary destination forwarding.
 */
export function createAuthenticatedTunnelServer({ tls, runtime, authenticateEnrollment, host = "127.0.0.1", port = 0 } = {}) {
  if (!tls || !runtime || typeof authenticateEnrollment !== "function") throw new TypeError("tunnel server requires TLS, runtime and enrollment authentication");
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
      if (!match) return reject();
      let listener;
      let target;
      try {
        const connection = await authenticateEnrollment({ token: match[1], vmIdentity: peerIdentity(socket) });
        if (!connection || connection.authenticated !== true || connection.enrollmentConsumed !== true) throw new Error("enrollment was not consumed");
        listener = await runtime.acceptAuthenticatedConnection(connection);
        const address = listener.address;
        target = connectTcp(address.port, address.address);
        await once(target, "connect");
        if (rest.length) target.write(rest);
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

/** Start a loopback-only HTTP tunnel helper. Each accepted stream gets fresh enrollment. */
export async function startVmTunnelHelper({ tls, enrollment, proxyHost, proxyPort, host = "127.0.0.1", port = 0 } = {}) {
  if (!tls || typeof enrollment !== "function" || typeof proxyHost !== "string" || !Number.isInteger(proxyPort)) {
    throw new TypeError("VM tunnel helper requires TLS, enrollment and proxy address");
  }
  const sockets = new Set();
  const server = createTcpServer((local) => {
    sockets.add(local);
    void (async () => {
      let remote;
      try {
        const grant = await enrollment();
        if (!grant || typeof grant.token !== "string" || !/^[A-Za-z0-9_-]{32,128}$/.test(grant.token)) throw new Error("fresh enrollment unavailable");
        remote = connectTls({ ...tls, host: proxyHost, port: proxyPort, servername: tls.servername ?? proxyHost, rejectUnauthorized: true });
        sockets.add(remote);
        const connectTimer = setTimeout(() => remote.destroy(new Error("proxy TLS connection timed out")), HANDSHAKE_TIMEOUT_MS);
        try { await once(remote, "secureConnect"); }
        finally { clearTimeout(connectTimer); }
        remote.write(`FACTORIZE-TUNNEL/1 ${grant.token}\n`);
        local.pipe(remote);
        remote.pipe(local);
        local.resume();
        remote.once("close", () => { sockets.delete(remote); local.destroy(); });
        local.once("close", () => remote.destroy());
      } catch {
        local.destroy();
        remote?.destroy();
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
