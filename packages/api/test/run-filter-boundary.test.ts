import { afterEach, describe, expect, it, vi } from "vitest";
import { protectedApiFetch } from "../src/protected-api";
import { ApiService } from "../src/flow-service";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {} }));
afterEach(() => vi.restoreAllMocks());

describe.each(["REST", "MCP"])("%s run status filters", transport => {
  it.each([undefined, "running", ["running", "succeeded"], ["done", "failed", "stopped"]].map(state => ({ state })))("preserves selected states $state at the service boundary", async ({ state }) => {
    const list = vi.spyOn(ApiService.prototype, "listRuns").mockResolvedValue({ items: [], nextCursor: null });
    const query = new URLSearchParams({ limit: "10" });
    for (const value of state === undefined ? [] : Array.isArray(state) ? state : [state]) query.append("state", value);
    const input = { state, limit: 10 };
    const response = await protectedApiFetch(new Request(`https://example.com${transport === "REST" ? `/api/v1/runs?${query}` : "/mcp"}`, {
      method: transport === "REST" ? "GET" : "POST",
      headers: { Host: "example.com", "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      ...(transport === "MCP" ? { body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_runs", arguments: input } }) } : {}),
    }), { APP_ORIGIN: "https://example.com" } as any, { tenantId: "tenant", userId: "owner", authMethod: "bearer", scopes: ["runs:read"] } as any, {} as any);
    expect(response.status).toBe(200);
    await response.text();
    expect(list).toHaveBeenCalledOnce();
    expect(list.mock.calls[0][0].getAll("state")).toEqual(query.getAll("state"));
    expect(list.mock.calls[0][0].get("limit")).toBe("10");
  });
});
