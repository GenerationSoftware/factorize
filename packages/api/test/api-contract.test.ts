import { describe, expect, it } from "vitest";
import { API_ROUTES, generateOpenApi, matchApiOperation } from "../src/api-contract";

describe("Events and Triggers API contract", () => {
  it("publishes the authorized Event, Trigger, and occurrence operations", () => {
    const routes = API_ROUTES.map(route => `${route.method} ${route.path}`);
    for (const operation of [
      "GET /api/v1/events", "POST /api/v1/events", "GET /api/v1/events/{eventId}",
      "PUT /api/v1/events/{eventId}", "DELETE /api/v1/events/{eventId}",
      "GET /api/v1/events/{eventId}/occurrences", "GET /api/v1/triggers",
      "GET /api/v1/team-permissions", "PUT /api/v1/team-permissions",
      "PUT /api/v1/access/authorizations/{grantId}/permissions",
      "POST /api/v1/triggers", "POST /api/v1/triggers/{triggerId}/fire",
    ]) expect(routes).toContain(operation);
    expect(matchApiOperation("GET", "/api/v1/runs")).toBeUndefined();
    expect(matchApiOperation("GET", "/api/v1/jobs")).toBeUndefined();
    expect(matchApiOperation("GET", "/api/v1/model-accounts")).toBeUndefined();
    const openapi = generateOpenApi();
    expect(Object.keys(openapi.paths)).toEqual([...new Set(API_ROUTES.map(route => route.path))]);
    expect(JSON.stringify(openapi)).not.toMatch(/RunPage|RunDetail|HarnessLog|TraceReplayResult/);
  });
});
