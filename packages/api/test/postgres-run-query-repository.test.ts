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
});
