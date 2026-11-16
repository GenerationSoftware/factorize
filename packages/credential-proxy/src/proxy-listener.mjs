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
    table.set(grant.id, Object.freeze({
      id: grant.id,
      name: typeof grant.name === "string" && grant.name ? grant.name : grant.id,
      description: typeof grant.description === "string" ? grant.description : null,
      origin: grant.origin,
      credential: grant.credential,
    }));
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

function githubCredential(credentials, installationId) {
  if (!/^\d{1,20}$/.test(installationId)) return null;
  const selected = credentials.githubInstallations.find(item => String(item.installationId) === installationId);
  return selected?.available && typeof selected.accessToken === "string" && selected.accessToken
    ? { origin: "https://api.github.com", credential: selected.accessToken, authorization: "bearer" }
    : null;
}

function isGitSmartHttp(path, search) {
  return (path.endsWith("/info/refs") && /(?:^|[?&])service=git-(?:upload|receive)-pack(?:&|$)/.test(search))
    || /\.git\/git-(?:upload|receive)-pack$/.test(path);
}

function providerRoute(pathname, search, credentials) {
  const github = /^\/providers\/github\/([^/]+)(\/.*)?$/.exec(pathname);
  if (github) {
    let installationId;
    try { installationId = decodeURIComponent(github[1]); } catch { return { error: 400 }; }
    const selected = githubCredential(credentials, installationId);
    if (!selected) return { error: 403 };
    const suffix = github[2] ?? "/";
    const git = isGitSmartHttp(suffix, search);
    return { ...selected, origin: git ? "https://github.com" : selected.origin,
      path: suffix, authorization: git ? "github-git-basic" : "bearer" };
  }
  if (/^\/providers\/linear(?:\/|$)/.test(pathname)) {
    const selected = credentials.linearConnection;
    if (!selected?.available || typeof selected.accessToken !== "string" || !selected.accessToken) return { error: 403 };
    return { origin: "https://api.linear.app", credential: selected.accessToken, authorization: "bearer", path: pathname.slice("/providers/linear".length) || "/" };
  }
  return null;
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
  let grants = grantTable(connection.grants);
  let providerCredentials = connection.providerCredentials ?? { githubInstallations: [], linearConnection: null };
  let unlocked = true;
  let lockedMetadata = [];
  const controllers = new Set();
  let closed = false;
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
      if (parsed.pathname === "/integrations") {
        if (request.method !== "GET") {
          response.writeHead(405, { allow: "GET", "cache-control": "no-store" }).end();
          return;
        }
        const visibleGrants = unlocked ? [...grants.values()] : lockedMetadata;
        const integrations = visibleGrants.map(grant => {
          const path = `/integrations/${encodeURIComponent(grant.id)}/`;
          return {
            id: grant.id,
            source: "portable",
            name: grant.name,
            description: grant.description,
            endpoint: path,
            example: `curl "$FACTORIZE_PROXY_URL${path}"`,
            availability: unlocked ? "available" : "locked",
          };
        });
        const providers = unlocked ? {
          githubInstallations: providerCredentials.githubInstallations.filter(item => item.available).map(item => ({ installationId: item.installationId, endpoint: `/providers/github/${item.installationId}/` })),
          linear: providerCredentials.linearConnection?.available ? { endpoint: "/providers/linear/" } : null,
        } : { githubInstallations: [], linear: null };
        response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        response.end(JSON.stringify({ state: unlocked ? "unlocked" : "locked", integrations, providers }));
        return;
      }
      if (!unlocked) {
        response.writeHead(423, { "cache-control": "no-store" }).end();
        return;
      }
      const provider = providerRoute(parsed.pathname, parsed.search, providerCredentials);
      let integration;
      let suffix;
      if (provider) {
        if (provider.error) { response.writeHead(provider.error).end(); return; }
        integration = provider;
        suffix = provider.path;
      } else {
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
        integration = grants.get(integrationId);
        suffix = match[2] ?? "/";
      }
      if (!integration) {
        response.writeHead(403).end();
        return;
      }
      if (!unlocked) {
        response.writeHead(404).end();
        return;
      }
      const target = requestTarget(integration.origin, suffix, parsed.search);
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
    lock() {
      if (closed || !unlocked) return;
      unlocked = false;
      lockedMetadata = [...grants.values()].map(({ id, name, description }) => ({ id, name, description }));
      grants = new Map();
      providerCredentials = { githubInstallations: [], linearConnection: null };
      for (const controller of controllers) controller.abort(new Error("proxy locked"));
    },
    getProviderCredentials() {
      return structuredClone(providerCredentials);
    },
    replaceGrants(nextGrants) {
      if (closed) return;
      grants = grantTable(nextGrants);
      unlocked = true;
      lockedMetadata = [];
    },
    replaceProviderCredentials(nextCredentials) {
      if (closed) return;
      providerCredentials = nextCredentials && typeof nextCredentials === "object"
        ? nextCredentials : { githubInstallations: [], linearConnection: null };
    },
    close: () => {
      if (closed) return Promise.resolve();
      closed = true;
      grants = new Map();
      providerCredentials = { githubInstallations: [], linearConnection: null };
      for (const controller of controllers) controller.abort(new Error("authenticated tunnel disconnected"));
      return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  });
}
