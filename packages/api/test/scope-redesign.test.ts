import { describe, expect, it } from "vitest";
import { ACCESS_SCOPES, normalizeScopes } from "../src/access-tokens";
import { API_ROUTES } from "../src/api-contract";

describe("GEN-2418 permission boundaries", () => {
  it("exposes independently issuable skill scopes and maps legacy grants without issuing them", () => {
    expect(ACCESS_SCOPES).toEqual(["projects:read", "projects:write", "jobs:read", "jobs:write", "runs:read", "runs:invoke", "runs:cancel", "integrations:read", "integrations:write", "skills:read", "skills:write"]);
    expect(normalizeScopes(["flows:read", "runs:write"])).toEqual(["projects:read", "jobs:read", "integrations:read", "runs:read", "runs:invoke", "runs:cancel"]);
    expect(ACCESS_SCOPES).not.toContain("flows:read" as never);
  });

  it("keeps project creation separate from job and integration writes", () => {
    const scope = (method: string, path: string) => API_ROUTES.find(route => route.method === method && route.path === path)?.scope;
    expect(scope("POST", "/api/v1/projects")).toBe("projects:write");
    expect(scope("POST", "/api/v1/jobs")).toBe("jobs:write");
    expect(scope("PUT", "/api/v1/integrations/exe")).toBe("integrations:write");
    expect(scope("POST", "/api/v1/jobs/{jobId}/invocations")).toBe("runs:invoke");
    expect(scope("POST", "/api/v1/runs/{runId}/kill")).toBe("runs:cancel");
    expect(scope("GET", "/api/v1/search")).toBe("jobs:read+runs:read");
  });
});
