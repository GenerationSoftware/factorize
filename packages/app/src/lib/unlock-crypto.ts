const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const VERSION = 1 as const;
const KEY_PREFIX = "fzk1.";
const SALT = new TextEncoder().encode("factorize.unlock-key.v1");
const INFO = new TextEncoder().encode("factorize.record.aes-256-gcm.v1");
export const UNLOCK_VERIFICATION_TEXT = "factorize-unlock-key-verification-v1";

export type RecordBinding = {
  ownerId: string;
  recordId: string;
  recordType: string;
  destination: string;
  revision: number;
};

export type EncryptedEnvelopeV1 = {
  version: 1;
  algorithm: "A256GCM";
  nonce: string;
  ciphertext: string;
};

const encoder = new TextEncoder();

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decodeBase64Url(value: unknown, label: string): Uint8Array {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/u.test(value)) throw new TypeError(`Malformed ${label}`);
  try {
    const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4));
    const result = Uint8Array.from(binary, character => character.charCodeAt(0));
    if (encodeBase64Url(result) !== value) throw new TypeError(`Malformed ${label}`);
    return result;
  } catch {
    throw new TypeError(`Malformed ${label}`);
  }
}

function validateBinding(binding: RecordBinding): Uint8Array {
  if (!binding || typeof binding !== "object" ||
      [binding.ownerId, binding.recordId, binding.recordType, binding.destination].some(value => typeof value !== "string" || value.length === 0) ||
      !Number.isSafeInteger(binding.revision) || binding.revision < 0) {
    throw new TypeError("Malformed record binding");
  }
  // Fixed-position JSON prevents property order or extra fields changing the AAD representation.
  return encoder.encode(JSON.stringify(["factorize-record-v1", binding.ownerId, binding.recordId, binding.recordType, binding.destination, binding.revision]));
}

function decodeKey(key: string): Uint8Array {
  if (typeof key !== "string" || !key.startsWith(KEY_PREFIX)) throw new TypeError("Malformed unlock key");
  const bytes = decodeBase64Url(key.slice(KEY_PREFIX.length), "unlock key");
  if (bytes.byteLength !== KEY_BYTES) throw new TypeError("Malformed unlock key");
  return bytes;
}

async function deriveAesKey(key: string, usages: KeyUsage[]): Promise<CryptoKey> {
  const bytes = decodeKey(key);
  try {
    const material = await crypto.subtle.importKey("raw", toArrayBuffer(bytes), "HKDF", false, ["deriveKey"]);
    return await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: SALT, info: INFO }, material,
      { name: "AES-GCM", length: 256 }, false, usages);
  } finally {
    bytes.fill(0);
  }
}

/** Generate a 256-bit user-held key encoded as `fzk1.` plus unpadded base64url. */
export function generateUnlockKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(KEY_BYTES));
  return KEY_PREFIX + encodeBase64Url(bytes);
}

/** Encrypt UTF-8 bytes with AES-256-GCM and bind all record identity fields as AAD. */
export async function encryptRecord(plaintext: Uint8Array, key: string, binding: RecordBinding): Promise<EncryptedEnvelopeV1> {
  if (!(plaintext instanceof Uint8Array)) throw new TypeError("Plaintext must be bytes");
  const aad = validateBinding(binding);
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const aesKey = await deriveAesKey(key, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: toArrayBuffer(nonce), additionalData: toArrayBuffer(aad), tagLength: 128 }, aesKey, toArrayBuffer(plaintext));
  return { version: VERSION, algorithm: "A256GCM", nonce: encodeBase64Url(nonce), ciphertext: encodeBase64Url(new Uint8Array(ciphertext)) };
}

/** Decrypt a supported envelope; malformed metadata, bindings and authentication fail closed. */
export async function decryptRecord(envelope: unknown, key: string, binding: RecordBinding): Promise<Uint8Array> {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) throw new TypeError("Malformed encrypted envelope");
  const value = envelope as Record<string, unknown>;
  if (value.version !== VERSION) throw new TypeError("Unsupported encrypted envelope version");
  if (value.algorithm !== "A256GCM" || Object.keys(value).sort().join(",") !== "algorithm,ciphertext,nonce,version") {
    throw new TypeError("Malformed encrypted envelope");
  }
  const nonce = decodeBase64Url(value.nonce, "envelope nonce");
  const ciphertext = decodeBase64Url(value.ciphertext, "envelope ciphertext");
  if (nonce.byteLength !== NONCE_BYTES || ciphertext.byteLength < 16) throw new TypeError("Malformed encrypted envelope");
  const aad = validateBinding(binding);
  const aesKey = await deriveAesKey(key, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: toArrayBuffer(nonce), additionalData: toArrayBuffer(aad), tagLength: 128 }, aesKey, toArrayBuffer(ciphertext));
  return new Uint8Array(plaintext);
}

export async function createUnlockVerification(key: string, ownerId: string, generationId: string): Promise<EncryptedEnvelopeV1> {
  return encryptRecord(encoder.encode(UNLOCK_VERIFICATION_TEXT), key, { ownerId, recordId: generationId, recordType: "unlock-verification", destination: "factorize", revision: 0 });
}

export async function verifyUnlockKey(key: string, ownerId: string, generationId: string, encryptedVerification: unknown): Promise<void> {
  const plain = await decryptRecord(encryptedVerification, key, { ownerId, recordId: generationId, recordType: "unlock-verification", destination: "factorize", revision: 0 });
  try {
    if (new TextDecoder().decode(plain) !== UNLOCK_VERIFICATION_TEXT) throw new TypeError("Unlock key does not match this account and key generation");
  } finally { plain.fill(0); }
}

export async function encryptAfterUnlockVerification(key: string, ownerId: string, generationId: string, encryptedVerification: unknown, plaintext: Uint8Array, binding: RecordBinding) {
  await verifyUnlockKey(key, ownerId, generationId, encryptedVerification);
  return encryptRecord(plaintext, key, binding);
}

export async function decryptAfterUnlockVerification(key: string, ownerId: string, generationId: string, encryptedVerification: unknown, envelope: unknown, binding: RecordBinding) {
  await verifyUnlockKey(key, ownerId, generationId, encryptedVerification);
  return decryptRecord(envelope, key, binding);
}
