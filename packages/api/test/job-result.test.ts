import { describe, expect, it } from "vitest";
import { JOB_RESULT_LIMIT, parseTriggerResult } from "../src/job-result";

describe("structured trigger result protocol", () => {
  it("accepts succeeded results with arbitrary JSON outputs", () => {
    expect(parseTriggerResult('{"status":"succeeded","summary":"done","outputs":{"count":2,"nested":{"ok":true}}}'))
      .toEqual({ status: "succeeded", summary: "done", outputs: { count: 2, nested: { ok: true } } });
  });
  it("requires a failure reason and rejects unknown envelope fields", () => {
    expect(() => parseTriggerResult('{"status":"failed"}')).toThrow();
    expect(() => parseTriggerResult('{"status":"succeeded","log":"done"}')).toThrow();
  });
  it("rejects invalid JSON and enforces the byte bound", () => {
    expect(() => parseTriggerResult("{" )).toThrow();
    expect(() => parseTriggerResult(" ".repeat(JOB_RESULT_LIMIT + 1))).toThrow(/64 KiB/);
  });
});
