import { webcrypto } from "node:crypto";
import { readProxyIntegrationSnapshot } from "./control-client.mjs";

const KEY_PREFIX = "fzk1.";
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const SALT = new TextEncoder().encode("factorize.unlock-key.v1");
const INFO = new TextEncoder().encode("factorize.record.aes-256-gcm.v1");
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function decodeBase64Url(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) throw new TypeError(`malformed ${label}`);
  const bytes = Buffer.from(value, "base64url");
  if (bytes.toString("base64url") !== value) throw new TypeError(`malformed ${label}`);
  return new Uint8Array(bytes);
}

function decodeStoredCiphertext(value) {
  if (typeof value !== "string" || value.length > 65_536) throw new TypeError("malformed integration ciphertext");
  const parts = value.split(".");
  if (parts.length !== 2 || !parts.every(part => /^[A-Za-z0-9+/]+={0,2}$/.test(part))) throw new TypeError("malformed integration ciphertext");
  const nonce = Buffer.from(parts[0], "base64");
  const ciphertext = Buffer.from(parts[1], "base64");
  if (nonce.toString("base64") !== parts[0] || ciphertext.toString("base64") !== parts[1]
      || nonce.byteLength !== NONCE_BYTES || ciphertext.byteLength < 16) throw new TypeError("malformed integration ciphertext");
  return { nonce: new Uint8Array(nonce), ciphertext: new Uint8Array(ciphertext) };
}

function recordAad(ownerId, record) {
  if (typeof ownerId !== "string" || !ownerId || typeof record?.id !== "string" || !record.id
      || typeof record.origin !== "string" || !record.origin || !Number.isSafeInteger(record.revision) || record.revision < 1) {
    throw new TypeError("malformed integration record binding");
  }
  return encoder.encode(JSON.stringify(["factorize-record-v1", ownerId, record.id, "bearer", record.origin, record.revision]));
}

async function deriveKey(key) {
  if (typeof key !== "string" || !key.startsWith(KEY_PREFIX)) throw new TypeError("malformed unlock key");
  const raw = decodeBase64Url(key.slice(KEY_PREFIX.length), "unlock key");
  if (raw.byteLength !== KEY_BYTES) throw new TypeError("malformed unlock key");
  try {
    const material = await webcrypto.subtle.importKey("raw", raw, "HKDF", false, ["deriveKey"]);
    return await webcrypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: SALT, info: INFO }, material,
      { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  } finally {
    raw.fill(0);
  }
}

function validateOrigin(origin) {
  let parsed;
  try { parsed = new URL(origin); } catch { throw new TypeError("invalid integration origin"); }
  if (parsed.protocol !== "https:" || parsed.origin !== origin || parsed.username || parsed.password) throw new TypeError("invalid integration origin");
  return parsed.origin;
}

/**
 * Resolve only the selected bearer records from a current, server-decrypted
 * snapshot. The API supplies ciphertext after removing its own encryption
 * layer; this helper never sends the user's unlock key or plaintext upstream.
 */
export function createDecryptedGrantResolver({ readSnapshot, getUnlockKey, resolveIntegrationIds } = {}) {
  if (typeof readSnapshot !== "function" || typeof getUnlockKey !== "function"
      || (resolveIntegrationIds !== undefined && typeof resolveIntegrationIds !== "function")) throw new TypeError("grant resolver requires snapshot and unlock-key readers");
  return async function resolveGrants(binding) {
    if (!binding || typeof binding.tenantId !== "string" || !binding.tenantId
        || (binding.integrationIds !== undefined && !Array.isArray(binding.integrationIds))) throw new TypeError("invalid run integration selection");
    const requestedIds = binding.integrationIds ?? await resolveIntegrationIds?.(binding);
    if (requestedIds !== undefined && (!Array.isArray(requestedIds) || requestedIds.some(id => typeof id !== "string" || !id)
        || new Set(requestedIds).size !== requestedIds.length)) throw new TypeError("invalid run integration selection");
    if (requestedIds?.length === 0) return [];
    const unlockKey = await getUnlockKey();
    if (typeof unlockKey !== "string" || !unlockKey) throw new Error("proxy is locked");
    const snapshot = await readSnapshot(binding);
    if (!snapshot || !Array.isArray(snapshot.records) || typeof snapshot.ownerId !== "string" || !snapshot.ownerId) throw new Error("integration snapshot is unavailable");
    // Production snapshots are already filtered by the control plane using the
    // active run's immutable selection and grant revision. Local callers may
    // still provide IDs explicitly for additional narrowing.
    const integrationIds = requestedIds ?? snapshot.records.map(record => record?.id);
    if (!Array.isArray(integrationIds) || integrationIds.some(id => typeof id !== "string" || !id)
        || new Set(integrationIds).size !== integrationIds.length) throw new TypeError("invalid run integration selection");
    if (integrationIds.length === 0) {
      if (snapshot.records.length) throw new Error("integration snapshot does not match the run selection");
      return [];
    }
    const selected = new Set(integrationIds);
    const selectedRecords = snapshot.records.filter(record => selected.has(record?.id) && record.kind === "bearer");
    const selectionWasNarrowedLocally = binding.integrationIds !== undefined || resolveIntegrationIds !== undefined;
    if (selectedRecords.length !== selected.size || (!selectionWasNarrowedLocally && snapshot.records.length !== selectedRecords.length)) throw new Error("selected integration is unavailable");
    const aesKey = await deriveKey(unlockKey);
    const grants = [];
    for (const record of selectedRecords) {
      if (record.deletedAt != null) {
        if (record.encryptedPayload !== null) throw new Error("deleted integration snapshot contains ciphertext");
        continue;
      }
      if (typeof record.encryptedPayload !== "string") throw new Error("selected integration is unavailable");
      const origin = validateOrigin(record.origin);
      const { nonce, ciphertext } = decodeStoredCiphertext(record.encryptedPayload);
      const plaintext = new Uint8Array(await webcrypto.subtle.decrypt({ name: "AES-GCM", iv: nonce,
        additionalData: recordAad(snapshot.ownerId, record), tagLength: 128 }, aesKey, ciphertext));
      try {
        const credential = decoder.decode(plaintext);
        if (!credential || credential.length > 16_384 || /[\u0000-\u001f\u007f]/.test(credential)) throw new TypeError("invalid bearer credential");
        grants.push(Object.freeze({ id: record.id, origin, credential }));
      } finally {
        plaintext.fill(0);
        nonce.fill(0);
        ciphertext.fill(0);
      }
    }
    return grants;
  };
}

/** Compose the boot-registered control client, current snapshot reader, and
 * process-local unlock key into the resolver used by authenticated tunnels. */
export function createProxyIntegrationGrantResolver({ runtime, controlOrigin, controlCredential, fetchImpl = fetch } = {}) {
  if (!runtime || typeof runtime.getUnlockKey !== "function") throw new TypeError("proxy runtime does not expose its unlocked key to the grant resolver");
  if (typeof controlOrigin !== "string" || typeof controlCredential !== "string") throw new TypeError("proxy control registration is required");
  return createDecryptedGrantResolver({
    readSnapshot: binding => readProxyIntegrationSnapshot({ controlOrigin, token: controlCredential, binding, fetchImpl }),
    getUnlockKey: () => runtime.getUnlockKey(),
  });
}
