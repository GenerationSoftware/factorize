import { describe, expect, it } from "vitest";
import { JOB_RESULT_LIMIT, parseJobResult } from "../src/job-result";

describe("structured job result protocol", () => {
  it("accepts succeeded results with arbitrary JSON outputs", () => {
    expect(parseJobResult('{"status":"succeeded","summary":"done","outputs":{"count":2,"nested":{"ok":true}}}'))
      .toEqual({ status: "succeeded", summary: "done", outputs: { count: 2, nested: { ok: true } } });
  });
  it("requires a failure reason and rejects unknown envelope fields", () => {
    expect(() => parseJobResult('{"status":"failed"}')).toThrow();
    expect(() => parseJobResult('{"status":"succeeded","log":"done"}')).toThrow();
  });
  it("rejects invalid JSON and enforces the byte bound", () => {
    expect(() => parseJobResult("{" )).toThrow();
    expect(() => parseJobResult(" ".repeat(JOB_RESULT_LIMIT + 1))).toThrow(/64 KiB/);
  });
});
