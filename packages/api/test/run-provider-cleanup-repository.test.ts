import { describe, expect, it, vi } from "vitest";
import { RunRepository } from "../src/postgres/run-repository";

describe("terminal provider cleanup reconciliation", () => {
  it("claims only terminal incomplete cleanup with a bounded lease", async () => {
    const query = vi.fn(async (sql: string) => {
      expect(sql).toContain("x.state IN ('succeeded','failed','stopped')");
      expect(sql).toContain("NOT x.vm_cleanup_complete");
      expect(sql).toContain("FOR UPDATE OF x SKIP LOCKED");
      expect(sql).toContain("provider_cleanup_next_at=now()+interval '10 minutes'");
      return { rows: [{ tenant_id: "tenant", id: "run", execution_config: { connectionId: "connection" }, execution_handle: { backendKind: "exe-vm", id: "factorize-run" }, execution_backend_kind: "exe-vm", provider_cleanup_attempt: 2, started_at: new Date("2026-10-01T00:00:00Z") }], rowCount: 1 };
    });
    const database = { transaction: (work: (client: any) => unknown) => work({ query }) } as any;
    await expect(new RunRepository(database).claimProviderCleanup()).resolves.toEqual([{ tenantId: "tenant", id: "run", executionConfig: { connectionId: "connection" }, executionHandle: { backendKind: "exe-vm", id: "factorize-run" }, backendKind: "exe-vm", startedAt: new Date("2026-10-01T00:00:00Z"), attempt: 2 }]);
    expect(query).toHaveBeenCalledWith(expect.any(String), [20]);
  });

  it("records cleanup success and retries failures with capped backoff", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const repository = new RunRepository({ pool: { query } } as any);
    await repository.completeProviderCleanup("tenant", "run");
    expect(query).toHaveBeenNthCalledWith(1, expect.stringContaining("vm_cleanup_complete=true"), ["tenant", "run"]);
    await repository.retryProviderCleanup("tenant", "run", 9, new Error("provider unavailable"));
    expect(query).toHaveBeenNthCalledWith(2, expect.stringContaining("provider_cleanup_next_at=now()+make_interval(secs=>$3)"), ["tenant", "run", 15_360, "provider unavailable"]);
  });
});
