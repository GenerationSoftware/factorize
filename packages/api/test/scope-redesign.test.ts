import { describe, expect, it } from "vitest";
import { ACCESS_SCOPES, normalizeScopes } from "../src/access-tokens";
import { accessToken, createdAccessToken } from "../src/settings-contracts";
import { API_ROUTES } from "../src/api-contract";

describe("GEN-2418 permission boundaries", () => {
  it("exposes canonical scopes and rejects retired grants", () => {
    expect(ACCESS_SCOPES).toEqual(["team:read", "team:write", "triggers:read", "triggers:write", "runs:read", "runs:invoke", "runs:start", "runs:cancel", "runs:write", "integrations:read", "integrations:write", "skills:read", "skills:write"]);
    expect(normalizeScopes(["flows:read", "jobs:read", "runs:write"])).toEqual(["runs:write"]);
    expect(ACCESS_SCOPES).not.toContain("flows:read" as never);
  });

  it("returns every issuable scope in created and listed API key metadata", () => {
    const metadata = { id: "key", name: "Integration", scopes: [...ACCESS_SCOPES], created_at: "2026-10-25T00:00:00Z", expires_at: "2026-11-24T00:00:00Z" };
    expect(createdAccessToken.parse({ ...metadata, token: "one-time-secret" }).scopes).toEqual(ACCESS_SCOPES);
    expect(accessToken.parse(metadata).scopes).toEqual(ACCESS_SCOPES);
  });

  it("keeps Team settings separate from trigger and integration writes", () => {
    const scope = (method: string, path: string) => API_ROUTES.find(route => route.method === method && route.path === path)?.scope;
    expect(scope("PUT", "/api/v1/team/run-defaults")).toBe("team:write");
    expect(API_ROUTES.some(route => route.path.startsWith("/api/v1/projects"))).toBe(false);
    expect(scope("POST", "/api/v1/triggers")).toBe("triggers:write");
    expect(scope("PUT", "/api/v1/integrations/exe")).toBe("integrations:write");
    expect(scope("POST", "/api/v1/triggers/{triggerId}/invocations")).toBe("runs:invoke");
    expect(scope("POST", "/api/v1/runs/{runId}/kill")).toBe("runs:cancel");
    expect(scope("GET", "/api/v1/search")).toBe("skills:read+runs:read");
  });
});
