/**
 * Internal adapter contracts for the follow-up record, enrollment and forwarding
 * slices. This runtime deliberately does not call or implement these adapters.
 *
 * @typedef {object} ProxyAdapters
 * @property {(identity: object) => Promise<unknown[]>} loadRecords
 * @property {(request: object) => Promise<unknown>} createEnrollment
 * @property {(request: object) => Promise<unknown>} forwardRequest
 */

export function createProxyRuntime() {
  let unlockMaterial;
  let state = "locked";
  let shutdown = false;

  return Object.freeze({
    get state() {
      return state;
    },
    unlock(key) {
      if (shutdown) throw new Error("runtime is shutting down");
      if (typeof key !== "string" || key.length === 0) throw new TypeError("unlock key must be a non-empty string");
      unlockMaterial?.fill(0);
      unlockMaterial = Buffer.from(key, "utf8");
      state = "unlocked";
    },
    lock() {
      unlockMaterial?.fill(0);
      unlockMaterial = undefined;
      if (!shutdown) state = "locked";
    },
    shutdown() {
      this.lock();
      shutdown = true;
      state = "stopped";
    },
  });
}
