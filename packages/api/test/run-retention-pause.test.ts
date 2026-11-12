import { afterEach, describe, expect, it, vi } from "vitest";
import { RunRetentionRepository } from "../src/postgres/run-retention-repository";
import { RunScheduler } from "../src/postgres/run-scheduler";

afterEach(() => vi.restoreAllMocks());

describe("run history retention pause switch", () => {
  it("keeps backlog visibility but skips history and artifact deletion while paused", async () => {
    const backlog = [{ queue: "artifact_objects", pending: 4, oldestAgeSeconds: 900 }];
    const snapshot = vi.spyOn(RunRetentionRepository.prototype, "backlogSnapshot").mockResolvedValue(backlog);
    const sweep = vi.spyOn(RunRetentionRepository.prototype, "sweep");
    const artifacts = vi.spyOn(RunRetentionRepository.prototype, "processArtifactCleanup");
    const history = vi.spyOn(RunRetentionRepository.prototype, "cleanupIndependentHistory");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const scheduler: any = new RunScheduler({} as any, { RUN_HISTORY_RETENTION_PAUSED: " TRUE " } as any);

    await scheduler.runRetentionMaintenance(new RunRetentionRepository({} as any));

    expect(snapshot).toHaveBeenCalledOnce();
    expect(sweep).not.toHaveBeenCalled();
    expect(artifacts).not.toHaveBeenCalled();
    expect(history).not.toHaveBeenCalled();
    expect(JSON.parse(info.mock.calls[0]![0] as string)).toMatchObject({
      event: "run_retention_maintenance",
      paused: true,
      backlog,
    });
  });

  it("emits the aggregate fields needed by retention dashboard panels without identifiers", async () => {
    vi.spyOn(RunRetentionRepository.prototype, "sweep").mockResolvedValue({ selected: 8, deleted: 6, cleanupQueued: 2 });
    vi.spyOn(RunRetentionRepository.prototype, "processArtifactCleanup").mockResolvedValue({ attempted: 3, completed: 1, retried: 2 });
    vi.spyOn(RunRetentionRepository.prototype, "cleanupIndependentHistory").mockResolvedValue([
      { queue: "job_events", deleted: 12 }, { queue: "webhook_deliveries", deleted: 4 },
    ]);
    vi.spyOn(RunRetentionRepository.prototype, "backlogSnapshot").mockResolvedValue([
      { queue: "terminal_provider", pending: 2, oldestAgeSeconds: 7200 },
      { queue: "artifact_objects", pending: 1, oldestAgeSeconds: 90 },
    ]);
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const scheduler: any = new RunScheduler({} as any, {} as any);

    await scheduler.runRetentionMaintenance(new RunRetentionRepository({} as any));

    const event = JSON.parse(info.mock.calls[0]![0] as string);
    expect(event).toMatchObject({
      event: "run_retention_maintenance",
      paused: false,
      sweep: { selected: 8, deleted: 6, cleanupQueued: 2 },
      artifacts: { attempted: 3, completed: 1, retried: 2 },
      independentHistory: [{ queue: "job_events", deleted: 12 }, { queue: "webhook_deliveries", deleted: 4 }],
      backlog: [{ queue: "terminal_provider", pending: 2, oldestAgeSeconds: 7200 }, { queue: "artifact_objects", pending: 1, oldestAgeSeconds: 90 }],
    });
    expect(JSON.stringify(event)).not.toMatch(/tenant|runId|objectKey|providerHandle/i);
  });

  it("keeps maintenance successful when the post-sweep dashboard snapshot fails", async () => {
    vi.spyOn(RunRetentionRepository.prototype, "sweep").mockResolvedValue({ selected: 1, deleted: 1, cleanupQueued: 0 });
    vi.spyOn(RunRetentionRepository.prototype, "processArtifactCleanup").mockResolvedValue({ attempted: 0, completed: 0, retried: 0 });
    vi.spyOn(RunRetentionRepository.prototype, "cleanupIndependentHistory").mockResolvedValue([]);
    vi.spyOn(RunRetentionRepository.prototype, "backlogSnapshot").mockRejectedValue(new Error("snapshot unavailable"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const scheduler: any = new RunScheduler({} as any, {} as any);

    await expect(scheduler.runRetentionMaintenance(new RunRetentionRepository({} as any))).resolves.toBeUndefined();

    expect(JSON.parse(warn.mock.calls[0]![0] as string)).toMatchObject({
      event: "run_retention_backlog_snapshot_failed",
      message: "snapshot unavailable",
    });
  });
});
