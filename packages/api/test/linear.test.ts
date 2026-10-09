import { afterEach, describe, expect, it, vi } from "vitest";
import { LINEAR_OPTION_QUERIES, LINEAR_PROJECTS_QUERY, isLinearAuthenticationError, refreshLinearToken } from "../src/linear";

afterEach(() => vi.restoreAllMocks());

describe("Linear queries", () => {
  it("keeps the projects lookup small and unnested", () => {
    expect(LINEAR_PROJECTS_QUERY).toContain("projects(first: 50)");
    expect(LINEAR_PROJECTS_QUERY).toContain("id name");
    expect(LINEAR_PROJECTS_QUERY).not.toContain("teams");
    expect(LINEAR_PROJECTS_QUERY).not.toContain("first: 250");
  });

  it("splits trigger options into simple independent queries", () => {
    expect(Object.values(LINEAR_OPTION_QUERIES)).toHaveLength(3);
    for (const query of Object.values(LINEAR_OPTION_QUERIES)) {
      expect(query.match(/first:/g)).toHaveLength(1);
      expect(query).not.toContain("projects");
    }
  });

  it("recognizes Linear's expired-token response variants", () => {
    expect(isLinearAuthenticationError(401, undefined)).toBe(true);
    expect(isLinearAuthenticationError(200, [{ message: "Authentication required, not authenticated" }])).toBe(true);
    expect(isLinearAuthenticationError(200, [{ message: "The access token has expired" }])).toBe(true);
    expect(isLinearAuthenticationError(200, [{ extensions: { code: "UNAUTHENTICATED" } }])).toBe(true);
  });

  it("does not refresh for unrelated Linear errors", () => {
    expect(isLinearAuthenticationError(200, [{ message: "Query too complex", extensions: { code: "BAD_USER_INPUT" } }])).toBe(false);
    expect(isLinearAuthenticationError(403, [{ message: "You do not have permission" }])).toBe(false);
  });

  it("exchanges a refresh token for a fresh Linear token pair", async () => {
    const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ access_token: "access-new", refresh_token: "refresh-new" }));

    await expect(refreshLinearToken("refresh-old", "client-id", "client-secret")).resolves.toEqual({ access_token: "access-new", refresh_token: "refresh-new" });
    const [, init] = request.mock.calls[0];
    expect(String(init?.body)).toBe("grant_type=refresh_token&refresh_token=refresh-old&client_id=client-id&client_secret=client-secret");
  });

  it("asks the user to reconnect when Linear rejects the refresh token", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ error: "invalid_grant" }, { status: 401 }));
    await expect(refreshLinearToken("expired", "client-id", "client-secret")).rejects.toThrow("Reconnect Linear");
  });
});
