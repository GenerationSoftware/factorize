import assert from "node:assert/strict";
import test from "node:test";
import { createUnlockVerification, decryptRecord, encryptAfterUnlockVerification, encryptRecord, generateUnlockKey, verifyUnlockKey } from "../src/lib/unlock-crypto.ts";

const key = "fzk1.AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const binding = { ownerId: "owner-vector", recordId: "record-vector", recordType: "integration", destination: "https://api.example.test", revision: 7 };
const vector = { version: 1, algorithm: "A256GCM", nonce: "oKGio6Slpqeoqaqr", ciphertext: "zD4d7Hr-kv60Kj8vOX_XeLVnruqK8LoNWu2elYJASCVrEhv7qecotw" };
const encoder = new TextEncoder();
const text = bytes => new TextDecoder().decode(bytes);

test("fixed version 1 envelope decrypts in Node and generated keys round-trip", async () => {
  assert.equal(text(await decryptRecord(vector, key, binding)), "synthetic vector payload");
  const generated = generateUnlockKey();
  assert.match(generated, /^fzk1\.[A-Za-z0-9_-]{43}$/u);
  const envelope = await encryptRecord(encoder.encode("round trip"), generated, binding);
  assert.equal(text(await decryptRecord(envelope, generated, binding)), "round trip");
});

test("fresh nonces make repeated encryptions differ", async () => {
  const [first, second] = await Promise.all([
    encryptRecord(encoder.encode("same"), key, binding),
    encryptRecord(encoder.encode("same"), key, binding),
  ]);
  assert.notEqual(first.nonce, second.nonce);
  assert.notEqual(first.ciphertext, second.ciphertext);
});

test("wrong key and every authenticated binding change fail closed", async () => {
  await assert.rejects(decryptRecord(vector, "fzk1.AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE", binding));
  for (const field of Object.keys(binding)) {
    const changed = { ...binding, [field]: field === "revision" ? binding.revision + 1 : `${binding[field]}-changed` };
    await assert.rejects(decryptRecord(vector, key, changed), { name: "OperationError" });
  }
});

test("malformed keys and envelopes and unsupported versions are rejected", async () => {
  for (const malformedKey of ["", "fzk1.AA", "fzk1.A".repeat(43), `fzk1.${"A".repeat(42)}!`]) {
    await assert.rejects(encryptRecord(encoder.encode("x"), malformedKey, binding));
  }
  for (const malformed of [null, [], { ...vector, nonce: "***" }, { ...vector, nonce: "AA" }, { ...vector, ciphertext: "AA" }, { ...vector, extra: true }]) {
    await assert.rejects(decryptRecord(malformed, key, binding));
  }
  await assert.rejects(decryptRecord({ ...vector, version: 2 }, key, binding), /Unsupported/u);
});

test("verification records bind the account and generation, and edits verify before encryption", async () => {
  const generation = "00000000-0000-4000-8000-000000000001";
  const record = await createUnlockVerification(key, "owner-1", generation);
  await verifyUnlockKey(key, "owner-1", generation, record);
  await assert.rejects(verifyUnlockKey(key, "owner-2", generation, record));
  await assert.rejects(verifyUnlockKey(key, "owner-1", "00000000-0000-4000-8000-000000000002", record));
  await assert.rejects(verifyUnlockKey("malformed", "owner-1", generation, record));
  const binding = { ownerId: "owner-1", recordId: "record-1", recordType: "integration", destination: "https://api.example.test", revision: 1 };
  await assert.rejects(encryptAfterUnlockVerification("fzk1.AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE", "owner-1", generation, record, new TextEncoder().encode("edit"), binding));
  assert.ok(await encryptAfterUnlockVerification(key, "owner-1", generation, record, new TextEncoder().encode("edit"), binding));
});
