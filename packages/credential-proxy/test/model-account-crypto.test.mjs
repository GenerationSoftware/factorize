import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { decryptModelAccountCache, encryptModelAccountCache } from "../src/model-account-crypto.mjs";

const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const accountId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const otherAccountId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const keyGeneration = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const unlockKey = `fzk1.${randomBytes(32).toString("base64url")}`;
const binding = { ownerId, accountId, keyGeneration, revision: 7 };

test("model account cache round-trips only for its complete owner/account/generation/revision binding", async () => {
  const plaintext = new TextEncoder().encode('{"access_token":"synthetic-model-token"}');
  const encrypted = await encryptModelAccountCache(plaintext, unlockKey, binding);
  assert.equal(encrypted.includes("synthetic-model-token"), false);
  const restored = await decryptModelAccountCache(encrypted, unlockKey, binding);
  assert.deepEqual(restored, plaintext);
  restored.fill(0);
  plaintext.fill(0);

  for (const changed of [
    { ...binding, ownerId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" },
    { ...binding, accountId: otherAccountId },
    { ...binding, keyGeneration: "ffffffff-ffff-4fff-8fff-ffffffffffff" },
    { ...binding, revision: 8 },
  ]) await assert.rejects(decryptModelAccountCache(encrypted, unlockKey, changed));
  await assert.rejects(decryptModelAccountCache(encrypted, `fzk1.${randomBytes(32).toString("base64url")}`, binding));
});

test("model account cache rejects malformed keys, ciphertext, and metadata", async () => {
  const plaintext = new TextEncoder().encode("synthetic-cache");
  await assert.rejects(encryptModelAccountCache(plaintext, "not-an-unlock-key", binding), /malformed unlock key/);
  await assert.rejects(encryptModelAccountCache(plaintext, unlockKey, { ...binding, revision: 0 }), /invalid model account encryption binding/);
  await assert.rejects(decryptModelAccountCache("bad.payload.extra", unlockKey, binding), /malformed model account ciphertext/);
  await assert.rejects(decryptModelAccountCache("AA==.AA==", unlockKey, binding), /malformed model account ciphertext/);
});
