import { describe, expect, it } from "vitest";
import { catchUpOccurrence, nextOccurrence, validateScheduleConfig } from "../src/schedule";

describe("durable schedules", () => {
  it("calculates occurrences in the configured IANA timezone", () => {
    const config = validateScheduleConfig({ cron: "0 9 * * *", timezone: "America/New_York" });
    expect(nextOccurrence(config, new Date("2026-01-15T00:00:00Z")).toISOString()).toBe("2026-01-15T14:00:00.000Z");
    expect(nextOccurrence(config, new Date("2026-07-15T00:00:00Z")).toISOString()).toBe("2026-07-15T13:00:00.000Z");
  });

  it("handles spring-forward and fall-back deterministically", () => {
    const config = validateScheduleConfig({ cron: "30 2 * * *", timezone: "America/New_York" });
    expect(nextOccurrence(config, new Date("2026-03-08T00:00:00Z")).toISOString()).toBe("2026-03-08T07:30:00.000Z");
    expect(nextOccurrence(config, new Date("2026-11-01T00:00:00Z")).toISOString()).toBe("2026-11-01T07:30:00.000Z");
  });

  it("rejects invalid cron and timezone values", () => {
    expect(() => validateScheduleConfig({ cron: "nope", timezone: "UTC" })).toThrow(/cron/);
    expect(() => validateScheduleConfig({ cron: "0 * * * *", timezone: "Mars/Olympus" })).toThrow(/IANA/);
  });

  it("coalesces any number of missed intervals into one catch-up", () => {
    const config = validateScheduleConfig({ cron: "*/5 * * * *", timezone: "UTC" });
    const result = catchUpOccurrence(config, new Date("2026-09-16T10:00:00Z"), new Date("2026-09-16T11:02:00Z"));
    expect(result?.occurredAt.toISOString()).toBe("2026-09-16T10:00:00.000Z");
    expect(result?.nextRunAt.toISOString()).toBe("2026-09-16T11:05:00.000Z");
  });
});
