import { describe, expect, it } from "vitest";
import { isRunEligibleForRetention, runRetentionCutoff, RUN_HISTORY_RETENTION_MS } from "../src/postgres/run-retention";

describe("run history retention eligibility", () => {
  const now = new Date("2026-11-11T12:00:00.000Z");
  const eligible = {
    createdAt: new Date(now.getTime() - RUN_HISTORY_RETENTION_MS - 1),
    state: "succeeded" as const,
    cleanupComplete: true,
    automationHandedOff: true,
  };

  it("uses the immutable creation time and a strict 14-day boundary", () => {
    const boundary = new Date(now.getTime() - RUN_HISTORY_RETENTION_MS);
    expect(isRunEligibleForRetention({ ...eligible, createdAt: boundary }, now)).toBe(false);
    expect(isRunEligibleForRetention({ ...eligible, createdAt: new Date(boundary.getTime() - 1) }, now)).toBe(true);
  });

  it("protects every nonterminal state, including old queued and blocked runs", () => {
    for (const state of ["queued", "reserved", "starting", "running", "blocked", "stopping"] as const) {
      expect(isRunEligibleForRetention({ ...eligible, state }, now), state).toBe(false);
    }
  });

  it("requires resource cleanup and automation handoff to finish", () => {
    expect(isRunEligibleForRetention({ ...eligible, cleanupComplete: false }, now)).toBe(false);
    expect(isRunEligibleForRetention({ ...eligible, automationHandedOff: false }, now)).toBe(false);
  });

  it("uses one fixed cutoff per sweep", () => {
    expect(runRetentionCutoff(now)).toEqual(new Date("2026-10-28T12:00:00.000Z"));
  });

  it("rejects invalid timestamps", () => {
    expect(() => isRunEligibleForRetention({ ...eligible, createdAt: "invalid" }, now)).toThrow(TypeError);
    expect(() => runRetentionCutoff(new Date(Number.NaN))).toThrow(TypeError);
  });
});
