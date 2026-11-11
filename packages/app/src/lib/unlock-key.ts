import { api } from "factorize-api-client";
import { createUnlockVerification, generateUnlockKey, verifyUnlockKey } from "./unlock-crypto";
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

export { generateUnlockKey, verifyUnlockKey };
