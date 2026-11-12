import { describe, expect, it } from "vitest";
import { flyJobMachineConfig } from "../src/fly-job-machine";

const input = {
  runId: "0904d375-1c40-4274-8a0b-2b5f1d988799",
  operationId: "run:0904d375-1c40-4274-8a0b-2b5f1d988799",
  image: "registry.example.org/jobs/codex:stable",
  region: "iad",
  size: "shared-cpu-2x",
};

describe("Fly job Machine configuration", () => {
  it("records run ownership, uses the selected size, and disables provider restarts", () => {
    expect(flyJobMachineConfig("factorize-user", input)).toEqual({
      image: input.image,
      region: "iad",
      guest: { cpu_kind: "shared", cpus: 2, memory_mb: 2048 },
      metadata: {
        factorize_role: "job",
        factorize_run_id: input.runId,
        factorize_operation_id: input.operationId,
      },
      auto_start: false,
      auto_stop: false,
      restart: { policy: "no" },
    });
  });

  it("rejects malformed ownership and machine sizing before a provider call", () => {
    expect(() => flyJobMachineConfig("invalid/app", input)).toThrow("Invalid Fly app name");
    expect(() => flyJobMachineConfig("factorize-user", { ...input, runId: "../other" })).toThrow("Invalid Fly run identity");
    expect(() => flyJobMachineConfig("factorize-user", { ...input, size: "large" })).toThrow("Invalid Fly execution size");
  });

  it("never places the Fly API credential or Factorize run credential into config", () => {
    const serialized = JSON.stringify(flyJobMachineConfig("factorize-user", input));
    expect(serialized).not.toContain("FACTORIZE_API_TOKEN");
    expect(serialized).not.toContain("fzt_run_");
  });
});
