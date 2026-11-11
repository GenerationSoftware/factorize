import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer as createHttpsServer } from "node:https";
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { once } from "node:events";
import { after, before, test } from "node:test";
import { chromium } from "playwright";

const fixture = new URL("./fixtures/https-pairing/", import.meta.url);
const [key, cert] = await Promise.all([
  readFile(new URL("localhost-key.pem", fixture)),
  readFile(new URL("localhost-cert.pem", fixture)),
]);
const proxyId = "proxy-expected";
const ownerId = "owner-fixture";
const generation = 4;
let capabilitySequence = 0;
const nowSeconds = () => Math.floor(Date.now() / 1000);
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const trustedPublicKey = createPublicKey(publicKey.export({ type: "spki", format: "pem" }));
const signingKey = createPrivateKey(privateKey.export({ type: "pkcs8", format: "pem" }));
const pageHtml = `<!doctype html><script>
window.unlock = async (origin, capability, key) => {
  const response = await fetch(origin + "/unlock", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + capability },
    body: JSON.stringify({ key }),
  });
  return { status: response.status, body: await response.text() };
};
</script>`;

function makeCapability({ aud = proxyId, exp = nowSeconds() + 30, gen = generation } = {}) {
  const header = Buffer.from(JSON.stringify({ alg: "EdDSA", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iss: "factorize", aud, sub: ownerId, action: "proxy:unlock", origin: appOrigin, generation: gen, exp, jti: `jti-${++capabilitySequence}` })).toString("base64url");
  const signingInput = `${header}.${payload}`;
  return `${signingInput}.${sign(null, Buffer.from(signingInput), signingKey).toString("base64url")}`;
}

function checkCapability(token) {
  const [header, payload, signature, extra] = token.split(".");
  if (!header || !payload || !signature || extra) return false;
  const input = `${header}.${payload}`;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    return verify(null, Buffer.from(input), trustedPublicKey, Buffer.from(signature, "base64url"))
      && claims.iss === "factorize" && claims.aud === proxyId && claims.action === "proxy:unlock"
      && claims.sub === ownerId && claims.origin === appOrigin && claims.generation === generation
      && claims.exp > nowSeconds();
  } catch { return false; }
}

function pairIdentity(current, candidate, approve = false) {
  if (JSON.stringify(current) === JSON.stringify(candidate)) return current;
  if (!approve) throw new Error("proxy identity replacement requires explicit owner approval");
  return { ...candidate, generation: current.generation + 1 };
}

let appServer;
let proxyServer;
let evilServer;
let browser;
let appOrigin;
let localProxyOrigin;
let evilOrigin;
let factorizeBodies;
let unlockedKeys;
let preflightOrigins;
let directPostOrigins;

function listen(server) {
  server.listen(0, "127.0.0.1");
  return once(server, "listening");
}

function originOf(server) {
  return `https://localhost:${server.address().port}`;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", chunk => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

before(async () => {
  factorizeBodies = [];
  unlockedKeys = [];
  preflightOrigins = [];
  directPostOrigins = [];
  appServer = createHttpsServer({ key, cert }, async (request, response) => {
    if (request.url === "/") {
      response.writeHead(200, { "Content-Type": "text/html" }).end(pageHtml);
      return;
    }
    if (request.url === "/api/v1/proxy-unlock-capability" && request.method === "POST") {
      factorizeBodies.push(await readBody(request));
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ capability: makeCapability() }));
      return;
    }
    response.writeHead(404).end();
  });
  proxyServer = createHttpsServer({ key, cert }, async (request, response) => {
    const origin = request.headers.origin;
    if (request.method === "OPTIONS") {
      preflightOrigins.push(origin);
      if (origin !== appOrigin || request.headers["access-control-request-method"] !== "POST"
        || request.headers["access-control-request-headers"]?.split(",").map(value => value.trim().toLowerCase()).sort().join(",") !== "authorization,content-type") {
        response.writeHead(403).end();
        return;
      }
      response.writeHead(204, { "Access-Control-Allow-Origin": appOrigin, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Authorization, Content-Type", Vary: "Origin" }).end();
      return;
    }
    directPostOrigins.push(origin);
    if (origin !== appOrigin) { response.writeHead(403).end(); return; }
    response.setHeader("Access-Control-Allow-Origin", appOrigin);
    response.setHeader("Vary", "Origin");
    const token = request.headers.authorization?.replace(/^Bearer /, "");
    if (request.method !== "POST" || request.url !== "/unlock" || !token || !checkCapability(token)) {
      response.writeHead(401, { "Content-Type": "application/json" }).end('{"error":"invalid capability"}');
      return;
    }
    const body = JSON.parse((await readBody(request)).toString());
    if (typeof body.key !== "string" || !body.key) { response.writeHead(400).end(); return; }
    unlockedKeys.push(body.key);
    response.writeHead(200, { "Content-Type": "application/json" }).end('{"unlocked":true}');
  });
  evilServer = createHttpsServer({ key, cert }, (_request, response) => response.writeHead(200, { "Content-Type": "text/html" }).end(pageHtml));
  await Promise.all([listen(appServer), listen(proxyServer), listen(evilServer)]);
  appOrigin = originOf(appServer);
  localProxyOrigin = originOf(proxyServer);
  evilOrigin = originOf(evilServer);
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  await Promise.all([appServer, proxyServer, evilServer].filter(Boolean).map(server => new Promise(resolve => server.close(resolve))));
});

test("direct HTTPS unlock enforces origin, capability and paired identity", async () => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    const appPage = await context.newPage();
    await appPage.goto(appOrigin, { waitUntil: "domcontentloaded", timeout: 5_000 });
    const capability = await appPage.evaluate(async () => {
      const response = await fetch("/api/v1/proxy-unlock-capability", { method: "POST" });
      return (await response.json()).capability;
    });
    const success = await appPage.evaluate(({ origin, token }) => window.unlock(origin, token, "unlock-fixture-key"), { origin: localProxyOrigin, token: capability });
    assert.equal(success.status, 200);
    assert.deepEqual(unlockedKeys, ["unlock-fixture-key"]);
    assert.equal(factorizeBodies.length, 1);
    assert.equal(factorizeBodies[0].length, 0, "Factorize capability issuer must not receive an unlock body");

    const expired = makeCapability({ exp: nowSeconds() - 1 });
    const expiredResult = await appPage.evaluate(({ origin, token }) => window.unlock(origin, token, "must-not-unlock"), { origin: localProxyOrigin, token: expired });
    assert.equal(expiredResult.status, 401);
    const wrongProxy = makeCapability({ aud: "different-proxy" });
    const wrongProxyResult = await appPage.evaluate(({ origin, token }) => window.unlock(origin, token, "must-not-unlock"), { origin: localProxyOrigin, token: wrongProxy });
    assert.equal(wrongProxyResult.status, 401);
    assert.deepEqual(unlockedKeys, ["unlock-fixture-key"]);

    const foreignPage = await context.newPage();
    await foreignPage.goto(evilOrigin, { waitUntil: "domcontentloaded", timeout: 5_000 });
    const beforeForeign = directPostOrigins.length;
    const foreignResult = await foreignPage.evaluate(({ origin, token }) => window.unlock(origin, token, "foreign-origin-key").then(() => "unexpected success", () => "cors-blocked"), { origin: localProxyOrigin, token: capability });
    assert.equal(foreignResult, "cors-blocked");
    assert.equal(preflightOrigins.at(-1), evilOrigin);
    assert.equal(directPostOrigins.length, beforeForeign, "foreign preflight must prevent the unlock POST");

    const current = { proxyId, flyMachineId: "machine-a", sshFingerprint: "SHA256:old", generation };
    const replacement = { proxyId, flyMachineId: "machine-b", sshFingerprint: "SHA256:new", generation };
    assert.throws(() => pairIdentity(current, replacement), /explicit owner approval/);
    assert.deepEqual(pairIdentity(current, replacement, true), { ...replacement, generation: generation + 1 });
  } finally {
    await context.close();
  }
});
