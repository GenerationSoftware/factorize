import { createAuthenticatedProxyListener } from "./proxy-listener.mjs";
import { randomUUID } from "node:crypto";

/**
 * Process-local runtime for decrypted records and authorized tunnel listeners.
 * The transport adapter must pass a connection only after it has consumed and
 * authenticated its enrollment against the current run and proxy boot epoch.
 */

export function createProxyRuntime({ listenerFactory = createAuthenticatedProxyListener, bootEpoch = randomUUID() } = {}) {
  if (typeof bootEpoch !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(bootEpoch)) {
    throw new TypeError("proxy boot epoch must be a UUID v4");
  }
  let unlockMaterial;
  let state = "locked";
  let shutdown = false;
  let locking = false;
  const listeners = new Set();
  const listenerRuns = new Map();
  const revokedRuns = new Set();

  async function closeListeners() {
    const current = [...listeners];
    listeners.clear();
    listenerRuns.clear();
    await Promise.allSettled(current.map((listener) => listener.close()));
  }

  return Object.freeze({
    // A fresh process identity invalidates enrollments from every prior boot.
    bootEpoch,
    get state() {
      return state;
    },
    unlock(key) {
      if (shutdown) throw new Error("runtime is shutting down");
      if (locking) throw new Error("proxy is locking");
      if (typeof key !== "string" || key.length === 0) throw new TypeError("unlock key must be a non-empty string");
      unlockMaterial?.fill(0);
      unlockMaterial = Buffer.from(key, "utf8");
      state = "unlocked";
    },
    /** Return a transient copy only to the local grant resolver. */
    getUnlockKey() {
      if (shutdown || locking || state !== "unlocked" || !unlockMaterial) throw new Error("proxy is locked");
      return unlockMaterial.toString("utf8");
    },
    async lock() {
      locking = true;
      state = "locked";
      unlockMaterial?.fill(0);
      unlockMaterial = undefined;
      try { await closeListeners(); }
      finally { locking = false; }
    },
    async acceptAuthenticatedConnection(connection) {
      if (shutdown) throw new Error("runtime is shutting down");
      if (state !== "unlocked") throw new Error("proxy is locked");
      if (connection?.bootEpoch !== bootEpoch) throw new Error("enrollment belongs to a different proxy boot");
      if (typeof connection.runId !== "string" || !connection.runId) throw new TypeError("authenticated connection requires a run identity");
      if (revokedRuns.has(connection.runId)) throw new Error("run grants have been revoked");
      // The transport adapter calls this only after atomically consuming and
      // authenticating enrollment. Grants are the consumed, current run state.
      const listener = await listenerFactory({ connection });
      if (state !== "unlocked" || shutdown || revokedRuns.has(connection.runId)) {
        await listener.close();
        throw new Error(revokedRuns.has(connection.runId) ? "run grants have been revoked" : "proxy locked while accepting the connection");
      }
      listeners.add(listener);
      // Keep the run identity beside the listener so a control-plane revocation
      // can tear down every established connection without retaining grants.
      listenerRuns.set(listener, connection.runId);
      return listener;
    },
    async disconnect(connectionId) {
      const matching = [...listeners].filter((listener) => listener.connectionId === connectionId);
      await Promise.allSettled(matching.map((listener) => listener.close()));
      for (const listener of matching) { listeners.delete(listener); listenerRuns.delete(listener); }
    },
    async revokeRun(runId) {
      if (typeof runId !== "string" || !runId) throw new TypeError("run identity is required for revocation");
      revokedRuns.add(runId);
      const matching = [...listeners].filter((listener) => listenerRuns.get(listener) === runId);
      await Promise.allSettled(matching.map((listener) => listener.close()));
      for (const listener of matching) { listeners.delete(listener); listenerRuns.delete(listener); }
      return matching.length;
    },
    async shutdown() {
      shutdown = true;
      await this.lock();
      state = "stopped";
    },
  });
}
