import { describe, expect, it } from "vitest";
import { flyTriggerMachineConfig } from "../src/fly-job-machine";

const input = {
  runId: "0904d375-1c40-4274-8a0b-2b5f1d988799",
  operationId: "run:0904d375-1c40-4274-8a0b-2b5f1d988799",
  image: "registry.example.org/triggers/codex:stable",
  region: "iad",
  size: "shared-cpu-2x",
};

describe("Fly trigger Machine configuration", () => {
  it("records run ownership, uses the selected size, and disables provider restarts", () => {
    expect(flyTriggerMachineConfig("factorize-user", input)).toEqual({
      image: input.image,
      init: {exec: ["/bin/sh", "-c", "exec sleep infinity"]},
      region: "iad",
      guest: { cpu_kind: "shared", cpus: 2, memory_mb: 2048 },
      metadata: {
        factorize_role: "trigger",
        factorize_run_id: input.runId,
        factorize_operation_id: input.operationId,
      },
      auto_start: false,
      auto_stop: false,
      restart: { policy: "no" },
    });
  });

  it("rejects malformed ownership and machine sizing before a provider call", () => {
    expect(() => flyTriggerMachineConfig("invalid/app", input)).toThrow("Invalid Fly app name");
    expect(() => flyTriggerMachineConfig("factorize-user", { ...input, runId: "../other" })).toThrow("Invalid Fly run identity");
    expect(() => flyTriggerMachineConfig("factorize-user", { ...input, size: "large" })).toThrow("Invalid Fly execution size");
  });

  it("never places the Fly API credential or Factorize run credential into config", () => {
    const serialized = JSON.stringify(flyTriggerMachineConfig("factorize-user", input));
    expect(serialized).not.toContain("FACTORIZE_API_TOKEN");
    expect(serialized).not.toContain("fzt_run_");
  });
});
