import { webcrypto } from "node:crypto";

const KEY_PREFIX = "fzk1.";
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const SALT = new TextEncoder().encode("factorize.unlock-key.v1");
const INFO = new TextEncoder().encode("factorize.record.aes-256-gcm.v1");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function bindingData(binding) {
  if (!binding || typeof binding.ownerId !== "string" || !binding.ownerId
      || !UUID.test(binding.accountId ?? "") || !UUID.test(binding.keyGeneration ?? "")
      || !Number.isSafeInteger(binding.revision) || binding.revision < 1) {
    throw new TypeError("invalid model account encryption binding");
  }
  return new TextEncoder().encode(JSON.stringify([
    "factorize-record-v1", binding.ownerId, binding.accountId, "model", "factorize", binding.keyGeneration, binding.revision,
  ]));
}

async function encryptionKey(unlockKey, usage) {
  if (typeof unlockKey !== "string" || !unlockKey.startsWith(KEY_PREFIX)) throw new TypeError("malformed unlock key");
  const encoded = unlockKey.slice(KEY_PREFIX.length);
  if (!/^[A-Za-z0-9_-]{43}$/.test(encoded)) throw new TypeError("malformed unlock key");
  const raw = Buffer.from(encoded, "base64url");
  if (raw.byteLength !== KEY_BYTES || raw.toString("base64url") !== encoded) throw new TypeError("malformed unlock key");
  try {
    const material = await webcrypto.subtle.importKey("raw", raw, "HKDF", false, ["deriveKey"]);
    return await webcrypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: SALT, info: INFO }, material,
      { name: "AES-GCM", length: 256 }, false, [usage]);
  } finally { raw.fill(0); }
}

function decodeStored(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new TypeError(`malformed ${label}`);
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) throw new TypeError(`malformed ${label}`);
  return new Uint8Array(bytes);
}

/** Encrypt a Codex auth cache for persistence. The cache and unlock key remain in the proxy process. */
export async function encryptModelAccountCache(plaintext, unlockKey, binding) {
  if (!(plaintext instanceof Uint8Array) || plaintext.byteLength === 0 || plaintext.byteLength > 65_536) throw new TypeError("invalid model account cache");
  const aad = bindingData(binding), nonce = webcrypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const key = await encryptionKey(unlockKey, "encrypt");
  const ciphertext = new Uint8Array(await webcrypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: aad, tagLength: 128 }, key, plaintext));
  return `${Buffer.from(nonce).toString("base64")}.${Buffer.from(ciphertext).toString("base64")}`;
}

/** Decrypt only after the selected account, owner, key generation, and revision are verified. */
export async function decryptModelAccountCache(encryptedPayload, unlockKey, binding) {
  if (typeof encryptedPayload !== "string" || encryptedPayload.length > 65_536) throw new TypeError("malformed model account ciphertext");
  const parts = encryptedPayload.split(".");
  if (parts.length !== 2) throw new TypeError("malformed model account ciphertext");
  const nonce = decodeStored(parts[0], "model account nonce"), ciphertext = decodeStored(parts[1], "model account ciphertext");
  if (nonce.byteLength !== NONCE_BYTES || ciphertext.byteLength < 16) throw new TypeError("malformed model account ciphertext");
  const aad = bindingData(binding), key = await encryptionKey(unlockKey, "decrypt");
  try {
    return new Uint8Array(await webcrypto.subtle.decrypt({ name: "AES-GCM", iv: nonce, additionalData: aad, tagLength: 128 }, key, ciphertext));
  } finally { nonce.fill(0); ciphertext.fill(0); }
}
