import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));

import { TenantV2 } from "../src/tenant";

describe("run alarm isolation", () => {
  it("continues cleanup, polling, and launch batches after per-run failures", async () => {
    const tenant = Object.create(TenantV2.prototype) as any;
    const cleaned: string[] = [], polled: string[] = [], launched: string[] = [];
    tenant.processGitHubVerifications = vi.fn();
    tenant.processDueSchedules = vi.fn();
    tenant.requeueStaleStarts = vi.fn();
    tenant.ensureAlarm = vi.fn();
    tenant.rows = vi.fn((query: string) => {
      if (query.includes("vm_cleanup_complete=0")) return [{ id: "cleanup-bad", pipe_id: "job" }, { id: "cleanup-good", pipe_id: "job" }];
      if (query.includes("state IN ('running','blocked')")) return [{ id: "poll-bad", pipe_id: "job" }, { id: "poll-good", pipe_id: "job" }];
      if (query.includes("state = 'queued'")) return [{ id: "launch-bad", pipe_id: "job" }, { id: "launch-good", pipe_id: "job" }];
      return [];
    });
    tenant.cleanupRunVm = vi.fn(async (run: { id: string }) => {
      cleaned.push(run.id);
      if (run.id === "cleanup-bad") throw new Error("cleanup failed");
    });
    tenant.pollRun = vi.fn(async (run: { id: string }) => {
      polled.push(run.id);
      if (run.id === "poll-bad") throw new Error("poll failed");
    });
    tenant.executionConfig = vi.fn(() => ({ id: "job", workspace_name: "dev", max_concurrency: 10 }));
    tenant.one = vi.fn(() => ({ count: 0 }));
    tenant.ctx = { storage: { sql: { exec: vi.fn() } } };
    tenant.startRun = vi.fn(async (run: { id: string }) => {
      launched.push(run.id);
      if (run.id === "launch-bad") throw new Error("launch failed");
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await tenant.alarm();

    expect(cleaned).toEqual(["cleanup-bad", "cleanup-good"]);
    expect(polled).toEqual(["poll-bad", "poll-good"]);
    expect(launched).toEqual(["launch-bad", "launch-good"]);
    expect(logged).toHaveBeenCalledTimes(3);
    expect(tenant.ensureAlarm).toHaveBeenCalledOnce();
    logged.mockRestore();
  });
});
