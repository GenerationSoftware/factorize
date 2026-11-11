import { Database } from "./database";
import { safeDiagnosticText } from "../harness-diagnostics";

export type RetentionSweepResult = { selected: number; deleted: number; cleanupQueued: number };
export type ArtifactCleanupResult = { attempted: number; completed: number; retried: number };

const CLEANUP_BATCH_SIZE = 20;
const CLEANUP_LEASE_MS = 10 * 60_000;
const CLEANUP_MAX_BACKOFF_MS = 6 * 60 * 60_000;

/**
 * Bounded retention deletion. The fixed cutoff is supplied by the caller so a
 * complete sweep cannot move its eligibility boundary while it is running.
 * Each invocation aggregate and its independent object cleanup receipt commit
 * together; SKIP LOCKED lets overlapping maintenance workers make progress.
 */
export class RunRetentionRepository {
  constructor(private readonly database: Database) {}

  /**
   * Delete retained R2 objects outside the run-deletion transaction. A short
   * lease prevents concurrent alarms from doing duplicate work; if an alarm
   * stops after claiming an item, it becomes eligible again when the lease
   * expires. Successful receipts are removed so the queue stays bounded.
   */
  async processArtifactCleanup(bucket: Pick<R2Bucket, "delete"> | undefined, now = new Date()): Promise<ArtifactCleanupResult> {
    if (!bucket) return { attempted: 0, completed: 0, retried: 0 };
    let attempted = 0;
    let completed = 0;
    let retried = 0;
    for (let count = 0; count < CLEANUP_BATCH_SIZE; count++) {
      const item = await this.database.transaction(async client => {
        const claimed = await client.query<{ id: string; object_keys: string[]; attempts: number }>(`
          SELECT id,object_keys,attempts FROM app.run_retention_cleanup
          WHERE completed_at IS NULL AND next_attempt_at <= $1
          ORDER BY next_attempt_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`, [now]);
        const row = claimed.rows[0];
        if (!row) return null;
        await client.query(`UPDATE app.run_retention_cleanup
          SET attempts=attempts+1,next_attempt_at=$2 WHERE id=$1`, [row.id, new Date(now.getTime() + CLEANUP_LEASE_MS)]);
        return { ...row, attempts: row.attempts + 1 };
      });
      if (!item) break;
      attempted++;
      try {
        const keys = Array.isArray(item.object_keys) ? item.object_keys : [];
        if (keys.length) await bucket.delete(keys);
        await this.database.pool.query("DELETE FROM app.run_retention_cleanup WHERE id=$1", [item.id]);
        completed++;
      } catch (error) {
        const delay = Math.min(CLEANUP_MAX_BACKOFF_MS, 60_000 * 2 ** Math.min(item.attempts - 1, 8));
        await this.database.pool.query(`UPDATE app.run_retention_cleanup
          SET next_attempt_at=$2,last_error=$3 WHERE id=$1`, [item.id, new Date(now.getTime() + delay), safeDiagnosticText(error instanceof Error ? error.message : "R2 cleanup failed")]);
        retried++;
      }
    }
    return { attempted, completed, retried };
  }

  async sweep(cutoff: Date, limit = 50): Promise<RetentionSweepResult> {
    if (!Number.isFinite(cutoff.getTime())) throw new TypeError("Retention cutoff must be a valid date");
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new RangeError("Retention batch size must be between 1 and 500");

    const selected = await this.database.pool.query<{ tenant_id: string; invocation_id: string }>(`
      SELECT i.tenant_id,i.id invocation_id
      FROM app.runs r
      JOIN app.job_runs jr ON jr.tenant_id=r.tenant_id AND jr.invocation_id=r.invocation_id
      JOIN app.invocations i ON i.tenant_id=r.tenant_id AND i.id=r.invocation_id
      WHERE r.created_at < $1
        AND r.state IN ('succeeded','failed','stopped') AND jr.state=r.state
        AND r.vm_cleanup_complete AND r.artifact_state NOT IN ('pending','collecting')
        AND NOT EXISTS (
          SELECT 1 FROM app.lifecycle_events e
          JOIN app.triggers t ON t.tenant_id=e.tenant_id AND t.id=e.trigger_id
          JOIN app.jobs j ON j.tenant_id=t.tenant_id AND j.id=t.job_id
          WHERE e.tenant_id=r.tenant_id AND e.source_run_id=r.id
            AND t.kind='jobLifecycle' AND t.enabled AND t.removed_at IS NULL AND j.enabled
            AND NOT EXISTS (SELECT 1 FROM app.lifecycle_deliveries d
              WHERE d.tenant_id=e.tenant_id AND d.trigger_id=e.trigger_id
                AND d.source_run_id=e.source_run_id AND d.terminal_state=e.terminal_state)
        )
      ORDER BY r.created_at,r.tenant_id,r.invocation_id
      LIMIT $2`, [cutoff, limit]);

    let deleted = 0;
    let cleanupQueued = 0;
    for (const candidate of selected.rows) {
      const result = await this.database.transaction(async client => {
        // Lock in invocation -> job_run -> run order, the aggregate's ownership
        // direction. Recheck every eligibility condition after acquiring locks.
        const locked = await client.query<{ run_id: string }>(`
          SELECT r.id run_id
          FROM app.invocations i
          JOIN app.job_runs jr ON jr.tenant_id=i.tenant_id AND jr.invocation_id=i.id
          JOIN app.runs r ON r.tenant_id=i.tenant_id AND r.invocation_id=i.id
          WHERE i.tenant_id=$1 AND i.id=$2 AND r.created_at < $3
            AND r.state IN ('succeeded','failed','stopped') AND jr.state=r.state
            AND r.vm_cleanup_complete AND r.artifact_state NOT IN ('pending','collecting')
            AND NOT EXISTS (
              SELECT 1 FROM app.lifecycle_events e
              JOIN app.triggers t ON t.tenant_id=e.tenant_id AND t.id=e.trigger_id
              JOIN app.jobs j ON j.tenant_id=t.tenant_id AND j.id=t.job_id
              WHERE e.tenant_id=r.tenant_id AND e.source_run_id=r.id
                AND t.kind='jobLifecycle' AND t.enabled AND t.removed_at IS NULL AND j.enabled
                AND NOT EXISTS (SELECT 1 FROM app.lifecycle_deliveries d
                  WHERE d.tenant_id=e.tenant_id AND d.trigger_id=e.trigger_id
                    AND d.source_run_id=e.source_run_id AND d.terminal_state=e.terminal_state)
            )
          FOR UPDATE OF i,jr,r SKIP LOCKED`, [candidate.tenant_id, candidate.invocation_id, cutoff]);
        if (!locked.rows.length) return { deleted: false, queued: false };

        const keys = await client.query<{ object_key: string }>(
          "SELECT object_key FROM app.run_artifacts WHERE tenant_id=$1 AND run_id=$2 ORDER BY object_key",
          [candidate.tenant_id, locked.rows[0]!.run_id],
        );
        if (keys.rows.length) {
          await client.query(`INSERT INTO app.run_retention_cleanup(id,tenant_id,run_id,object_keys)
            VALUES ($1,$2,$3,$4::jsonb)`, [crypto.randomUUID(), candidate.tenant_id, locked.rows[0]!.run_id, JSON.stringify(keys.rows.map(row => row.object_key))]);
        }
        const removed = await client.query("DELETE FROM app.invocations WHERE tenant_id=$1 AND id=$2", [candidate.tenant_id, candidate.invocation_id]);
        return { deleted: removed.rowCount === 1, queued: keys.rows.length > 0 };
      });
      if (result.deleted) deleted++;
      if (result.queued) cleanupQueued++;
    }
    return { selected: selected.rowCount ?? selected.rows.length, deleted, cleanupQueued };
  }
}
