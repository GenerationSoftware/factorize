import { createAuthenticatedProxyListener } from "./proxy-listener.mjs";
import { randomUUID } from "node:crypto";

/**
 * Process-local runtime for decrypted records and authorized tunnel listeners.
 * The transport adapter must pass a connection only after it has consumed and
 * authenticated its enrollment against the current run and proxy boot epoch.
 */

export function createProxyRuntime({ listenerFactory = createAuthenticatedProxyListener, bootEpoch = randomUUID(), grantRefreshIntervalMs = 5_000 } = {}) {
  if (typeof bootEpoch !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(bootEpoch)) {
    throw new TypeError("proxy boot epoch must be a UUID v4");
  }
  let unlockMaterial;
  let state = "locked";
  let shutdown = false;
  let locking = false;
  let grantEpoch = 0;
  const listeners = new Set();
  const listenerRuns = new Map();
  const listenerConnections = new Map();
  const grantRefreshTimers = new Map();
  const revokedRuns = new Set();

  async function closeListeners() {
    const current = [...listeners];
    listeners.clear();
    listenerRuns.clear();
    listenerConnections.clear();
    for (const timer of grantRefreshTimers.values()) clearInterval(timer);
    grantRefreshTimers.clear();
    await Promise.allSettled(current.map((listener) => listener.close()));
  }

  async function lockCurrentListeners() {
        for (const listener of [...listeners]) {
          if (typeof listener.lock === "function") listener.lock();
          else {
            await listener.close().catch(() => {});
            listeners.delete(listener);
            listenerRuns.delete(listener);
            listenerConnections.delete(listener);
            clearInterval(grantRefreshTimers.get(listener));
            grantRefreshTimers.delete(listener);
          }
        }
  }

  async function refreshActiveGrants() {
    const epoch = grantEpoch;
    const current = [...listeners];
    await Promise.allSettled(current.map(async listener => {
      const connection = listenerConnections.get(listener);
      if (!connection || typeof connection.refreshGrants !== "function" || typeof listener.replaceGrants !== "function") return;
      const grants = await connection.refreshGrants();
      if (epoch === grantEpoch && state === "unlocked" && !shutdown && !revokedRuns.has(connection.runId) && listeners.has(listener)) listener.replaceGrants(grants);
    }));
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
      grantEpoch++;
      state = "unlocked";
      void refreshActiveGrants();
    },
    /** Keep access locked until the caller has reconciled the current encrypted
     * snapshot. The preparation callback can read the transient key, but no
     * agent connection can be admitted while it is running. */
    async unlockAndPrepare(key, prepare) {
      if (shutdown) throw new Error("runtime is shutting down");
      if (locking) throw new Error("proxy is locking");
      if (typeof key !== "string" || key.length === 0) throw new TypeError("unlock key must be a non-empty string");
      if (typeof prepare !== "function") throw new TypeError("unlock preparation callback is required");
      unlockMaterial?.fill(0);
      unlockMaterial = Buffer.from(key, "utf8");
      grantEpoch++;
      state = "preparing";
      try {
        await lockCurrentListeners();
        await prepare();
        if (shutdown || locking || state !== "preparing") throw new Error("proxy unlock was interrupted");
        state = "unlocked";
        await refreshActiveGrants();
      } catch (error) {
        unlockMaterial?.fill(0);
        unlockMaterial = undefined;
        if (!shutdown && !locking) state = "locked";
        throw error;
      }
    },
    /** Return a transient copy only to the local grant resolver. */
    getUnlockKey() {
      if (shutdown || locking || !["unlocked", "preparing"].includes(state) || !unlockMaterial) throw new Error("proxy is locked");
      return unlockMaterial.toString("utf8");
    },
    async lock() {
      locking = true;
      grantEpoch++;
      state = "locked";
      unlockMaterial?.fill(0);
      unlockMaterial = undefined;
      try {
        await lockCurrentListeners();
      }
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
      const listener = await listenerFactory({ connection, isUnlocked: () => state === "unlocked" });
      if (state !== "unlocked" || shutdown || revokedRuns.has(connection.runId)) {
        await listener.close();
        throw new Error(revokedRuns.has(connection.runId) ? "run grants have been revoked" : "proxy locked while accepting the connection");
      }
      listeners.add(listener);
      // Keep the run identity beside the listener so a control-plane revocation
      // can tear down every established connection without retaining grants.
      listenerRuns.set(listener, connection.runId);
      listenerConnections.set(listener, connection);
      if (typeof connection.refreshGrants === "function" && typeof listener.replaceGrants === "function") {
        if (!Number.isSafeInteger(grantRefreshIntervalMs) || grantRefreshIntervalMs < 100 || grantRefreshIntervalMs > 60_000) {
          await listener.close();
          listeners.delete(listener);
          listenerRuns.delete(listener);
          listenerConnections.delete(listener);
          throw new TypeError("grant refresh interval is out of bounds");
        }
        let refreshing = false;
        const refresh = async () => {
          if (refreshing || shutdown || locking || state !== "unlocked" || revokedRuns.has(connection.runId)) return;
          refreshing = true;
          const epoch = grantEpoch;
          try {
            const next = await connection.refreshGrants();
            if (epoch === grantEpoch && state === "unlocked" && !shutdown && !revokedRuns.has(connection.runId)) listener.replaceGrants(next);
          } catch {
            // A control-plane outage does not expire established grants. Retry
            // on the next interval; durable revocation has its own monitor.
          } finally { refreshing = false; }
        };
        void refresh();
        const timer = setInterval(refresh, grantRefreshIntervalMs);
        timer.unref?.();
        grantRefreshTimers.set(listener, timer);
      }
      return listener;
    },
    async disconnect(connectionId) {
      const matching = [...listeners].filter((listener) => listener.connectionId === connectionId);
      await Promise.allSettled(matching.map((listener) => listener.close()));
      for (const listener of matching) { listeners.delete(listener); listenerRuns.delete(listener); listenerConnections.delete(listener); clearInterval(grantRefreshTimers.get(listener)); grantRefreshTimers.delete(listener); }
    },
    async revokeRun(runId) {
      if (typeof runId !== "string" || !runId) throw new TypeError("run identity is required for revocation");
      revokedRuns.add(runId);
      const matching = [...listeners].filter((listener) => listenerRuns.get(listener) === runId);
      await Promise.allSettled(matching.map((listener) => listener.close()));
      for (const listener of matching) { listeners.delete(listener); listenerRuns.delete(listener); listenerConnections.delete(listener); clearInterval(grantRefreshTimers.get(listener)); grantRefreshTimers.delete(listener); }
      return matching.length;
    },
    async shutdown() {
      shutdown = true;
      await this.lock();
      await closeListeners();
      state = "stopped";
    },
  });
}
