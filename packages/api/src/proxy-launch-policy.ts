/** Inputs required to decide whether a queued execution may create a guest VM. */
export type ProxyLaunchState = {
  enabled: boolean;
  running: boolean;
  unlocked: boolean;
  pendingChanges: boolean;
};

export type ProxyLaunchJob = {
  executionProvider: "exe" | "fly";
  executionType: "agent" | "code";
  portableIntegrationIds?: readonly string[];
  modelAccess?: "native" | "portable";
  modelAccountId?: string;
};

export type ProxyLaunchDecision =
  | { kind: "allow" }
  | { kind: "start_locked" }
  | { kind: "blocked"; reason: "proxy_disabled" | "proxy_unavailable" | "proxy_locked" | "pending_changes"; retry: "manual" };

export class ProxyLaunchBlockedError extends Error {
  constructor(readonly reason: Extract<ProxyLaunchDecision, { kind: "blocked" }>["reason"]) {
    super(`Job launch is blocked until proxy prerequisite is resolved: ${reason}`);
    this.name = "ProxyLaunchBlockedError";
  }
}

export function requireProxyLaunch(decision: ProxyLaunchDecision): void {
  if (decision.kind === "blocked") throw new ProxyLaunchBlockedError(decision.reason);
}

/**
 * Encodes the GEN-2824 launch gate. This function is deliberately side-effect
 * free: the scheduler must persist a blocked decision and wait for an explicit
 * retry instead of treating a later unlock as a queued launch signal.
 */
export function proxyLaunchDecision(job: ProxyLaunchJob, proxy: ProxyLaunchState): ProxyLaunchDecision {
  const needsUserCredentials = Boolean(job.portableIntegrationIds?.length)
    || job.modelAccess === "portable"
    || Boolean(job.modelAccountId);

  // exe.dev-native integrations keep their existing launch behavior.
  if (job.executionProvider === "exe" && !needsUserCredentials) return { kind: "allow" };

  if (!proxy.enabled) return { kind: "blocked", reason: "proxy_disabled", retry: "manual" };

  // Only code jobs with Factorize access may automatically boot a stopped
  // proxy, and that boot is always locked.
  if (!needsUserCredentials && job.executionType === "code") {
    if (!proxy.running) return { kind: "start_locked" };
    return { kind: "allow" };
  }

  // User credential grants require an already-running proxy with edits
  // applied and a user unlock. Unlocking alone does not resume this run.
  if (!proxy.running) return { kind: "blocked", reason: "proxy_unavailable", retry: "manual" };
  if (proxy.pendingChanges) return { kind: "blocked", reason: "pending_changes", retry: "manual" };
  if (!proxy.unlocked) return { kind: "blocked", reason: "proxy_locked", retry: "manual" };
  return { kind: "allow" };
}
