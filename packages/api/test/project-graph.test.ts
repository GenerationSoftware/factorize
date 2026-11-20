import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiService } from "../src/flow-service";
import { projectGraphResponse } from "../src/project-graph-contracts";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {} }));
afterEach(() => vi.restoreAllMocks());

describe("team Trigger graph", () => {
  const tenantId = "00000000-0000-4000-8000-000000000001";
  const source = "00000000-0000-4000-8000-000000000003", destination = "00000000-0000-4000-8000-000000000004", other = "00000000-0000-4000-8000-000000000005";
  it("returns every team Trigger across historical projects and derives stable configured edges without secret config", async () => {
    const triggers = [
      { id: source, name: "Build", enabled: true, concurrency_limit: 4, running_count: 2, execution_config: { agentKind: "codex" }, events: [] },
      { id: destination, name: "Deploy", enabled: false, concurrency_limit: 1, running_count: 0, execution_config: { executionType: "code", agentKind: "codex" }, events: [
        { id: "lifecycle", kind: "triggerLifecycle", enabled: true, config: { sourceTriggerIds: [source, other], states: ["failed", "stopped", "edited"] } },
        { id: "idle", kind: "triggerIdle", enabled: false, config: { sourceTriggerIds: [source] } },
        { id: "manual", kind: "manual", enabled: true, config: {} },
        { id: "schedule", kind: "schedule", enabled: true, config: {} },
        { id: "hook", kind: "webhook", enabled: true, config: { provider: "github", repositoryId: 42, signingSecret: "never-return-this" } },
        { id: "hook-copy", kind: "webhook", enabled: true, config: { provider: "github", repositoryId: 42 } },
        { id: "linear", kind: "webhook", enabled: true, config: { provider: "linear", projectId: "00000000-0000-4000-8000-000000000099" } },
        { id: "clickup", kind: "webhook", enabled: true, config: { provider: "clickup", listId: "123456789" } },
        { id: "github-pr", kind: "webhook", enabled: true, config: { provider: "github", repositoryId: 42, event: "pull_request" } },
        { id: "tail", kind: "webhook", enabled: true, config: { provider: "cloudflareTail", integrationId: "tail-secret-ish-id" } },
      ] },
    ];
    const query = vi.fn(async (sql: string, values: unknown[]) => {
      expect(values).toEqual([tenantId]);
      expect(sql).not.toMatch(/project_id\s*=/);
      if (sql.includes("FROM app.triggers j LEFT JOIN app.events")) return { rows: triggers, rowCount: 2 };
      if (sql.includes("FROM app.manual_invocation_permissions")) return { rows: [{ source_trigger_id: source, destination_trigger_id: destination }], rowCount: 1 };
      throw new Error("Unexpected query");
    });
    const service = new ApiService({ DATABASE: { pool: { query } } } as any, { tenantId, userId: "owner", sessionVersion: 1, scopes: ["team:read"] } as any);
    vi.spyOn(service as any, "authorize").mockResolvedValue(undefined);
    const graph = await service.getTeamGraph();
    expect(projectGraphResponse.safeParse(graph).success).toBe(true);
    expect(graph.nodes).toHaveLength(6);
    expect(graph.nodes.find(node => node.id === destination)).toMatchObject({ triggerKind: "Code", enabled: false, runningCount: 0, concurrencyLimit: 1 });
    expect(graph.nodes.find(node => node.id === source)).toMatchObject({ runningCount: 2, concurrencyLimit: 4 });
    expect(graph.edges.map(edge => [edge.kind, edge.label, edge.enabled])).toEqual([
      ["lifecycle", "Failed, Stopped, Edited", false], ["idle", "Idle", false],
      ["webhook", "GitHub", false], ["webhook", "GitHub", false], ["webhook", "Linear", false], ["webhook", "ClickUp", false], ["webhook", "GitHub PR", false], ["webhook", "Cloudflare Tail", false], ["manual", "Manual", false],
    ]);
    const duplicateLabels = graph.edges.filter(edge => edge.label === "GitHub");
    expect(duplicateLabels).toHaveLength(2);
    expect(new Set(duplicateLabels.map(edge => edge.id)).size).toBe(2);
    expect(new Set(duplicateLabels.map(edge => edge.source))).toEqual(new Set(["webhook:github:Repository 42"]));
    expect(graph.edges[0].details).toBe("Failed, Stopped, Edited");
    expect(graph.nodes.find(node => node.type === "webhook" && node.provider === "linear")).toMatchObject({ label: "Linear", resource: "00000000-0000-4000-8000-000000000099" });
    expect(graph.nodes.find(node => node.type === "webhook" && node.provider === "clickup")).toMatchObject({ label: "ClickUp", resource: "123456789" });
    expect(graph.edges.find(edge => edge.label === "Linear")?.label).not.toContain("00000000-0000-4000-8000-000000000099");
    expect(graph.edges.find(edge => edge.label === "ClickUp")?.label).not.toContain("123456789");
    expect(graph.edges.every(edge => edge.label.length <= 24)).toBe(true);
    expect(graph.edges.some(edge => edge.source === other)).toBe(false);
    expect(JSON.stringify(graph)).not.toContain("never-return-this");
    expect(query.mock.calls[0][0]).not.toContain("'config',t.config");
    expect(query).toHaveBeenCalledTimes(2);
  });
  it("keeps lifecycle states and long names bounded while using readable provider fallbacks", async () => {
    const longStates = ["succeeded", "failed", "stopped", "edited"];
    const rows = [{ id: source, name: "Build", enabled: true, execution_config: {}, events: [] }, { id: destination, name: "Deploy", enabled: true, execution_config: {}, events: [
      { id: "all-states", kind: "triggerLifecycle", enabled: true, config: { sourceTriggerIds: [source], states: longStates } },
      { id: "missing-provider", kind: "webhook", enabled: true, config: { projectId: "opaque-resource" } },
      { id: "long-event", kind: "webhook", enabled: true, config: { provider: "github", event: "pull_request_target" } },
    ] }];
    const query = vi.fn(async (sql: string) => sql.includes("FROM app.triggers j LEFT JOIN app.events") ? { rows, rowCount: rows.length } : { rows: [], rowCount: 0 });
    const service = new ApiService({ DATABASE: { pool: { query } } } as any, { tenantId, userId: "owner", sessionVersion: 1, scopes: ["team:read"] } as any);
    vi.spyOn(service as any, "authorize").mockResolvedValue(undefined);
    const graph = await service.getTeamGraph();
    expect(graph.edges.map(edge => edge.label)).toEqual(["Succeeded, Failed, Stop…", "Webhook", "GitHub PR"]);
    expect(graph.edges[0].details).toBe("Succeeded, Failed, Stopped, Edited");
    expect(graph.nodes.find(node => node.type === "webhook")).toMatchObject({ label: "Webhook", provider: "webhook" });
    expect(graph.edges.every(edge => edge.label.length <= 24)).toBe(true);
  });
  it("requires trigger read access before reading the graph", async () => {
    const query = vi.fn();
    const service = new ApiService({ DATABASE: { pool: { query } } } as any, { tenantId, userId: "owner", sessionVersion: 1, scopes: [] } as any);
    vi.spyOn(service as any, "authorize").mockRejectedValue({ status: 403 });
    await expect(service.getTeamGraph()).rejects.toMatchObject({ status: 403 });
    expect(query).not.toHaveBeenCalled();
  });
  it("includes triggers beyond the regular list page without a graph limit", async () => {
    const allTriggers = Array.from({ length: 205 }, (_, index) => ({ id: `trigger-${index}`, name: `Trigger ${index}`, enabled: true, execution_config: {}, events: [] }));
    const query = vi.fn(async (sql: string) => sql.includes("FROM app.triggers j LEFT JOIN app.events") ? { rows: allTriggers, rowCount: allTriggers.length } : { rows: [], rowCount: 0 });
    const service = new ApiService({ DATABASE: { pool: { query } } } as any, { tenantId, userId: "owner", sessionVersion: 1, scopes: ["team:read"] } as any);
    vi.spyOn(service as any, "authorize").mockResolvedValue(undefined);
    const graph = await service.getTeamGraph();
    expect(graph.nodes).toHaveLength(205);
    expect(query.mock.calls[0][0]).not.toMatch(/\bLIMIT\b/i);
  });
});
