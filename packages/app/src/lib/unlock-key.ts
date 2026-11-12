import { api } from "factorize-api-client";
import { createUnlockVerification, decryptModelAccountCacheRecord, decryptRecord, encryptModelAccountCacheRecord, encryptRecord, generateUnlockKey, verifyUnlockKey } from "./unlock-crypto";
import { messageOf } from "../features/auth/session";

export async function getUnlockVerification(signal?: AbortSignal) {
  const { data, error } = await api.GET("/api/v1/unlock-key/verification", { signal });
  if (!data || error) throw new Error(messageOf(error));
  return data;
}

export async function createUnlockSetup(ownerId: string, key: string, generationId: string) {
  const encryptedVerification = JSON.stringify(await createUnlockVerification(key, ownerId, generationId));
  const { data, error } = await api.POST("/api/v1/unlock-key/verification", { body: { generationId, encryptedVerification } });
  if (!data || error) throw new Error(messageOf(error));
  return data;
}

const base64ToUrl = (value: string) => btoa(atob(value).split("").map(c => c).join("")).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
const urlToBase64 = (value: string) => btoa(Array.from(Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4)), c => c.charCodeAt(0)), c => String.fromCharCode(c)).join(""));
function decodeStoredCiphertext(payload: string) {
  const [nonce, ciphertext, extra] = payload.split(".");
  if (!nonce || !ciphertext || extra !== undefined) throw new TypeError("Malformed stored integration ciphertext");
  return { version: 1 as const, algorithm: "A256GCM" as const, nonce: base64ToUrl(nonce), ciphertext: base64ToUrl(ciphertext) };
}
function encodeStoredCiphertext(envelope: { nonce: string; ciphertext: string }) { return `${urlToBase64(envelope.nonce)}.${urlToBase64(envelope.ciphertext)}`; }

export async function replaceUnlockKeyGeneration(oldKey: string | null, newKey: string, mode: "rotate" | "reset") {
  const { data: snapshot, error: snapshotError } = await api.GET("/api/v1/unlock-key/rotation-snapshot");
  if (!snapshot || snapshotError) throw new Error(messageOf(snapshotError));
  if (mode === "rotate") {
    const { data: current, error } = await api.GET("/api/v1/unlock-key/verification");
    if (!current || error || !current.verification || !oldKey) throw new Error("Enter the current unlock key to rotate it.");
    await verifyUnlockKey(oldKey, current.ownerId, current.verification.generationId, JSON.parse(current.verification.encryptedVerification));
    if (current.verification.generationId !== snapshot.generationId) throw new Error("Unlock key generation changed. Reload and try again.");
  }
  const generationId = crypto.randomUUID();
  const encryptedVerification = JSON.stringify(await createUnlockVerification(newKey, snapshot.ownerId, generationId));
  const records = mode === "reset" ? [] : await Promise.all(snapshot.records.map(async record => {
    if (record.deletedAt || record.encryptedPayload === null) return record;
    let payload: string;
    if (record.kind === "bearer") {
      if (!record.origin) throw new Error("A bearer integration is missing its destination and cannot be rotated safely.");
      const plain = await decryptRecord(decodeStoredCiphertext(record.encryptedPayload), oldKey!, { ownerId: snapshot.ownerId, recordId: record.id, recordType: "bearer", destination: record.origin, revision: record.revision });
      try {
        payload = encodeStoredCiphertext(await encryptRecord(plain, newKey, { ownerId: snapshot.ownerId, recordId: record.id, recordType: "bearer", destination: record.origin, revision: record.revision }));
      } finally { plain.fill(0); }
    } else {
      const plain = await decryptModelAccountCacheRecord(record.encryptedPayload, oldKey!, { ownerId: snapshot.ownerId, recordId: record.id, recordType: "model", destination: "factorize", keyGeneration: snapshot.generationId, revision: record.revision });
      try { payload = await encryptModelAccountCacheRecord(plain, newKey, { ownerId: snapshot.ownerId, recordId: record.id, recordType: "model", destination: "factorize", keyGeneration: generationId, revision: record.revision }); }
      finally { plain.fill(0); }
    }
    return { ...record, encryptedPayload: payload };
  }));
  const changes = mode === "reset" ? [] : await Promise.all(snapshot.changes.map(async change => {
    if (change.encryptedPayload === null) return change;
    let payload: string;
    if (change.kind === "bearer") {
      if (!change.origin) throw new Error("A bearer edit is missing its destination and cannot be rotated safely.");
      const plain = await decryptRecord(decodeStoredCiphertext(change.encryptedPayload), oldKey!, { ownerId: snapshot.ownerId, recordId: change.id, recordType: "bearer", destination: change.origin, revision: change.revision });
      try { payload = encodeStoredCiphertext(await encryptRecord(plain, newKey, { ownerId: snapshot.ownerId, recordId: change.id, recordType: "bearer", destination: change.origin, revision: change.revision })); }
      finally { plain.fill(0); }
    } else {
      if (!change.recordRevision) throw new Error("A model-account edit is missing its revision and cannot be rotated safely.");
      const plain = await decryptModelAccountCacheRecord(change.encryptedPayload, oldKey!, { ownerId: snapshot.ownerId, recordId: change.id, recordType: "model", destination: "factorize", keyGeneration: snapshot.generationId, revision: change.recordRevision });
      try { payload = await encryptModelAccountCacheRecord(plain, newKey, { ownerId: snapshot.ownerId, recordId: change.id, recordType: "model", destination: "factorize", keyGeneration: generationId, revision: change.recordRevision }); }
      finally { plain.fill(0); }
    }
    return { ...change, encryptedPayload: payload };
  }));
  const { data, error } = await api.POST("/api/v1/unlock-key/rotation", { body: {
    expectedGenerationId: snapshot.generationId, generationId, expectedRevision: snapshot.revision,
    encryptedVerification, records, changes,
  } });
  if (!data || error) throw new Error(messageOf(error));
  return data;
}

export { generateUnlockKey, verifyUnlockKey };
