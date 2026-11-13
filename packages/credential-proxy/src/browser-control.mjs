import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { createPublicKey, verify } from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 4096;

function decodePart(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid token");
  return Buffer.from(value, "base64url");
}

function parseCapability(token, publicKey) {
  if (typeof token !== "string" || token.length > 4096) throw new Error("invalid capability");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("invalid capability");
  const [headerPart, claimsPart, signaturePart] = parts;
  const header = JSON.parse(decodePart(headerPart).toString("utf8"));
  const claims = JSON.parse(decodePart(claimsPart).toString("utf8"));
  if (header?.alg !== "EdDSA" || header?.typ !== "JWT"
      || !verify(null, Buffer.from(`${headerPart}.${claimsPart}`), publicKey, decodePart(signaturePart))) {
    throw new Error("invalid capability");
  }
  return claims;
}

function json(response, status, body, origin) {
  const headers = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers.Vary = "Origin";
  }
  response.writeHead(status, headers).end(JSON.stringify(body));
}

function publicAuthorization(value) {
  if (!value || typeof value !== "object") return { state: "idle" };
  const result = { state: value.state };
  const challenge = value.challenge;
  if (challenge?.verificationUrl === "https://auth.openai.com/codex/device"
      && typeof challenge.userCode === "string" && (/^[A-Z0-9]{4,6}-[A-Z0-9]{4,6}$/u.test(challenge.userCode) || /^[A-Z0-9]{8,12}$/u.test(challenge.userCode))) {
    result.verificationUrl = challenge.verificationUrl;
    result.userCode = challenge.userCode;
  }
  return result;
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.byteLength;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("request too large"), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Object.assign(new Error("invalid request"), { status: 400 }); }
}

/** Private Fly service endpoint for owner-browser model-account operations.
 * The Fly edge terminates public HTTPS; this listener must only be reachable
 * through that service and never through the agent SSH integration channel. */
export async function startBrowserControl({
  runtime,
  lifecycle,
  publicKey,
  proxyId,
  ownerId,
  generation,
  appOrigin,
  host = "0.0.0.0",
  port = 8080,
  tls,
  prepareUnlock,
  reportStatus,
  applyChanges,
  withLifecycleTransition = work => work(),
  now = () => Math.floor(Date.now() / 1000),
} = {}) {
  if (!runtime || !lifecycle || !publicKey || typeof proxyId !== "string" || !proxyId
      || !UUID.test(ownerId ?? "") || !(Number.isSafeInteger(generation) && generation > 0 || UUID.test(generation ?? ""))
      || !Number.isInteger(port) || port < 0 || port > 65535) {
    throw new TypeError("browser control configuration is invalid");
  }
  const expectedOrigin = new URL(appOrigin);
  if (expectedOrigin.protocol !== "https:" || expectedOrigin.origin !== appOrigin) throw new TypeError("browser control origin must be canonical HTTPS");
  const verifyKey = publicKey?.type === "public" ? publicKey : createPublicKey(publicKey);
  const consumed = new Map();
  const authorizations = new Map();

  const handler = async (request, response) => {
    const origin = request.headers.origin;
    if (origin !== appOrigin) return json(response, 403, { error: "origin_rejected" });
    if (request.method === "OPTIONS") {
      if (request.headers["access-control-request-method"] !== "POST"
          || request.headers["access-control-request-headers"]?.split(",").map(value => value.trim().toLowerCase()).sort().join(",") !== "authorization,content-type") {
        return json(response, 403, { error: "preflight_rejected" });
      }
      response.writeHead(204, {
        "Access-Control-Allow-Origin": appOrigin,
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Max-Age": "60",
        "Cache-Control": "no-store",
        Vary: "Origin",
      }).end();
      return;
    }
    if (request.method !== "POST") return json(response, 405, { error: "method_not_allowed" }, appOrigin);
    const match = /^\/model-accounts\/([0-9a-f-]{36})\/(authorize|status|cancel)$/.exec(new URL(request.url ?? "/", "http://proxy.internal").pathname);
    const proxyMatch = /^\/proxy\/(unlock|lock|apply|status)$/.exec(new URL(request.url ?? "/", "http://proxy.internal").pathname);
    if ((!match || !UUID.test(match[1])) && !proxyMatch) return json(response, 404, { error: "not_found" }, appOrigin);
    const [, accountId, operation] = match ?? [null, undefined, proxyMatch[1]];
    if (request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
      return json(response, 415, { error: "unsupported_media_type" }, appOrigin);
    }
    const authorization = request.headers.authorization ?? "";
    if (!authorization.startsWith("Bearer ")) return json(response, 401, { error: "invalid_capability" }, appOrigin);
    let claims;
    try { claims = parseCapability(authorization.slice(7), verifyKey); }
    catch { return json(response, 401, { error: "invalid_capability" }, appOrigin); }
    const expectedAction = `${proxyMatch ? "proxy" : "model-account"}:${operation}`;
    if (claims.iss !== "factorize" || claims.aud !== proxyId || claims.sub !== ownerId
        || claims.action !== expectedAction || claims.accountId !== accountId || claims.origin !== appOrigin
        || claims.generation !== generation || !Number.isSafeInteger(claims.exp) || claims.exp <= now()
        || claims.exp > now() + 60 || typeof claims.jti !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(claims.jti)) {
      return json(response, 401, { error: "invalid_capability" }, appOrigin);
    }
    for (const [id, expiry] of consumed) if (expiry <= now()) consumed.delete(id);
    if (consumed.has(claims.jti)) return json(response, 401, { error: "capability_replayed" }, appOrigin);
    consumed.set(claims.jti, claims.exp);

    try {
      const body = await readJson(request);
      if (proxyMatch) return await withLifecycleTransition(async () => {
        if (!body || typeof body !== "object" || Array.isArray(body)) return json(response, 400, { error: "invalid_request" }, appOrigin);
        if (operation === "unlock") {
          if (Object.keys(body).join(",") !== "key" || typeof body.key !== "string" || body.key.length > 128 || !prepareUnlock) return json(response, 400, { error: "invalid_request" }, appOrigin);
          try { await runtime.unlockAndPrepare(body.key, () => prepareUnlock(body.key)); }
          catch { return json(response, 403, { error: "unlock_rejected" }, appOrigin); }
          finally { body.key = undefined; }
        } else {
          if (Object.keys(body).length) return json(response, 400, { error: "invalid_request" }, appOrigin);
          if (operation === "lock") await runtime.lock();
          if (operation === "apply") {
            if (runtime.state !== "unlocked") return json(response, 423, { error: "proxy_locked" }, appOrigin);
            await applyChanges?.();
          }
        }
        await reportStatus?.();
        return json(response, 200, { state: runtime.state }, appOrigin);
      });
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length) {
        return json(response, 400, { error: "invalid_request" }, appOrigin);
      }
      if (operation === "authorize") {
        if (runtime.state !== "unlocked") return json(response, 423, { error: "proxy_locked" }, appOrigin);
        const login = await lifecycle.deviceLogin(accountId);
        const state = { state: "pending", challenge: login.challenge };
        authorizations.set(accountId, state);
        Promise.resolve(login.completion).then(result => {
          if (authorizations.get(accountId) === state) {
            const next = result?.state === "saved" ? "authorized" : result?.state === "unsaved" ? "authorized-unsaved" : result?.state ?? "reauthentication-required";
            authorizations.set(accountId, { state: next });
          }
        }, () => {
          if (authorizations.get(accountId) === state) authorizations.set(accountId, { state: "failed" });
        });
        return json(response, 202, publicAuthorization(state), appOrigin);
      }
      if (operation === "status") return json(response, 200, publicAuthorization(authorizations.get(accountId)), appOrigin);
      const result = await lifecycle.cancel(accountId);
      authorizations.set(accountId, { state: "canceled" });
      return json(response, 200, { state: result?.state === "idle" ? "idle" : "canceled" }, appOrigin);
    } catch (error) {
      return json(response, Number.isInteger(error?.status) ? error.status : 400,
        { error: "model_account_operation_failed" }, appOrigin);
    }
  };
  const server = tls ? createHttpsServer(tls, handler) : createServer(handler);
  server.on("connect", (_request, socket) => socket.end("HTTP/1.1 405 Method Not Allowed\r\nConnection: close\r\n\r\n"));
  server.on("upgrade", (_request, socket) => socket.destroy());
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => { server.removeListener("error", reject); resolve(); });
  });
  return Object.freeze({
    address: server.address(),
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  });
}
