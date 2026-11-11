import { createServer } from "node:http";
import { createPublicKey, verify } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const MAX_CAPABILITY_SECONDS = 60;
const DEFAULT_BODY_LIMIT = 4096;

function decodePart(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid token");
  return Buffer.from(value, "base64url");
}

function capabilityClaims(token, publicKey, expected, now) {
  try {
    if (typeof token !== "string" || token.length > 4096) return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [head, payload, signature] = parts;
    const header = JSON.parse(decodePart(head));
    const claims = JSON.parse(decodePart(payload));
    if (header.alg !== "EdDSA" || header.typ !== "JWT") return null;
    if (!verify(null, Buffer.from(`${head}.${payload}`), publicKey, decodePart(signature))) return null;
    if (claims.iss !== expected.issuer || claims.aud !== expected.proxyId || claims.action !== "proxy:unlock"
      || claims.origin !== expected.origin || claims.generation !== expected.generation
      || claims.sub !== expected.ownerId || typeof claims.jti !== "string" || !claims.jti
      || !Number.isSafeInteger(claims.exp) || claims.exp <= now || claims.exp > now + MAX_CAPABILITY_SECONDS) return null;
    return claims;
  } catch { return null; }
}

function json(response, status, value, headers = {}) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers });
  response.end(JSON.stringify(value));
}

export function createControlServer({ runtime, proxyId, ownerId, issuer = "factorize", origin, generation, publicKey, now = () => Math.floor(Date.now() / 1000), maxBodyBytes = DEFAULT_BODY_LIMIT, serverFactory = createServer }) {
  if (!runtime || typeof runtime.unlock !== "function" || !proxyId || !ownerId || !origin || !Number.isSafeInteger(generation) || !publicKey) throw new TypeError("proxy control configuration is incomplete");
  const verificationKey = createPublicKey(publicKey);
  const consumed = new Map();
  const handler = async (request, response) => {
    const requestOrigin = request.headers.origin;
    if (request.method === "OPTIONS") {
      if (request.url !== "/unlock" || requestOrigin !== origin || request.headers["access-control-request-method"] !== "POST"
        || (request.headers["access-control-request-headers"] ?? "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean).sort().join(",") !== "authorization,content-type") {
        response.writeHead(403).end(); return;
      }
      response.writeHead(204, { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Vary": "Origin", "Cache-Control": "no-store" }).end();
      return;
    }
    if (request.url !== "/unlock") { response.writeHead(404).end(); return; }
    if (requestOrigin !== origin) { response.writeHead(403).end(); return; }
    const cors = { "Access-Control-Allow-Origin": origin, "Vary": "Origin" };
    if (request.method !== "POST") { response.writeHead(405, { Allow: "POST", ...cors }).end(); return; }
    if (request.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase() !== "application/json") { json(response, 415, { error: "unsupported media type" }, cors); return; }
    const auth = request.headers.authorization ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const claims = capabilityClaims(token, verificationKey, { issuer, proxyId, ownerId, origin, generation }, now());
    if (!claims) { json(response, 401, { error: "invalid capability" }, cors); return; }
    for (const [nonce, expiry] of consumed) if (expiry <= now()) consumed.delete(nonce);
    if (consumed.has(claims.jti)) { json(response, 409, { error: "capability already used" }, cors); return; }
    consumed.set(claims.jti, claims.exp);
    let bytes = 0;
    const chunks = [];
    try {
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > maxBodyBytes) { request.resume(); json(response, 413, { error: "request body exceeds limit" }, cors); return; }
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || typeof body.key !== "string" || body.key.length < 1 || body.key.length > 2048) {
        json(response, 400, { error: "invalid unlock request" }, cors); return;
      }
      try { runtime.unlock(body.key); }
      catch { json(response, 503, { error: "unlock unavailable" }, cors); return; }
      json(response, 200, { unlocked: true }, cors);
    } catch {
      if (!response.headersSent) json(response, 400, { error: "invalid unlock request" }, cors);
    }
  };
  return serverFactory(handler);
}

const identityKeys = ["proxyId", "flyMachineId", "httpsOrigin", "sshFingerprint", "generation"];
function normalizeIdentity(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== [...identityKeys].sort().join(",")
    || identityKeys.slice(0, 4).some(key => typeof value[key] !== "string" || !value[key])
    || !Number.isSafeInteger(value.generation) || value.generation < 1) throw new TypeError("invalid proxy identity");
  return Object.fromEntries(identityKeys.map(key => [key, value[key]]));
}

export async function persistProxyIdentity(path, candidate, { approveReplacement = false } = {}) {
  const next = normalizeIdentity(candidate);
  let previous;
  try { previous = normalizeIdentity(JSON.parse(await readFile(path, "utf8"))); }
  catch (error) { if (error.code !== "ENOENT") throw new Error("stored proxy identity is invalid"); }
  if (previous) {
    if (JSON.stringify(previous) === JSON.stringify(next)) return previous;
    if (!approveReplacement || next.generation !== previous.generation + 1) throw new Error("proxy identity replacement requires explicit owner approval and next generation");
  }
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(next)}\n`, { mode: 0o600, flag: "wx" });
  try { await rename(temporary, path); }
  catch (error) { await import("node:fs/promises").then(fs => fs.rm(temporary, { force: true })); throw error; }
  return next;
}
