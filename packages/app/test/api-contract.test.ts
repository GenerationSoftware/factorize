import { describe, expect, it } from "vitest";
import { API_OPERATIONS, isDeclaredApiOperation } from "../src/api-contract";

describe("versioned API contract", () => {
  it("declares only versioned application endpoints", () => {
    expect(API_OPERATIONS.length).toBeGreaterThan(40);
    expect(API_OPERATIONS.every(([, path]) => path.startsWith("/api/v1/"))).toBe(true);
  });

  it("matches declared parameterized routes and rejects legacy routes", () => {
    expect(isDeclaredApiOperation("GET", "/api/v1/providers/github/installations/42/repositories")).toBe(true);
    expect(isDeclaredApiOperation("POST", "/api/v1/integrations/cloudflare-tail/tail-1/test")).toBe(true);
    expect(isDeclaredApiOperation("GET", "/api" + "/connections/status")).toBe(false);
    expect(isDeclaredApiOperation("GET", "/api/v1/not-declared")).toBe(false);
  });
});
