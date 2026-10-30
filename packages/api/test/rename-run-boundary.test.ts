import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiService, ServiceError } from "../src/flow-service";
import { protectedApiFetch } from "../src/protected-api";
import { RunQueryRepository } from "../src/postgres/run-query-repository";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {} }));
afterEach(() => vi.restoreAllMocks());

async function call(transport: "REST" | "MCP", input: Record<string, unknown>, scopes = ["runs:write"]) {
  const request = new Request(`https://example.com${transport === "REST" ? "/api/v1/runs/00000000-0000-4000-8000-000000000001" : "/mcp"}`, {
    method: transport === "REST" ? "PATCH" : "POST",
    headers: { Host: "example.com", "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify(transport === "REST" ? input : { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "rename_run", arguments: { runId: "00000000-0000-4000-8000-000000000001", ...input } } }),
  });
  return protectedApiFetch(request, { APP_ORIGIN: "https://example.com", DATABASE: {} } as any, { tenantId: "tenant-a", userId: "owner", authMethod: "bearer", scopes } as any, {} as any);
}

describe.each(["REST", "MCP"] as const)("%s run rename boundary", transport => {
  it("trims and persists valid names, and rejects invalid names", async () => {
    vi.spyOn(ApiService.prototype as any, "authorize").mockResolvedValue(undefined);
    const rename = vi.spyOn(RunQueryRepository.prototype, "rename").mockResolvedValue({ run_name: "Renamed" });
    const ok = await call(transport, { name: "  Renamed  ", expectedName: "Original" });
    if (transport === "REST") {
      expect(ok.status).toBe(200); expect(await ok.json()).toEqual({ run_name: "Renamed" });
    } else {
      expect(ok.status).toBe(200); expect((await ok.text())).toContain('"run_name":"Renamed"');
    }
    expect(rename).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000001", "Renamed", "Original");
    for (const name of ["   ", "x".repeat(121)]) {
      const response = await call(transport, { name });
      if (transport === "REST") expect(response.status).toBe(400);
      else expect((await response.text())).toContain("Input validation error");
    }
  });

  it("requires runs:write and returns stale and missing outcomes", async () => {
    vi.spyOn(ApiService.prototype as any, "authorize").mockImplementation(function(this: any, ...args: any[]) { const scope = args[0] as string; if (!this.auth.scopes.includes(scope)) throw new ServiceError(403, "insufficient_scope", "Missing scope"); });
    vi.spyOn(RunQueryRepository.prototype, "rename").mockImplementation(async (_id, _name, expected) => expected === "stale" ? "stale" : "missing");
    const unauthorized = await call(transport, { name: "Name" }, ["runs:read"]);
    if (transport === "REST") expect(unauthorized.status).toBe(403);
    else expect((await unauthorized.text())).toContain("insufficient_scope");
    const stale = await call(transport, { name: "Name", expectedName: "stale" });
    if (transport === "REST") expect(stale.status).toBe(409);
    else expect((await stale.text())).toContain("stale_run_name");
    const missing = await call(transport, { name: "Name" });
    if (transport === "REST") expect(missing.status).toBe(404);
    else expect((await missing.text())).toContain("not_found");
  });
});
