import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Agent, createServer as createHttpsServer, request as httpsRequest } from "node:https";
import { createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile as readFileAgain, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createControlServer, persistProxyIdentity } from "../src/control.mjs";

const fixture = new URL("../../app/test/fixtures/https-pairing/", import.meta.url);
const [key, cert] = await Promise.all([readFile(new URL("localhost-key.pem", fixture)), readFile(new URL("localhost-cert.pem", fixture))]);
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const signingKey = createPrivateKey(privateKey.export({ type: "pkcs8", format: "pem" }));
const verificationKey = publicKey.export({ type: "spki", format: "pem" });
const origin = "https://factorize.example";
const now = 2_000_000_000;
let sequence = 0;

function token({ aud = "proxy-1", sub = "owner-1", exp = now + 30, generation = 2, jti = `nonce-${++sequence}` } = {}) {
  const head = Buffer.from(JSON.stringify({ alg: "EdDSA", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ iss: "factorize", aud, sub, action: "proxy:unlock", origin, generation, exp, jti })).toString("base64url");
  const input = `${head}.${body}`;
  return `${input}.${sign(null, Buffer.from(input), signingKey).toString("base64url")}`;
}

function listen(server) {
  server.listen(0, "127.0.0.1");
  return once(server, "listening");
}

function request(port, agent, { method = "POST", path = "/unlock", requestOrigin = origin, capability = token(), body = { key: "unlock-secret" }, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(`https://localhost:${port}${path}`, { method, agent, headers: { Origin: requestOrigin, Authorization: `Bearer ${capability}`, "Content-Type": "application/json", ...headers } }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, json: () => JSON.parse(Buffer.concat(chunks).toString("utf8")) }));
    });
    req.on("error", reject);
    if (method === "POST" && body !== undefined) req.end(typeof body === "string" ? body : JSON.stringify(body));
    else req.end();
  });
}

test("HTTPS control accepts a one-use paired capability and rejects invalid origin, identity, expiry, audience, replay and key", async () => {
  const unlocked = [];
  const runtime = { unlock(value) { if (value !== "unlock-secret") throw new Error("wrong key"); unlocked.push(value); } };
  const server = createControlServer({ runtime, proxyId: "proxy-1", ownerId: "owner-1", origin, generation: 2, publicKey: verificationKey, now: () => now, serverFactory: handler => createHttpsServer({ key, cert }, handler) });
  await listen(server);
  try {
    const port = server.address().port;
    const agent = new Agent({ rejectUnauthorized: false });
    try {
      const valid = await request(port, agent);
      assert.equal(valid.status, 200);
      assert.deepEqual(await valid.json(), { unlocked: true });
      assert.deepEqual(unlocked, ["unlock-secret"]);
      const replay = await request(port, agent, { capability: token({ jti: "reused" }) });
      const replayAgain = await request(port, agent, { capability: token({ jti: "reused" }) });
      assert.equal(replay.status, 200);
      assert.equal(replayAgain.status, 409);
      for (const capability of [token({ aud: "proxy-other" }), token({ sub: "owner-other" }), token({ exp: now - 1 }), token({ generation: 1 })]) {
        assert.equal((await request(port, agent, { capability })).status, 401);
      }
      assert.equal((await request(port, agent, { requestOrigin: "https://foreign.example" })).status, 403);
      const wrongKey = await request(port, agent, { body: { key: "wrong-key" }, capability: token() });
      assert.equal(wrongKey.status, 503);
      assert.equal(unlocked.length, 2);
      assert.equal((await request(port, agent, { body: { key: "x".repeat(5000) } })).status, 413);
      assert.equal((await request(port, agent, { method: "OPTIONS", body: undefined, headers: { "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization, content-type" } })).status, 204);
      assert.equal((await request(port, agent, { method: "OPTIONS", requestOrigin: "https://foreign.example", body: undefined, headers: { "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization, content-type" } })).status, 403);
    } finally {
      agent.destroy();
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("proxy identity persistence requires explicit approval for replacement", async () => {
  const directory = await mkdtemp(join(tmpdir(), "proxy-identity-"));
  const path = join(directory, "identity.json");
  const current = { proxyId: "proxy-1", flyMachineId: "machine-1", httpsOrigin: "https://proxy.fly.dev", sshFingerprint: "SHA256:one", generation: 1 };
  const replacement = { ...current, flyMachineId: "machine-2", sshFingerprint: "SHA256:two", generation: 2 };
  try {
    await persistProxyIdentity(path, current);
    assert.deepEqual(JSON.parse(await readFileAgain(path, "utf8")), current);
    await assert.rejects(persistProxyIdentity(path, replacement), /explicit owner approval/);
    assert.deepEqual(await persistProxyIdentity(path, replacement, { approveReplacement: true }), replacement);
    assert.deepEqual(JSON.parse(await readFileAgain(path, "utf8")), replacement);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
