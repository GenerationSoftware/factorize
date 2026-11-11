import { describe, expect, it, vi } from "vitest";
import { RunRetentionRepository } from "../src/postgres/run-retention-repository";

describe("RunRetentionRepository", () => {
  it("bounds selection and rechecks eligibility under aggregate locks", async () => {
    const cutoff = new Date("2026-10-28T12:00:00.000Z");
    const statements: string[] = [];
    const poolQuery = vi.fn(async (sql: string) => {
      statements.push(sql);
      return { rows: [{ tenant_id: "tenant", invocation_id: "invocation" }], rowCount: 1 };
    });
    const txQuery = vi.fn(async (sql: string) => {
      statements.push(sql);
      if (sql.includes("SELECT r.id run_id")) return { rows: [{ run_id: "run" }], rowCount: 1 };
      if (sql.includes("SELECT object_key")) return { rows: [{ object_key: "tenant/run/trace.jsonl" }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const database = { pool: { query: poolQuery }, transaction: (work: (client: any) => unknown) => work({ query: txQuery }) } as any;

    await expect(new RunRetentionRepository(database).sweep(cutoff, 8)).resolves.toEqual({ selected: 1, deleted: 1, cleanupQueued: 1 });
    expect(poolQuery).toHaveBeenCalledWith(expect.stringContaining("LIMIT $2"), [cutoff, 8]);
    expect(poolQuery.mock.calls[0]![0]).toContain("r.created_at < $1");
    expect(poolQuery.mock.calls[0]![0]).toContain("jr.state=r.state");
    expect(poolQuery.mock.calls[0]![0]).toContain("NOT EXISTS");
    expect(statements.findIndex(sql => sql.includes("INSERT INTO app.run_retention_cleanup"))).toBeLessThan(statements.findIndex(sql => sql.includes("DELETE FROM app.invocations")));
    expect(txQuery.mock.calls.find(([sql]) => sql.includes("SELECT r.id run_id"))![0]).toContain("FOR UPDATE OF i,jr,r SKIP LOCKED");
  });

  it("rejects invalid cutoffs and unbounded batch sizes before database access", async () => {
    const query = vi.fn();
    const repository = new RunRetentionRepository({ pool: { query }, transaction: vi.fn() } as any);
    await expect(repository.sweep(new Date(Number.NaN))).rejects.toThrow(TypeError);
    await expect(repository.sweep(new Date(), 501)).rejects.toThrow(RangeError);
    expect(query).not.toHaveBeenCalled();
  });
});
