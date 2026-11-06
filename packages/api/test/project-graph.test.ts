import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiService } from "../src/flow-service";
import { projectGraphResponse } from "../src/project-graph-contracts";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {} }));
afterEach(() => vi.restoreAllMocks());

describe("project graph", () => {
  const tenantId = "00000000-0000-4000-8000-000000000001", projectId = "00000000-0000-4000-8000-000000000002";
  const source = "00000000-0000-4000-8000-000000000003", destination = "00000000-0000-4000-8000-000000000004", other = "00000000-0000-4000-8000-000000000005";
  it("returns every project job and derives stable configured edges without secret config", async () => {
    const jobs = [
      { id: source, name: "Build", enabled: true, concurrency_limit: 4, running_count: 2, execution_config: { agentKind: "codex" }, triggers: [] },
      { id: destination, name: "Deploy", enabled: false, concurrency_limit: 1, running_count: 0, execution_config: { executionType: "code", agentKind: "codex" }, triggers: [
        { id: "lifecycle", kind: "jobLifecycle", enabled: true, config: { sourceJobIds: [source, other], states: ["failed", "stopped", "edited"] } },
        { id: "idle", kind: "jobIdle", enabled: false, config: { sourceJobIds: [source] } },
        { id: "manual", kind: "manual", enabled: true, config: {} },
        { id: "schedule", kind: "schedule", enabled: true, config: {} },
        { id: "hook", kind: "webhook", enabled: true, config: { provider: "github", repositoryId: 42, signingSecret: "never-return-this" } },
      ] },
    ];
    const query = vi.fn(async (sql: string, values: unknown[]) => {
      expect(values[0]).toBe(tenantId);
      if (sql.includes("FROM app.jobs j LEFT JOIN app.triggers")) return { rows: jobs, rowCount: 2 };
      if (sql.includes("FROM app.manual_invocation_permissions")) return { rows: [{ source_job_id: source, destination_job_id: destination }], rowCount: 1 };
      throw new Error("Unexpected query");
    });
    const service = new ApiService({ DATABASE: { pool: { query } } } as any, { tenantId, userId: "owner", sessionVersion: 1, scopes: ["projects:read"] } as any);
    vi.spyOn(service as any, "authorize").mockResolvedValue(undefined);
    vi.spyOn(service as any, "projects").mockReturnValue({ get: async (id: string) => id === projectId ? { id } : null });
    const graph = await service.getProjectGraph(projectId);
    expect(projectGraphResponse.safeParse(graph).success).toBe(true);
    expect(graph.nodes).toHaveLength(3);
    expect(graph.nodes.find(node => node.id === destination)).toMatchObject({ jobKind: "Code", enabled: false, runningCount: 0, concurrencyLimit: 1 });
    expect(graph.nodes.find(node => node.id === source)).toMatchObject({ runningCount: 2, concurrencyLimit: 4 });
    expect(graph.edges.map(edge => [edge.kind, edge.label, edge.enabled])).toEqual([
      ["lifecycle", "Failed, Stopped, Edited", false], ["idle", "Idle", false],
      ["webhook", "github · Repository 42", false], ["manual", "Manual", false],
    ]);
    expect(graph.edges.some(edge => edge.source === other)).toBe(false);
    expect(JSON.stringify(graph)).not.toContain("never-return-this");
    expect(query.mock.calls[0][0]).not.toContain("'config',t.config");
    expect(query).toHaveBeenCalledTimes(2);
  });
  it("rejects missing or cross-tenant projects before reading jobs", async () => {
    const query = vi.fn();
    const service = new ApiService({ DATABASE: { pool: { query } } } as any, { tenantId, userId: "owner", sessionVersion: 1, scopes: ["projects:read"] } as any);
    vi.spyOn(service as any, "authorize").mockResolvedValue(undefined);
    vi.spyOn(service as any, "projects").mockReturnValue({ get: async (_id: string) => null });
    await expect(service.getProjectGraph(projectId)).rejects.toMatchObject({ status: 404 });
    expect(query).not.toHaveBeenCalled();
  });
  it("includes jobs beyond the regular list page without a graph limit", async () => {
    const allJobs = Array.from({ length: 205 }, (_, index) => ({ id: `job-${index}`, name: `Job ${index}`, enabled: true, execution_config: {}, triggers: [] }));
    const query = vi.fn(async (sql: string) => sql.includes("FROM app.jobs j LEFT JOIN app.triggers") ? { rows: allJobs, rowCount: allJobs.length } : { rows: [], rowCount: 0 });
    const service = new ApiService({ DATABASE: { pool: { query } } } as any, { tenantId, userId: "owner", sessionVersion: 1, scopes: ["projects:read"] } as any);
    vi.spyOn(service as any, "authorize").mockResolvedValue(undefined);
    vi.spyOn(service as any, "projects").mockReturnValue({ get: async (_id: string) => ({ id: projectId }) });
    const graph = await service.getProjectGraph(projectId);
    expect(graph.nodes).toHaveLength(205);
    expect(query.mock.calls[0][0]).not.toMatch(/\bLIMIT\b/i);
  });
});
