import { describe, expect, it, vi } from "vitest";
import { RunRepository } from "../src/postgres/run-repository";

describe("RunRepository", () => {
  it("claims queue work with row locking and persisted concurrency", async () => {
    const query = vi.fn(async (sql: string) => ({ rows: sql.includes("WITH candidate") ? [] : [], rowCount: 0 }));
    const database = { transaction: (work: any) => work({ query }), pool: { query } } as any;
    await expect(new RunRepository(database).claimNext()).resolves.toBeNull();
    expect(query.mock.calls[0][0]).toContain("FOR UPDATE OF r SKIP LOCKED");
    expect(query.mock.calls[0][0]).toContain("concurrency_limit");
  });
});
