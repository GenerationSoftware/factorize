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
    let responseStream;
    const agent = new https.Agent({ keepAlive: false });
    agent.createConnection = () => socket;
    const finishError = (error) => {
      if (settled) {
        responseStream?.destroy(error);
        return;
      }
      settled = true;
      clearTimeout(responseTimer);
      clearTimeout(idleTimer);
      socket.destroy(error);
      agent.destroy();
      reject(error);
    };
    const request = https.request(url, {
      method,
      headers,
      agent,
      maxHeaderSize: limits.headerBytes,
      signal,
    }, (response) => {
      clearTimeout(responseTimer);
      let responseBytes = 0;
      const resetIdle = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => responseStream.destroy(new Error("upstream response idle deadline exceeded")), limits.idleMs);
        idleTimer.unref?.();
      };
      responseStream = new Transform({
        transform(chunk, _encoding, callback) {
          responseBytes += chunk.length;
          if (responseBytes > limits.responseBytes) return callback(new RangeError("upstream response exceeds configured limit"));
          resetIdle();
          callback(null, chunk);
        },
      });
      response.once("error", (error) => responseStream.destroy(error));
      responseStream.once("error", (error) => {
        response.destroy(error);
        request.destroy(error);
      });
      responseStream.once("close", () => clearTimeout(idleTimer));
      responseStream.once("close", () => agent.destroy());
      if (response.statusCode >= 300 && response.statusCode < 400) {
        response.resume();
        return finishError(new Error("upstream redirects are not permitted"));
      }
      resetIdle();
      response.pipe(responseStream);
      settled = true;
      resolve({ status: response.statusCode, headers: response.headers, body: responseStream });
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
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
        active.delete(key);
      };
      try {
        const connect = connectorFactory(integration.origin, { timeoutMs: limits.connectMs });
        const { socket, url } = await connect(input.url);
        if (controller.signal.aborted) {
          socket.destroy(controller.signal.reason);
          throw controller.signal.reason ?? new Error("request cancelled");
        }
        const method = String(input.method ?? "GET").toUpperCase();
        if (!/^[A-Z!#$%&'*+.^_`|~-]+$/.test(method)) throw new TypeError("invalid HTTP method");
        const headers = safeHeaders(input.headers, integration.credential, limits.headerBytes);
        const result = await request({ socket, url, method, headers, body: input.body, limits, signal: controller.signal });
        if (result?.body && typeof result.body.once === "function") {
          result.body.once("end", release);
          result.body.once("close", release);
          result.body.once("error", release);
        } else release();
        return result;
      } catch (error) {
        release();
        throw error;
      }
    },
    get activeRequests() { return active.size; },
  });
}
