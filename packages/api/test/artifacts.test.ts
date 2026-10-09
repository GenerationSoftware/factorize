import { describe, expect, it } from "vitest";
import { artifactKey } from "../src/artifacts";

describe("artifactKey", () => {
  it("builds deterministic tenant and run scoped keys", () => {
    expect(artifactKey("tenant 1", "run/1", "native/session.jsonl")).toBe("tenants/tenant%201/runs/run%2F1/native/session.jsonl");
  });
  it("rejects traversal", () => expect(() => artifactKey("t", "r", "../secret")).toThrow("Invalid artifact path"));
});
