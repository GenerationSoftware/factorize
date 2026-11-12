/** Global run history retention policy. Keep in sync with the maintenance runbook. */
export const RUN_HISTORY_RETENTION_MS = 14 * 24 * 60 * 60 * 1_000;

export type RetainedRunState = "queued" | "reserved" | "starting" | "running" | "blocked" | "stopping" | "succeeded" | "failed" | "stopped";

/**
 * A run is eligible only after its immutable creation time is older than the
 * fixed cutoff, it has reached a terminal state, and normal finalization and
 * lifecycle automation handoff have completed. A completion date never starts
 * a fresh retention window.
 */
export function isRunEligibleForRetention(input: {
  createdAt: Date | string;
  state: RetainedRunState;
  cleanupComplete: boolean;
  automationHandedOff: boolean;
}, now: Date): boolean {
  const createdAt = input.createdAt instanceof Date ? input.createdAt.getTime() : Date.parse(input.createdAt);
  const currentTime = now.getTime();
  if (!Number.isFinite(createdAt) || !Number.isFinite(currentTime)) throw new TypeError("Retention timestamps must be valid dates");
  if (!input.cleanupComplete || !input.automationHandedOff) return false;
  if (input.state !== "succeeded" && input.state !== "failed" && input.state !== "stopped") return false;
  return createdAt < currentTime - RUN_HISTORY_RETENTION_MS;
}

/** Return the one fixed cutoff shared by a bounded sweep. */
export function runRetentionCutoff(now: Date): Date {
  if (!Number.isFinite(now.getTime())) throw new TypeError("Retention timestamp must be a valid date");
  return new Date(now.getTime() - RUN_HISTORY_RETENTION_MS);
}
