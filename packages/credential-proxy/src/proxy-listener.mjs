import { createServer } from "node:http";
import { pipeline } from "node:stream/promises";
import { createBearerForwarder } from "./bearer-forwarder.mjs";

const RESPONSE_HOP_BY_HOP = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te",
  "trailer", "transfer-encoding", "upgrade",
]);

function grantTable(grants) {
  if (!Array.isArray(grants)) throw new TypeError("authenticated connection grants must be an array");
  const table = new Map();
  for (const grant of grants) {
    if (!grant || typeof grant.id !== "string" || !grant.id || table.has(grant.id)
        || typeof grant.origin !== "string" || typeof grant.credential !== "string" || !grant.credential) {
      throw new TypeError("authenticated connection contains an invalid integration grant");
    }
    table.set(grant.id, Object.freeze({ id: grant.id, origin: grant.origin, credential: grant.credential }));
  }
  return table;
}

function requestTarget(origin, suffix, search) {
  const base = new URL(origin);
  if (base.protocol !== "https:" || base.pathname !== "/" || base.search || base.hash) {
    throw new TypeError("integration grant origin must be an HTTPS origin");
  }
  const path = suffix || "/";
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    throw new TypeError("invalid integration request path");
  }
  return `${base.origin}${path}${search}`;
}

/**
 * Start one loopback HTTP endpoint for a single already-authenticated tunnel
 * connection. The connection's consumed grants are held in this closure and
 * can never be selected or supplied by an HTTP caller.
 */
export async function createAuthenticatedProxyListener({ connection, forwarder = createBearerForwarder(), host = "127.0.0.1", port = 0 } = {}) {
  if (!connection || connection.authenticated !== true || connection.enrollmentConsumed !== true
      || !connection.connectionId || !connection.runId || !connection.vmId) {
    throw new TypeError("proxy listener requires an authenticated consumed connection");
  }
  const grants = grantTable(connection.grants);
  const controllers = new Set();
  const server = createServer(async (request, response) => {
    const controller = new AbortController();
    controllers.add(controller);
    const cancel = () => {
      if (!response.writableEnded) controller.abort(new Error("tunnel request cancelled"));
    };
    request.once("aborted", cancel);
    response.once("close", cancel);
    try {
      const parsed = new URL(request.url ?? "/", "http://proxy.loopback");
      const match = /^\/integrations\/([^/]+)(\/.*)?$/.exec(parsed.pathname);
      if (!match) {
        response.writeHead(404).end();
        return;
      }
      let integrationId;
      try { integrationId = decodeURIComponent(match[1]); } catch {
        response.writeHead(400).end();
        return;
      }
      if (!integrationId || integrationId.includes("/") || integrationId.includes("\\")) {
        response.writeHead(400).end();
        return;
      }
      const integration = grants.get(integrationId);
      if (!integration) {
        response.writeHead(403).end();
        return;
      }
      const target = requestTarget(integration.origin, match[2] ?? "/", parsed.search);
      const result = await forwarder.forward(integration, {
        url: target,
        method: request.method,
        headers: request.headers,
        body: request,
      }, { signal: controller.signal });
      const headers = Object.create(null);
      for (const [name, value] of Object.entries(result.headers ?? {})) {
        if (value !== undefined && !RESPONSE_HOP_BY_HOP.has(name.toLowerCase())) headers[name] = value;
      }
      response.writeHead(result.status, headers);
      await pipeline(result.body, response, { signal: controller.signal });
    } catch (error) {
      if (!response.headersSent && !response.destroyed) {
        response.writeHead(controller.signal.aborted ? 499 : 502, { "content-type": "text/plain; charset=utf-8" });
        response.end(controller.signal.aborted ? "request cancelled" : "upstream request failed");
      } else if (!response.destroyed) response.destroy(error);
    } finally {
      controllers.delete(controller);
      request.removeListener("aborted", cancel);
      response.removeListener("close", cancel);
    }
  });
  server.on("connect", (_request, socket) => { socket.end("HTTP/1.1 405 Method Not Allowed\r\nConnection: close\r\n\r\n"); });
  server.on("upgrade", (_request, socket) => socket.destroy());
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  return Object.freeze({
    connectionId: connection.connectionId,
    address: server.address(),
    close: () => {
      for (const controller of controllers) controller.abort(new Error("authenticated tunnel disconnected"));
      return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  });
}
