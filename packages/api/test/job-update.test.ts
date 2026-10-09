import { describe, expect, it } from "vitest";
import { ApiService } from "../src/flow-service";
import type { Trigger } from "../src/job-domain";

const existing: Trigger[] = [{
  id: "10000000-0000-4000-8000-000000000001", jobId: "20000000-0000-4000-8000-000000000001",
  kind: "schedule", slug: "trigger-1", enabled: true, config: { cron: "0 * * * *", timezone: "UTC" },
  createdAt: "2026-09-18T00:00:00.000Z", updatedAt: "2026-09-18T00:00:00.000Z",
}];

describe("job trigger identity", () => {
  const normalize = (input: unknown[]) => (new ApiService({} as any, {} as any) as any).normalizedTriggers(input, existing) as Trigger[];

  it("preserves identity when a trigger is edited without changing kind", () => {
    const trigger = normalize([{ id: existing[0]!.id, kind: "schedule", enabled: false, config: { cron: "5 * * * *", timezone: "UTC" } }]).find(value => value.kind === "schedule");
    expect(trigger?.id).toBe(existing[0]!.id);
    expect(trigger?.createdAt).toBe(existing[0]!.createdAt);
  });

  it("assigns new identity when trigger kind changes", () => {
    const trigger = normalize([{ id: existing[0]!.id, kind: "manual", enabled: true, config: {} }]).find(value => value.kind === "manual");
    expect(trigger?.id).not.toBe(existing[0]!.id);
    expect(trigger?.kind).toBe("manual");
  });
});
