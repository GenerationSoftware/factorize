import { Database } from "./database";

export type RetentionSweepResult = { selected: number; deleted: number; cleanupQueued: number };

/**
 * Bounded retention deletion. The fixed cutoff is supplied by the caller so a
 * complete sweep cannot move its eligibility boundary while it is running.
 * Each invocation aggregate and its independent object cleanup receipt commit
 * together; SKIP LOCKED lets overlapping maintenance workers make progress.
 */
export class RunRetentionRepository {
  constructor(private readonly database: Database) {}

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
