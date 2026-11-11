import https from "node:https";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createOriginConnector } from "./destination-policy.mjs";

export const DEFAULT_FORWARD_LIMITS = Object.freeze({
  connectMs: 10_000,
  headersMs: 60_000,
  idleMs: 120_000,
  requestMs: 15 * 60_000,
  requestBytes: 32 * 1024 * 1024,
  responseBytes: 64 * 1024 * 1024,
  headerBytes: 32 * 1024,
});

const HOP_BY_HOP = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade", "host", "authorization",
  "content-length", "expect",
]);

function safeHeaders(input, credential, maxBytes) {
  const source = input instanceof Headers ? [...input.entries()] : Object.entries(input ?? {});
  const connectionTokens = new Set();
  for (const [name, value] of source) {
    if (name.toLowerCase() === "connection") {
      for (const token of String(value).split(",")) connectionTokens.add(token.trim().toLowerCase());
    }
  }
  const headers = Object.create(null);
  let size = 0;
  for (const [name, value] of source) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower) || lower.startsWith("x-forwarded-") || lower === "forwarded" || connectionTokens.has(lower)) continue;
    const text = Array.isArray(value) ? value.join(", ") : String(value);
    size += Buffer.byteLength(name) + Buffer.byteLength(text) + 4;
    if (size > maxBytes) throw new RangeError("request headers exceed configured limit");
    headers[lower] = text;
  }
  headers.authorization = `Bearer ${credential}`;
  return headers;
}

function byteLimit(limit, label, onLimit) {
  let bytes = 0;
  return new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > limit) {
        onLimit?.();
        callback(new RangeError(`${label} exceeds configured limit`));
      } else callback(null, chunk);
    },
  });
}

function sendHttpsRequest({ socket, url, method, headers, body, limits, signal }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let responseTimer;
    let idleTimer;
    const finishError = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(responseTimer);
      clearTimeout(idleTimer);
      socket.destroy(error);
      reject(error);
    };
    const request = https.request(url, {
      method,
      headers,
      agent: false,
      createConnection: () => socket,
      maxHeaderSize: limits.headerBytes,
      signal,
    }, (response) => {
      clearTimeout(responseTimer);
      let responseBytes = 0;
      const chunks = [];
      const resetIdle = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => finishError(new Error("upstream response idle deadline exceeded")), limits.idleMs);
        idleTimer.unref?.();
      };
      response.on("data", (chunk) => {
        responseBytes += chunk.length;
        if (responseBytes > limits.responseBytes) return finishError(new RangeError("upstream response exceeds configured limit"));
        chunks.push(chunk);
        resetIdle();
      });
      response.once("error", finishError);
      if (response.statusCode >= 300 && response.statusCode < 400) {
        response.resume();
        return finishError(new Error("upstream redirects are not permitted"));
      }
      response.once("end", () => {
        if (settled) return;
        settled = true;
        clearTimeout(idleTimer);
        resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) });
      });
      resetIdle();
    });
    request.once("error", finishError);
    responseTimer = setTimeout(() => finishError(new Error("upstream response headers deadline exceeded")), limits.headersMs);
    responseTimer.unref?.();
    if (!body) request.end();
    else {
      const input = body[Symbol.asyncIterator] ? body : [body];
      pipeline(input, byteLimit(limits.requestBytes, "request body", () => request.destroy()), request, { signal }).catch(finishError);
    }
  });
}

/**
 * Forward one request through a grant selected by authenticated connection state.
 * The caller supplies the decrypted integration record; agent-controlled data
 * cannot select either its credential or origin.
 */
export function createBearerForwarder({ connectorFactory = createOriginConnector, request = sendHttpsRequest, limits = DEFAULT_FORWARD_LIMITS } = {}) {
  const active = new Set();
  return Object.freeze({
    async forward(integration, input, { signal } = {}) {
      if (!integration || typeof integration.origin !== "string" || typeof integration.credential !== "string" || !integration.credential) {
        throw new TypeError("integration grant is unavailable");
      }
      if (active.size >= 16) throw new Error("concurrent request limit exceeded");
      const controller = new AbortController();
      const abort = () => controller.abort(signal?.reason);
      signal?.addEventListener("abort", abort, { once: true });
      const timeout = setTimeout(() => controller.abort(new Error("request duration limit exceeded")), limits.requestMs);
      timeout.unref?.();
      const key = {};
      active.add(key);
      try {
        const connect = connectorFactory(integration.origin, { timeoutMs: limits.connectMs });
        const { socket, url } = await connect(input.url);
        const method = String(input.method ?? "GET").toUpperCase();
        if (!/^[A-Z!#$%&'*+.^_`|~-]+$/.test(method)) throw new TypeError("invalid HTTP method");
        const headers = safeHeaders(input.headers, integration.credential, limits.headerBytes);
        return await request({ socket, url, method, headers, body: input.body, limits, signal: controller.signal });
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
        active.delete(key);
      }
    },
    get activeRequests() { return active.size; },
  });
}
