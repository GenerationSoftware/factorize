import { afterEach, describe, expect, it, vi } from "vitest";
import { RunRepository } from "../src/postgres/run-repository";
import { RunScheduler } from "../src/postgres/run-scheduler";

afterEach(() => vi.restoreAllMocks());

describe("terminal provider cleanup reconciliation", () => {
  it("keeps a started run without a handle in retryable cleanup ownership", async () => {
    const database = { pool: { query: vi.fn() } } as any;
    const scheduler = new RunScheduler(database, {} as any);
    vi.spyOn(RunRepository.prototype, "claimProviderCleanup").mockResolvedValue([{
      tenantId: "tenant", id: "started-without-handle", executionConfig: {}, executionHandle: null,
      backendKind: "exe-vm", startedAt: new Date("2026-10-01T00:00:00Z"), attempt: 3,
    }]);
    vi.spyOn(RunRepository.prototype, "claimDeletedJobProviderCleanup").mockResolvedValue([]);
    const retry = vi.spyOn(RunRepository.prototype, "retryProviderCleanup").mockResolvedValue(undefined);
    const complete = vi.spyOn(RunRepository.prototype, "completeProviderCleanup").mockResolvedValue(undefined);

    await (scheduler as any).reconcileProviderCleanup();

    expect(retry).toHaveBeenCalledWith("tenant", "started-without-handle", 3,
      expect.objectContaining({ message: expect.stringContaining("provider absence cannot be verified") }));
    expect(complete).not.toHaveBeenCalled();
  });

  it("completes provider cleanup for a terminal run that was never launched", async () => {
    const scheduler = new RunScheduler({ pool: { query: vi.fn() } } as any, {} as any);
    vi.spyOn(RunRepository.prototype, "claimProviderCleanup").mockResolvedValue([{
      tenantId: "tenant", id: "never-launched", executionConfig: {}, executionHandle: null,
      backendKind: "exe-vm", startedAt: null, attempt: 1,
    }]);
    vi.spyOn(RunRepository.prototype, "claimDeletedJobProviderCleanup").mockResolvedValue([]);
    const complete = vi.spyOn(RunRepository.prototype, "completeProviderCleanup").mockResolvedValue(undefined);
    const retry = vi.spyOn(RunRepository.prototype, "retryProviderCleanup").mockResolvedValue(undefined);

    await (scheduler as any).reconcileProviderCleanup();

    expect(complete).toHaveBeenCalledWith("tenant", "never-launched");
    expect(retry).not.toHaveBeenCalled();
  });

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

  it("retains provider cleanup ownership when stop succeeds but database acknowledgment fails", async () => {
    const writes: Array<{ sql: string; values: unknown[] }> = [];
    const poolQuery = vi.fn(async (sql: string, values: unknown[] = []) => {
      writes.push({ sql, values });
      if (sql.includes("vm_cleanup_complete=true")) throw new Error("database acknowledgment unavailable");
      return { rows: [], rowCount: 1 };
    });
    const txQuery = vi.fn(async (sql: string) => {
      if (sql.includes("app.deleted_job_provider_cleanup")) return { rows: [], rowCount: 0 };
      if (sql.includes("WITH candidates")) return { rows: [{ tenant_id: "tenant", id: "run", execution_config: {}, execution_handle: { backendKind: "exe-vm", id: "provider-run" }, execution_backend_kind: "exe-vm", provider_cleanup_attempt: 1, started_at: new Date("2026-10-01T00:00:00Z") }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const database = { pool: { query: poolQuery }, transaction: (work: (client: any) => unknown) => work({ query: txQuery }) } as any;
    const scheduler = new RunScheduler(database, {} as any);
    const stop = vi.fn().mockResolvedValue({ state: "stopped" });
    vi.spyOn(scheduler as any, "backend").mockResolvedValue({ stop });

    await (scheduler as any).reconcileProviderCleanup();

    expect(stop).toHaveBeenCalledWith({ backendKind: "exe-vm", id: "provider-run" });
    expect(writes.map(write => write.sql)).toEqual(expect.arrayContaining([
      expect.stringContaining("vm_cleanup_complete=true"),
      expect.stringContaining("provider_cleanup_next_at=now()+make_interval(secs=>$3)"),
    ]));
    expect(writes.at(-1)).toMatchObject({ values: ["tenant", "run", 60, "database acknowledgment unavailable"] });
  });

  it("retains terminal cleanup ownership and schedules a retry when the provider cannot confirm absence", async () => {
    const writes: Array<{ sql: string; values: unknown[] }> = [];
    const poolQuery = vi.fn(async (sql: string, values: unknown[] = []) => {
      writes.push({ sql, values });
      return { rows: [], rowCount: 1 };
    });
    const txQuery = vi.fn(async (sql: string) => {
      if (sql.includes("app.deleted_job_provider_cleanup")) return { rows: [], rowCount: 0 };
      if (sql.includes("WITH candidates")) return { rows: [{
        tenant_id: "tenant", id: "run", execution_config: { connectionId: "connection" },
        execution_handle: { backendKind: "exe-vm", id: "provider-run" }, execution_backend_kind: "exe-vm",
        provider_cleanup_attempt: 2, started_at: new Date("2026-10-01T00:00:00Z"),
      }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const scheduler = new RunScheduler({ pool: { query: poolQuery }, transaction: (work: (client: any) => unknown) => work({ query: txQuery }) } as any, {} as any);
    const stop = vi.fn().mockRejectedValue(new Error("provider temporarily unavailable"));
    vi.spyOn(scheduler as any, "backend").mockResolvedValue({ stop });

    await (scheduler as any).reconcileProviderCleanup();

    expect(stop).toHaveBeenCalledWith({ backendKind: "exe-vm", id: "provider-run" });
    expect(writes).toEqual([{
      sql: expect.stringContaining("provider_cleanup_next_at=now()+make_interval(secs=>$3)"),
      values: ["tenant", "run", 120, "provider temporarily unavailable"],
    }]);
  });

  it("does not acknowledge cleanup when a provider stop response leaves the run active", async () => {
    const writes: Array<{ sql: string; values: unknown[] }> = [];
    const poolQuery = vi.fn(async (sql: string, values: unknown[] = []) => {
      writes.push({ sql, values });
      return { rows: [], rowCount: 1 };
    });
    const txQuery = vi.fn(async (sql: string) => {
      if (sql.includes("app.deleted_job_provider_cleanup")) return { rows: [], rowCount: 0 };
      if (sql.includes("WITH candidates")) return { rows: [{
        tenant_id: "tenant", id: "run", execution_config: {},
        execution_handle: { backendKind: "exe-vm", id: "provider-run" }, execution_backend_kind: "exe-vm",
        provider_cleanup_attempt: 1, started_at: new Date("2026-10-01T00:00:00Z"),
      }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const scheduler = new RunScheduler({ pool: { query: poolQuery }, transaction: (work: (client: any) => unknown) => work({ query: txQuery }) } as any, {} as any);
    const stop = vi.fn().mockResolvedValue({ state: "running", detail: "Cancellation is still in progress" });
    vi.spyOn(scheduler as any, "backend").mockResolvedValue({ stop });

    await (scheduler as any).reconcileProviderCleanup();

    expect(stop).toHaveBeenCalledWith({ backendKind: "exe-vm", id: "provider-run" });
    expect(writes).toEqual([{
      sql: expect.stringContaining("provider_cleanup_next_at=now()+make_interval(secs=>$3)"),
      values: ["tenant", "run", 60, "Cancellation is still in progress"],
    }]);
    expect(writes.every(({ sql }) => !sql.includes("vm_cleanup_complete=true"))).toBe(true);
  });

  it("leases independent ownership after job deletion and keeps failed provider work retryable", async () => {
    const query = vi.fn(async (sql: string) => {
      expect(sql).toContain("app.deleted_job_provider_cleanup");
      expect(sql).toContain("FOR UPDATE SKIP LOCKED");
      return { rows: [{ tenant_id: "tenant", run_id: "deleted-run", execution_config: { connectionId: "connection" }, execution_handle: { backendKind: "exe-vm", id: "provider-run" }, execution_backend_kind: "exe-vm", started_at: new Date("2026-10-01T00:00:00Z"), attempts: 3 }], rowCount: 1 };
    });
    const database = { transaction: (work: (client: any) => unknown) => work({ query }) } as any;
    const repository = new RunRepository(database);
    await expect(repository.claimDeletedJobProviderCleanup()).resolves.toEqual([{ tenantId: "tenant", id: "deleted-run", executionConfig: { connectionId: "connection" }, executionHandle: { backendKind: "exe-vm", id: "provider-run" }, backendKind: "exe-vm", startedAt: new Date("2026-10-01T00:00:00Z"), attempt: 3 }]);

    const writes = vi.fn().mockResolvedValue({ rowCount: 1 });
    const writer = new RunRepository({ pool: { query: writes } } as any);
    await writer.retryDeletedJobProviderCleanup("tenant", "deleted-run", 3, new Error("provider unavailable"));
    expect(writes).toHaveBeenCalledWith(expect.stringContaining("lease_expires_at=NULL,last_error=$4"), ["tenant", "deleted-run", 240, "provider unavailable"]);
    await writer.completeDeletedJobProviderCleanup("tenant", "deleted-run");
    expect(writes).toHaveBeenLastCalledWith(expect.stringContaining("DELETE FROM app.deleted_job_provider_cleanup"), ["tenant", "deleted-run"]);
  });
});
