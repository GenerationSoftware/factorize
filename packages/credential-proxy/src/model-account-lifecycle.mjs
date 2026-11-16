import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, resolve, sep } from "node:path";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cachePath(root, accountId) {
  if (!UUID.test(accountId ?? "")) throw new TypeError("invalid model account id");
  const base = resolve(root), path = resolve(base, accountId, "auth.json");
  if (!path.startsWith(`${base}${sep}`)) throw new TypeError("invalid model account id");
  return path;
}

/**
 * Keep Codex token refresh inside the proxy. Persistence sends the cache over
 * the authenticated proxy control channel; the API encrypts it with the
 * Factorize server key before writing it to storage.
 */
export function createModelAccountLifecycle({
  authHelper,
  accountHomeRoot = "/var/lib/factorize/codex-accounts",
  getAccount,
  persistEncrypted,
  onUnsaved = () => {},
  retryDelaysMs = [100, 500, 2_000],
  staleRevisionRetries = 3,
  sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms)),
  removeCache = rm,
  readCache = readFile,
  writeCache = writeFile,
  makeDirectory = mkdir,
  readDirectory = readdir,
  replaceFile = rename,
  getEncryptedCache,
} = {}) {
  if (!authHelper || typeof authHelper.invoke !== "function"
      || typeof getAccount !== "function" || typeof persistEncrypted !== "function"
      || !Array.isArray(retryDelaysMs) || retryDelaysMs.length > 5
      || retryDelaysMs.some(ms => !Number.isSafeInteger(ms) || ms < 0 || ms > 30_000)
      || !Number.isSafeInteger(staleRevisionRetries) || staleRevisionRetries < 0 || staleRevisionRetries > 5) {
    throw new TypeError("model account lifecycle configuration is invalid");
  }
  if (getEncryptedCache !== undefined && typeof getEncryptedCache !== "function") {
    throw new TypeError("model account cache restoration configuration is invalid");
  }

  const generations = new Map();
  const queues = new Map();
  const unsaved = new Set();
  const lastCredentialRefresh = new Map();
  const currentGeneration = id => generations.get(id) ?? 0;

  function serialize(id, operation) {
    const previous = queues.get(id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    queues.set(id, next);
    return next.finally(() => { if (queues.get(id) === next) queues.delete(id); });
  }

  async function persist(id, generation) {
    let account = await getAccount(id);
    if (!account || account.id !== id || account.kind !== "model" || !Number.isSafeInteger(account.revision)
        || typeof account.ownerId !== "string" || !account.ownerId) {
      throw new Error("model account persistence binding is unavailable");
    }
    const plain = await readCache(cachePath(accountHomeRoot, id));
    if (!Buffer.isBuffer(plain) || plain.byteLength === 0 || plain.byteLength > 65_536) throw new Error("Codex token cache is missing or exceeds its limit");
    const payload = plain.toString("utf8");
    try { if (!JSON.parse(payload) || typeof JSON.parse(payload) !== "object") throw new Error(); }
    catch { plain.fill(0); throw new Error("Codex token cache is invalid"); }
    let staleRetries = 0;
    let attempts = 0;
    try {
      for (;;) {
        if (currentGeneration(id) !== generation) throw new Error("model account changed before token persistence");
        const request = { id, expectedRevision: account.revision, encryptedPayload: payload, idempotencyKey: randomUUID() };
        let retryWithLatestRevision = false;
        for (let attempt = 0; ; attempt++) {
          if (currentGeneration(id) !== generation) throw new Error("model account changed before token persistence");
          attempts++;
          try {
            await persistEncrypted(request);
            unsaved.delete(id);
            onUnsaved({ accountId: id, unsaved: false });
            return { state: "saved" };
          } catch (error) {
            if (error?.code === "stale_revision") {
              if (staleRetries >= staleRevisionRetries) break;
              let latest;
              try { latest = await getAccount(id); }
              catch { throw new Error("model account changed before token persistence"); }
              if (!latest || latest.id !== id || latest.kind !== "model" || !Number.isSafeInteger(latest.revision)
                  || latest.revision <= account.revision || latest.ownerId !== account.ownerId
                  ) {
                throw new Error("model account changed before token persistence");
              }
              account = latest;
              staleRetries++;
              retryWithLatestRevision = true;
              break;
            }
            if (attempt >= retryDelaysMs.length) {
              unsaved.add(id);
              onUnsaved({ accountId: id, unsaved: true });
              return { state: "unsaved", attempts };
            }
            await sleep(retryDelaysMs[attempt]);
            if (currentGeneration(id) !== generation) throw new Error("model account changed before token persistence");
            let latest;
            try { latest = await getAccount(id); }
            catch { throw new Error("model account changed before token persistence"); }
            if (!latest || latest.id !== id || latest.kind !== "model" || latest.ownerId !== account.ownerId
                ) {
              throw new Error("model account changed before token persistence");
            }
          }
        }
        if (!retryWithLatestRevision) {
          unsaved.add(id);
          onUnsaved({ accountId: id, unsaved: true });
          return { state: "unsaved", attempts };
        }
      }
    } finally {
      plain.fill(0);
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
      return { state: "pending", challenge: result.challenge, completion };
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
      lastCredentialRefresh.delete(id);
      onUnsaved({ accountId: id, unsaved: false });
      return { state: "deleted" };
    });
  }

  async function restore(id) {
    if (!getEncryptedCache) throw new Error("model account cache restoration is unavailable");
    const account = await getAccount(id);
    if (!account || account.id !== id || account.kind !== "model" || !Number.isSafeInteger(account.revision)
        || typeof account.ownerId !== "string" || !account.ownerId) {
      await removeCache(resolve(accountHomeRoot, id), { recursive: true, force: true });
      return { state: "reauthentication-required" };
    }
    const saved = await getEncryptedCache(id);
    if (!saved || saved.accountId !== id || saved.ownerId !== account.ownerId
        || !Number.isSafeInteger(saved.revision) || typeof saved.payload !== "string") {
      await removeCache(resolve(accountHomeRoot, id), { recursive: true, force: true });
      return { state: "reauthentication-required" };
    }
    let plain;
    try {
      plain = new TextEncoder().encode(saved.payload);
      if (plain.byteLength === 0 || plain.byteLength > 65_536 || !JSON.parse(saved.payload) || typeof JSON.parse(saved.payload) !== "object") {
        throw new Error("restored Codex token cache is invalid");
      }
      const destination = cachePath(accountHomeRoot, id);
      await makeDirectory(resolve(accountHomeRoot, id), { recursive: true, mode: 0o700 });
      const temporary = `${destination}.${randomUUID()}.tmp`;
      try {
        await writeCache(temporary, plain, { mode: 0o600, flag: "wx" });
        await replaceFile(temporary, destination);
      } finally {
        await rm(temporary, { force: true });
      }
    } finally {
      plain?.fill(0);
    }
    return { state: "restored", revision: saved.revision };
  }

  async function getAccessCredential(id) {
    const account = await getAccount(id);
    if (!account || account.id !== id || account.kind !== "model") return { available: false };
    let plain;
    try {
      const refreshedAt = lastCredentialRefresh.get(id) ?? 0;
      if (Date.now() - refreshedAt >= 60_000) {
        lastCredentialRefresh.set(id, Date.now());
        let refreshed;
        try { refreshed = await refresh(id); } catch { return { available: false }; }
        if (refreshed.state === "reauthentication-required" || refreshed.state === "deleted") return { available: false };
      }
      plain = await readCache(cachePath(accountHomeRoot, id));
      if (!Buffer.isBuffer(plain) || plain.byteLength === 0 || plain.byteLength > 65_536) return { available: false };
      const auth = JSON.parse(plain.toString("utf8"));
      const accessToken = auth?.tokens?.access_token;
      if (typeof accessToken !== "string" || !accessToken || accessToken.length > 16_384) return { available: false };
      const accountId = auth?.tokens?.account_id ?? auth?.tokens?.chatgpt_account_id;
      return { available: true, accessToken, ...(typeof accountId === "string" && accountId.length <= 512 ? { accountId } : {}) };
    } catch { return { available: false }; }
    finally { plain?.fill(0); }
  }

  async function reconcile(id) {
    return serialize(id, async () => {
      if (!await getAccount(id)) {
        await removeCache(resolve(accountHomeRoot, id), { recursive: true, force: true });
        unsaved.delete(id);
        lastCredentialRefresh.delete(id);
        return { state: "deleted" };
      }
      if (getEncryptedCache) {
        const restored = await restore(id);
        if (restored.state !== "restored") return restored;
      }
      const result = await authHelper.invoke({ method: "account-status", accountId: id });
      return result.state === "authenticated" ? persist(id, currentGeneration(id)) : { state: "reauthentication-required" };
    });
  }

  return Object.freeze({
    deviceLogin,
    cancel,
    refresh,
    deleteAccount,
    restore,
    getAccessCredential,
    reconcile,
    isUnsaved: id => unsaved.has(id),
    /** Remove local auth homes as soon as a server-side disconnect is observed. */
    revokeUnavailable: async accounts => {
      if (!Array.isArray(accounts) || accounts.some(accountId => !UUID.test(accountId ?? "")) || new Set(accounts).size !== accounts.length) {
        throw new TypeError("active model account snapshot is invalid");
      }
      const activeIds = new Set(accounts);
      const entries = await readDirectory(accountHomeRoot, { withFileTypes: true }).catch(error => {
        if (error?.code === "ENOENT") return [];
        throw error;
      });
      const removed = [];
      for (const entry of entries) {
        if (!UUID.test(entry.name) || activeIds.has(entry.name)) continue;
        await deleteAccount(entry.name);
        removed.push(entry.name);
      }
      return removed;
    },
    /** Reconcile a complete server snapshot after unlock. A reset removes every
     * prior model account from that snapshot, so stale local Codex homes must
     * be logged out and removed before any current account is admitted. */
    reconcileAll: async accounts => {
      if (!Array.isArray(accounts) || accounts.some(account => !account || !UUID.test(account.id ?? "") || account.kind !== "model")
          || new Set(accounts.map(account => account.id)).size !== accounts.length) {
        throw new TypeError("model account snapshot is invalid");
      }
      const activeIds = new Set(accounts.map(account => account.id));
      const entries = await readDirectory(accountHomeRoot, { withFileTypes: true }).catch(error => {
        if (error?.code === "ENOENT") return [];
        throw error;
      });
      const removed = [];
      for (const entry of entries) {
        if (!UUID.test(entry.name) || activeIds.has(entry.name)) continue;
        await deleteAccount(entry.name);
        removed.push(entry.name);
      }
      const states = [];
      for (const account of accounts) states.push({ accountId: account.id, ...(await reconcile(account.id)) });
      return { removed, accounts: states };
    },
  });
}

export { cachePath as modelAccountCachePath };
