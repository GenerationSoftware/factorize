import { readFile, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cachePath(root, accountId) {
  if (!UUID.test(accountId ?? "")) throw new TypeError("invalid model account id");
  const base = resolve(root), path = resolve(base, accountId, "auth.json");
  if (!path.startsWith(`${base}${sep}`)) throw new TypeError("invalid model account id");
  return path;
}

/**
 * Keep Codex token refresh and encrypted persistence inside the proxy. The
 * persistence callback receives only user-encrypted auth-cache bytes; token
 * JSON and the unlock key never leave this process in plaintext.
 */
export function createModelAccountLifecycle({
  authHelper,
  accountHomeRoot = "/var/lib/factorize/codex-accounts",
  getUnlockKey,
  getAccount,
  encryptCache,
  persistEncrypted,
  onUnsaved = () => {},
  retryDelaysMs = [100, 500, 2_000],
  sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms)),
  removeCache = rm,
  readCache = readFile,
} = {}) {
  if (!authHelper || typeof authHelper.invoke !== "function" || typeof getUnlockKey !== "function"
      || typeof getAccount !== "function" || typeof encryptCache !== "function" || typeof persistEncrypted !== "function"
      || !Array.isArray(retryDelaysMs) || retryDelaysMs.length > 5
      || retryDelaysMs.some(ms => !Number.isSafeInteger(ms) || ms < 0 || ms > 30_000)) {
    throw new TypeError("model account lifecycle configuration is invalid");
  }

  const generations = new Map();
  const queues = new Map();
  const unsaved = new Set();
  const currentGeneration = id => generations.get(id) ?? 0;

  function serialize(id, operation) {
    const previous = queues.get(id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    queues.set(id, next);
    return next.finally(() => { if (queues.get(id) === next) queues.delete(id); });
  }

  async function persist(id, generation) {
    const account = await getAccount(id);
    if (!account || account.id !== id || account.kind !== "model" || !Number.isSafeInteger(account.revision)
        || typeof account.ownerId !== "string" || !account.ownerId || typeof account.keyGeneration !== "string" || !account.keyGeneration) {
      throw new Error("model account persistence binding is unavailable");
    }
    const unlockKey = await getUnlockKey();
    if (typeof unlockKey !== "string" || !unlockKey) throw new Error("proxy is locked");
    const plain = await readCache(cachePath(accountHomeRoot, id));
    if (!Buffer.isBuffer(plain) || plain.byteLength === 0 || plain.byteLength > 65_536) throw new Error("Codex token cache is missing or exceeds its limit");
    let encrypted;
    try {
      encrypted = await encryptCache(new Uint8Array(plain), unlockKey, {
        ownerId: account.ownerId,
        recordId: id,
        recordType: "model",
        destination: "factorize",
        revision: account.revision + 1,
        keyGeneration: account.keyGeneration,
      });
    } finally {
      plain.fill(0);
    }
    if (currentGeneration(id) !== generation) throw new Error("model account changed before token persistence");
    const request = { id, expectedRevision: account.revision, keyGeneration: account.keyGeneration, encryptedPayload: encrypted };
    for (let attempt = 0; ; attempt++) {
      if (currentGeneration(id) !== generation) throw new Error("model account changed before token persistence");
      try {
        await persistEncrypted(request);
        unsaved.delete(id);
        onUnsaved({ accountId: id, unsaved: false });
        return { state: "saved" };
      } catch (error) {
        if (attempt >= retryDelaysMs.length) {
          unsaved.add(id);
          onUnsaved({ accountId: id, unsaved: true });
          return { state: "unsaved", attempts: attempt + 1 };
        }
        await sleep(retryDelaysMs[attempt]);
      }
    }
  }

  async function refresh(id) {
    return serialize(id, async () => {
      const generation = currentGeneration(id);
      const result = await authHelper.invoke({ method: "refresh", accountId: id });
      if (result.state === "reauthentication-required") return result;
      return persist(id, generation);
    });
  }

  async function deviceLogin(id) {
    return serialize(id, async () => {
      const generation = currentGeneration(id);
      const result = await authHelper.invoke({ method: "device-login", accountId: id });
      if (result.state !== "pending" || !result.completion || typeof result.completion.then !== "function") throw new Error("Codex device authorization did not start");
      const completion = Promise.resolve(result.completion).then(async outcome => {
        if (currentGeneration(id) !== generation) return { state: "deleted" };
        if (outcome?.state !== "authorized") return { state: outcome?.state ?? "reauthentication-required" };
        return persist(id, generation);
      });
      return { state: "pending", completion };
    });
  }

  async function cancel(id) {
    return serialize(id, async () => authHelper.invoke({ method: "cancel", accountId: id }));
  }

  async function deleteAccount(id) {
    if (!UUID.test(id ?? "")) throw new TypeError("invalid model account id");
    // Invalidate in-flight save retries immediately; cleanup then waits behind
    // any already running helper process before deleting its cache.
    generations.set(id, currentGeneration(id) + 1);
    return serialize(id, async () => {
      await authHelper.invoke({ method: "cancel", accountId: id }).catch(() => {});
      await authHelper.invoke({ method: "logout", accountId: id }).catch(() => {});
      await removeCache(resolve(accountHomeRoot, id), { recursive: true, force: true });
      unsaved.delete(id);
      onUnsaved({ accountId: id, unsaved: false });
      return { state: "deleted" };
    });
  }

  return Object.freeze({
    deviceLogin,
    cancel,
    refresh,
    deleteAccount,
    isUnsaved: id => unsaved.has(id),
    /** Invoke after encrypted snapshots are reconciled at unlock. */
    reconcile: async id => serialize(id, async () => {
      if (!await getAccount(id)) {
        await removeCache(resolve(accountHomeRoot, id), { recursive: true, force: true });
        unsaved.delete(id);
        return { state: "deleted" };
      }
      const result = await authHelper.invoke({ method: "account-status", accountId: id });
      return result.state === "authenticated" ? persist(id, currentGeneration(id)) : { state: "reauthentication-required" };
    }),
  });
}

export { cachePath as modelAccountCachePath };
