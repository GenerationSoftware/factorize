import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { test } from "node:test";
import { createDecryptedGrantResolver, createProxyIntegrationGrantResolver } from "../src/decrypted-grants.mjs";
import { createProxyRuntime } from "../src/runtime.mjs";

const encoder = new TextEncoder();
const salt = encoder.encode("factorize.unlock-key.v1");
const info = encoder.encode("factorize.record.aes-256-gcm.v1");
const ownerId = "owner-fixture";
const unlockKey = `fzk1.${Buffer.from(webcrypto.getRandomValues(new Uint8Array(32))).toString("base64url")}`;

async function encryptCredential({ id, origin, revision, credential }) {
  const raw = Buffer.from(unlockKey.slice("fzk1.".length), "base64url");
  const material = await webcrypto.subtle.importKey("raw", raw, "HKDF", false, ["deriveKey"]);
  const aesKey = await webcrypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt, info }, material,
    { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const nonce = webcrypto.getRandomValues(new Uint8Array(12));
  const additionalData = encoder.encode(JSON.stringify(["factorize-record-v1", ownerId, id, "bearer", origin, revision]));
  const ciphertext = new Uint8Array(await webcrypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData, tagLength: 128 }, aesKey, encoder.encode(credential)));
  return `${Buffer.from(nonce).toString("base64")}.${Buffer.from(ciphertext).toString("base64")}`;
}

test("resolver decrypts only selected active bearer records using the shared record binding", async () => {
  const first = { id: "integration-a", kind: "bearer", origin: "https://api.example.test", revision: 3, deletedAt: null };
  const second = { id: "integration-b", kind: "bearer", origin: "https://other.example.test", revision: 4, deletedAt: null };
  const records = [
    { ...first, encryptedPayload: await encryptCredential({ ...first, credential: "first-token" }) },
    { ...second, encryptedPayload: await encryptCredential({ ...second, credential: "second-token" }) },
    { id: "deleted", kind: "bearer", origin: "https://api.example.test", revision: 5, deletedAt: new Date(), encryptedPayload: "unused" },
  ];
  const resolver = createDecryptedGrantResolver({
    readSnapshot: async () => ({ ownerId, records }),
    getUnlockKey: async () => unlockKey,
  });
  assert.deepEqual(await resolver({ tenantId: "tenant-fixture", integrationIds: ["integration-b"] }), [
    { id: "integration-b", origin: "https://other.example.test", credential: "second-token" },
  ]);
  assert.deepEqual(await resolver({ tenantId: "tenant-fixture", integrationIds: [] }), []);
  const runResolver = createDecryptedGrantResolver({
    readSnapshot: async () => ({ ownerId, records }),
    resolveIntegrationIds: async binding => binding.runId === "run-fixture" ? ["integration-a"] : [],
    getUnlockKey: async () => unlockKey,
  });
  assert.deepEqual(await runResolver({ tenantId: "tenant-fixture", runId: "run-fixture" }), [
    { id: "integration-a", origin: "https://api.example.test", credential: "first-token" },
  ]);
});

test("resolver rejects missing, deleted, ambiguous, malformed, and misbound grants", async () => {
  const record = { id: "integration-a", kind: "bearer", origin: "https://api.example.test", revision: 3, deletedAt: null };
  const encryptedPayload = await encryptCredential({ ...record, credential: "synthetic-token" });
  const resolver = createDecryptedGrantResolver({ readSnapshot: async () => ({ ownerId, records: [{ ...record, encryptedPayload }] }), getUnlockKey: async () => unlockKey });
  await assert.rejects(resolver({ tenantId: "tenant-fixture", integrationIds: ["missing"] }), /unavailable/);
  await assert.rejects(resolver({ tenantId: "tenant-fixture", integrationIds: ["integration-a", "integration-a"] }), /selection/);
  const tampered = createDecryptedGrantResolver({ readSnapshot: async () => ({ ownerId: "other-owner", records: [{ ...record, encryptedPayload }] }), getUnlockKey: async () => unlockKey });
  await assert.rejects(tampered({ tenantId: "tenant-fixture", integrationIds: ["integration-a"] }));
  const locked = createDecryptedGrantResolver({ readSnapshot: async () => ({ ownerId, records: [{ ...record, encryptedPayload }] }), getUnlockKey: async () => undefined });
  await assert.rejects(locked({ tenantId: "tenant-fixture", integrationIds: ["integration-a"] }), /locked/);
});

test("resolver rejects non-HTTPS destinations and invalid credential bytes", async () => {
  const badOrigin = { id: "integration-a", kind: "bearer", origin: "http://api.example.test", revision: 3, deletedAt: null,
    encryptedPayload: await encryptCredential({ id: "integration-a", origin: "http://api.example.test", revision: 3, credential: "token" }) };
  const badOriginResolver = createDecryptedGrantResolver({ readSnapshot: async () => ({ ownerId, records: [badOrigin] }), getUnlockKey: async () => unlockKey });
  await assert.rejects(badOriginResolver({ tenantId: "tenant-fixture", integrationIds: ["integration-a"] }), /integration origin/);
  const badCredential = { ...badOrigin, origin: "https://api.example.test", encryptedPayload: await encryptCredential({ id: "integration-a", origin: "https://api.example.test", revision: 3, credential: "bad\ncredential" }) };
  const badCredentialResolver = createDecryptedGrantResolver({ readSnapshot: async () => ({ ownerId, records: [badCredential] }), getUnlockKey: async () => unlockKey });
  await assert.rejects(badCredentialResolver({ tenantId: "tenant-fixture", integrationIds: ["integration-a"] }), /credential/);
});

test("production grant resolver reads the run-bound snapshot and only decrypts while the runtime is unlocked", async () => {
  const record = { id: "integration-a", kind: "bearer", origin: "https://api.example.test", revision: 3, deletedAt: null };
  const encryptedPayload = await encryptCredential({ ...record, credential: "snapshot-token" });
  const runtime = createProxyRuntime({ bootEpoch: "11111111-1111-4111-8111-111111111111" });
  const requests = [];
  const resolve = createProxyIntegrationGrantResolver({
    runtime,
    controlOrigin: "https://factorize.example",
    controlCredential: `fzc_${"c".repeat(43)}`,
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), authorization: new Headers(init.headers).get("authorization"), body: JSON.parse(init.body) });
      return Response.json({ ownerId, records: [{ ...record, encryptedPayload }] });
    },
  });
  const binding = { runId: "22222222-2222-4222-8222-222222222222", grantRevision: 7 };
  await assert.rejects(resolve(binding), /locked/);
  runtime.unlock(unlockKey);
  assert.deepEqual(await resolve(binding), [{ id: record.id, origin: record.origin, credential: "snapshot-token" }]);
  assert.deepEqual(requests, [{
    url: "https://factorize.example/internal/credential-proxy/integration-snapshot",
    authorization: `Bearer fzc_${"c".repeat(43)}`,
    body: binding,
  }]);
  await runtime.lock();
  await assert.rejects(resolve(binding), /locked/);
  await runtime.shutdown();
});
