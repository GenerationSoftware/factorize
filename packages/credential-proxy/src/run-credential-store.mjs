const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RUN_CREDENTIAL = /^fzt_run_[A-Za-z0-9_-]+_[A-Za-z0-9_-]{43}$/;
const VM_IDENTITY = /^[A-Za-z0-9:._-]{1,255}$/;

/** Scoped run credentials are delivered over the provider's private exec path
 * and retained only in this proxy process. They are never written to disk. */
export function createProxyRunCredentialStore() {
  const credentials = new Map();
  const revoked = new Set();
  return Object.freeze({
    authorize({ runId, vmIdentity, credential } = {}) {
      if (!UUID.test(runId ?? "") || !VM_IDENTITY.test(vmIdentity ?? "") || !RUN_CREDENTIAL.test(credential ?? "")) {
        throw new TypeError("invalid run credential authorization");
      }
      if (revoked.has(runId)) throw new Error("run authorization has been revoked");
      credentials.set(runId, Object.freeze({ vmIdentity, credential }));
      return true;
    },
    resolve(runId, vmIdentity) {
      const entry = credentials.get(runId);
      return !revoked.has(runId) && entry?.vmIdentity === vmIdentity ? entry.credential : undefined;
    },
    revoke(runId) {
      credentials.delete(runId);
      revoked.add(runId);
    },
    clear() {
      credentials.clear();
      revoked.clear();
    },
  });
}
