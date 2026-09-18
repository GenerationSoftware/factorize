import { describe, expect, it, vi } from "vitest";
import { RunRepository } from "../src/postgres/run-repository";

describe("RunRepository", () => {
  it("records the first successful launch time without replacing creation time", async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 1 }));
    const database = { transaction: (work: any) => work({ query }) } as any;
    await new RunRepository(database).markLaunched({ tenantId: "tenant", id: "run" } as any, { backendKind: "exe" } as any, "https://example.com", []);
    const calls = query.mock.calls as unknown as [string, unknown[]][];
    expect(calls[0][0]).toContain("started_at=COALESCE(started_at,now())");
    expect(calls[0][1]).toEqual(["tenant", "run"]);
    expect(calls.every(([sql]) => !sql.includes("created_at="))).toBe(true);
  });

  it("claims queue work with row locking and persisted concurrency", async () => {
    const query = vi.fn(async (sql: string) => ({ rows: sql.includes("WITH candidate") ? [] : [], rowCount: 0 }));
    const database = { transaction: (work: any) => work({ query }), pool: { query } } as any;
    await expect(new RunRepository(database).claimNext()).resolves.toBeNull();
    expect(query.mock.calls[0][0]).toContain("FOR UPDATE OF r SKIP LOCKED");
    expect(query.mock.calls[0][0]).toContain("concurrency_limit");
  });
});
