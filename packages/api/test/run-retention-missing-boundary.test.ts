import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiService, ServiceError } from "../src/flow-service";
import { protectedApiFetch } from "../src/protected-api";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {} }));
afterEach(() => vi.restoreAllMocks());

const runId = "00000000-0000-4000-8000-000000000001";
const auth = { tenantId: "tenant-a", userId: "owner", authMethod: "bearer", scopes: ["runs:read"] } as any;
const env = { APP_ORIGIN: "https://example.com" } as any;

function request(transport: "REST" | "MCP", pathOrTool: string, args: Record<string, unknown> = {}) {
  const mcp = transport === "MCP";
  return protectedApiFetch(new Request(`https://example.com${mcp ? "/mcp" : pathOrTool}`, {
    method: mcp ? "POST" : "GET",
    headers: { Host: "example.com", "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    ...(mcp ? { body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: pathOrTool, arguments: { runId, ...args } } }) } : {}),
  }), env, auth, {} as any);
}

describe("retained-history missing-run API boundaries", () => {
  it("returns authoritative not_found responses for expired REST reads", async () => {
    vi.spyOn(ApiService.prototype, "getRunStatus").mockRejectedValue(new ServiceError(404, "not_found", "Run not found"));
    vi.spyOn(ApiService.prototype, "getRun").mockRejectedValue(new ServiceError(404, "not_found", "Run not found"));
    vi.spyOn(ApiService.prototype, "getRunDiagnostics").mockRejectedValue(new ServiceError(404, "not_found", "Run not found"));
    vi.spyOn(ApiService.prototype, "getRunTrace").mockRejectedValue(new ServiceError(404, "not_found", "Run not found"));

    const reads = [
      ["/api/v1/runs/" + runId + "/status", "getRunStatus"],
      ["/api/v1/runs/" + runId, "getRun"],
      ["/api/v1/runs/" + runId + "/diagnostics", "getRunDiagnostics"],
      ["/api/v1/runs/" + runId + "/trace?after=0&limit=10", "getRunTrace"],
    ] as const;
    for (const [path] of reads) {
      const response = await request("REST", path);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: { code: "not_found", message: "Run not found" } });
    }
  });

  it.each(["get_run", "get_run_diagnostics"] as const)("preserves missing history as not_found over MCP tool %s", async tool => {
    const method = tool === "get_run" ? "getRun" : "getRunDiagnostics";
    vi.spyOn(ApiService.prototype, method).mockRejectedValue(new ServiceError(404, "not_found", "Run not found"));
    const response = await request("MCP", tool);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("not_found: Run not found");
  });
});
