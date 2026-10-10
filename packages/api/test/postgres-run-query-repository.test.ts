import { describe, expect, it, vi } from "vitest";
import { RunQueryRepository } from "../src/postgres/run-query-repository";

describe("run timing queries", () => {
  it.each([null, new Date("2026-09-18T12:10:00Z")])("exposes the persisted start (%s) separately from creation", async started_at => {
    const row = { id: "run", created_at: new Date("2026-09-18T12:00:00Z"), started_at };
    const query = vi.fn(async () => ({ rows: [row] }));
    const repository = new RunQueryRepository({ pool: { query } } as any, "tenant");
    expect((await repository.list(new URLSearchParams())).items[0]).toEqual(row);
    expect(await repository.get("run")).toEqual(row);
    for (const [sql] of query.mock.calls as unknown as [string][]) {
      expect(sql).toContain("jr.started_at");
      expect(sql).toContain("jr.tenant_id=r.tenant_id AND jr.id=r.id");
    }
  });

  it.each([
    ["run", "asc", "COALESCE(NULLIF(r.run_name, ''), NULLIF(r.issue_title, ''), 'Run') ASC"],
    ["run", "desc", "COALESCE(NULLIF(r.run_name, ''), NULLIF(r.issue_title, ''), 'Run') DESC"],
    ["status", "asc", "r.state ASC"],
    ["status", "desc", "r.state DESC"],
    ["created", "asc", "r.created_at ASC"],
    ["created", "desc", "r.created_at DESC"],
    ["agent", "asc", "r.agent_kind ASC"],
    ["agent", "desc", "r.agent_kind DESC"],
  ] as const)("sorts %s %s before pagination with ID tie-breaking", async (sort, direction, ordering) => {
    const rows = [{ id: "00000000-0000-4000-8000-000000000001", run_name: "Alpha", issue_title: "", state: "failed", agent_kind: "codex", created_at: new Date("2026-09-18T12:00:00Z") }, { id: "00000000-0000-4000-8000-000000000002", run_name: "Beta", issue_title: "", state: "succeeded", agent_kind: "claude", created_at: new Date("2026-09-18T12:01:00Z") }];
    const query = vi.fn(async () => ({ rows }));
    const result = await new RunQueryRepository({ pool: { query } } as any, "tenant").list(new URLSearchParams({ sort, direction, limit: "1" }));
    const [sql, values] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain(`ORDER BY CASE WHEN`);
    expect(sql).toContain(ordering);
    expect(sql).toContain("r.id");
    expect(values).toEqual(["tenant", 2]);
    expect(result.nextCursor).toBeTruthy();
  });

  it("uses a sort-aware cursor so the next page cannot restart or cross sort orders", async () => {
    const query = vi.fn(async () => ({ rows: [{ id: "00000000-0000-4000-8000-000000000002", run_name: "Beta", issue_title: "", state: "succeeded", agent_kind: "codex", created_at: new Date("2026-09-18T12:01:00Z") }] }));
    const cursor = btoa(JSON.stringify(["run", "asc", 0, "Alpha", "00000000-0000-4000-8000-000000000001"]));
    await new RunQueryRepository({ pool: { query } } as any, "tenant").list(new URLSearchParams({ sort: "run", direction: "asc", cursor }));
    const [sql, values] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("IS NOT DISTINCT FROM");
    expect(values).toEqual(["tenant", 0, "Alpha", "00000000-0000-4000-8000-000000000001", 51]);
  });
});
