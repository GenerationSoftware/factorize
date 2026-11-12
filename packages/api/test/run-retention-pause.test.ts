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
});
