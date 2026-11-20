import { describe, expect, it } from "vitest";
import { ApiService } from "../src/flow-service";
import type { Event } from "../src/job-domain";

const existing: Event[] = [{
  id: "10000000-0000-4000-8000-000000000001", triggerId: "20000000-0000-4000-8000-000000000001",
  kind: "schedule", slug: "event-1", enabled: true, config: { cron: "0 * * * *", timezone: "UTC" },
  createdAt: "2026-09-18T00:00:00.000Z", updatedAt: "2026-09-18T00:00:00.000Z",
}];

describe("trigger event identity", () => {
  const normalize = (input: unknown[]) => (new ApiService({} as any, {} as any) as any).normalizedEvents(input, existing) as Event[];

  it("preserves identity when a event is edited without changing kind", () => {
    const event = normalize([{ id: existing[0]!.id, kind: "schedule", enabled: false, config: { cron: "5 * * * *", timezone: "UTC" } }]).find(value => value.kind === "schedule");
    expect(event?.id).toBe(existing[0]!.id);
    expect(event?.createdAt).toBe(existing[0]!.createdAt);
  });

  it("assigns new identity when event kind changes", () => {
    const event = normalize([{ id: existing[0]!.id, kind: "manual", enabled: true, config: {} }]).find(value => value.kind === "manual");
    expect(event?.id).not.toBe(existing[0]!.id);
    expect(event?.kind).toBe("manual");
  });
});
