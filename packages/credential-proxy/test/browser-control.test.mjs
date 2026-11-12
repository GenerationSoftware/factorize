import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { startBrowserControl } from "../src/browser-control.mjs";

const ownerId = "11111111-1111-4111-8111-111111111111";
const accountId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const proxyId = "fly:factorize-proxy:machine-1";
const generation = 4;
const appOrigin = "https://factorize.example";
const { publicKey, privateKey } = generateKeyPairSync("ed25519");

function capability({ action, exp = 1_900_000_030, aud = proxyId, sub = ownerId, origin = appOrigin, gen = generation, account = accountId, jti = `nonce-${crypto.randomUUID()}` }) {
  const head = Buffer.from(JSON.stringify({ alg: "EdDSA", typ: "JWT" })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({ iss: "factorize", aud, sub, action, origin, generation: gen, exp, accountId: account, jti })).toString("base64url");
  const input = `${head}.${claims}`;
  return `${input}.${sign(null, Buffer.from(input), privateKey).toString("base64url")}`;
}

test("private browser control requires exact origin and one-use owner/proxy/action capabilities", async t => {
  let now = 1_900_000_000;
  const calls = [];
  const runtime = { state: "unlocked" };
  const lifecycle = {
    async deviceLogin(id) { calls.push(["authorize", id]); return { state: "pending", challenge: { verificationUrl: "https://auth.openai.com/codex/device", userCode: "ABCD-1234" }, completion: Promise.resolve({ state: "saved" }) }; },
    async cancel(id) { calls.push(["cancel", id]); return { state: "canceled" }; },
  };
  const server = await startBrowserControl({ runtime, lifecycle, publicKey, proxyId, ownerId, generation, appOrigin, port: 0, host: "127.0.0.1", now: () => now });
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address.port}`;
  const post = (action, token, path = `/model-accounts/${accountId}/${action.split(":")[1]}`, requestOrigin = appOrigin) => fetch(origin + path, {
    method: "POST", headers: { Origin: requestOrigin, "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: "{}",
  });

  const preflight = await fetch(origin + `/model-accounts/${accountId}/authorize`, {
    method: "OPTIONS", headers: { Origin: appOrigin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type,authorization" },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), appOrigin);
  const foreign = await fetch(origin + `/model-accounts/${accountId}/authorize`, { method: "OPTIONS", headers: { Origin: "https://attacker.example", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type" } });
  assert.equal(foreign.status, 403);
  assert.equal(foreign.headers.get("access-control-allow-origin"), null);

  const authToken = capability({ action: "model-account:authorize" });
  const started = await post("model-account:authorize", authToken);
  assert.equal(started.status, 202);
  assert.deepEqual(await started.json(), { state: "pending", verificationUrl: "https://auth.openai.com/codex/device", userCode: "ABCD-1234" });
  assert.deepEqual(calls[0], ["authorize", accountId]);
  const replay = await post("model-account:authorize", authToken);
  assert.equal(replay.status, 401);

  const status = await post("model-account:status", capability({ action: "model-account:status" }));
  assert.deepEqual(await status.json(), { state: "authorized" });
  const wrongAudience = await post("model-account:cancel", capability({ action: "model-account:cancel", aud: "fly:other:machine" }));
  assert.equal(wrongAudience.status, 401);
  const expired = await post("model-account:cancel", capability({ action: "model-account:cancel", exp: now - 1 }));
  assert.equal(expired.status, 401);
  const wrongOrigin = await post("model-account:cancel", capability({ action: "model-account:cancel" }), undefined, "https://attacker.example");
  assert.equal(wrongOrigin.status, 403);

  const canceled = await post("model-account:cancel", capability({ action: "model-account:cancel" }));
  assert.deepEqual(await canceled.json(), { state: "canceled" });
  assert.deepEqual(calls.at(-1), ["cancel", accountId]);
  now += 61;
});

test("authorization is refused while locked and expiry remains bounded to one minute", async t => {
  const runtime = { state: "locked" };
  const lifecycle = { async deviceLogin() { assert.fail("locked proxy must not start authorization"); }, async cancel() { return { state: "idle" }; } };
  const server = await startBrowserControl({ runtime, lifecycle, publicKey, proxyId, ownerId, generation, appOrigin, port: 0, host: "127.0.0.1", now: () => 1_900_000_000 });
  t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${server.address.port}/model-accounts/${accountId}/authorize`, {
    method: "POST", headers: { Origin: appOrigin, "Content-Type": "application/json", Authorization: `Bearer ${capability({ action: "model-account:authorize", exp: 1_900_000_061 })}` }, body: "{}",
  });
  assert.equal(response.status, 401);
});
