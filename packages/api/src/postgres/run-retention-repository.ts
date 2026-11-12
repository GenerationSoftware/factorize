import { Database } from "./database";
import { safeDiagnosticText } from "../harness-diagnostics";

export type RetentionSweepResult = { selected: number; deleted: number; cleanupQueued: number };
export type ArtifactCleanupResult = { attempted: number; completed: number; retried: number };
export type IndependentHistoryCleanupResult = { queue: string; deleted: number }[];
export type RetentionBacklog = { queue: string; pending: number; oldestAgeSeconds: number | null };

const CLEANUP_BATCH_SIZE = 20;
const CLEANUP_LEASE_MS = 10 * 60_000;
const CLEANUP_MAX_BACKOFF_MS = 6 * 60 * 60_000;
const HISTORY_BATCH_SIZE = 500;

/**
 * Bounded retention deletion. The fixed cutoff is supplied by the caller so a
 * complete sweep cannot move its eligibility boundary while it is running.
 * Each invocation aggregate and its independent object cleanup receipt commit
 * together; SKIP LOCKED lets overlapping maintenance workers make progress.
 */
export class RunRetentionRepository {
  constructor(private readonly database: Database) {}

  /** Aggregate cleanup pressure without emitting tenant, run, or object identifiers. */
  async backlogSnapshot(): Promise<RetentionBacklog[]> {
    const result = await this.database.pool.query<{ queue: string; pending: number; oldest_age_seconds: number | null }>(`
      SELECT queue,pending,oldest_age_seconds FROM (
        SELECT 'terminal_provider'::text queue,count(*)::int pending,
          floor(extract(epoch FROM now()-min(created_at)))::int oldest_age_seconds
        FROM app.runs WHERE state IN ('succeeded','failed','stopped') AND NOT vm_cleanup_complete
        UNION ALL
        SELECT 'deleted_job_provider'::text,count(*)::int,
          floor(extract(epoch FROM now()-min(created_at)))::int
        FROM app.deleted_job_provider_cleanup
        UNION ALL
        SELECT 'artifact_objects'::text,count(*)::int,
          floor(extract(epoch FROM now()-min(created_at)))::int
        FROM app.run_retention_cleanup WHERE completed_at IS NULL
        UNION ALL
        SELECT 'overdue_nonterminal'::text,count(*)::int,
          floor(extract(epoch FROM now()-min(created_at)))::int
        FROM app.runs WHERE state IN ('queued','reserved','starting','running','blocked','stopping')
          AND created_at < now()-interval '14 days'
        UNION ALL
        SELECT 'finalization_pending'::text,count(*)::int,
          floor(extract(epoch FROM now()-min(r.created_at)))::int
        FROM app.runs r JOIN app.job_runs jr ON jr.tenant_id=r.tenant_id AND jr.id=r.id
        WHERE r.state IN ('succeeded','failed','stopped')
          AND (r.artifact_state IN ('pending','collecting') OR jr.state<>r.state)
        UNION ALL
        SELECT 'lifecycle_handoff'::text,count(DISTINCT (e.tenant_id,e.source_run_id))::int,
          floor(extract(epoch FROM now()-min(e.occurred_at)))::int
        FROM app.lifecycle_events e
        JOIN app.triggers t ON t.tenant_id=e.tenant_id AND t.id=e.trigger_id
        JOIN app.jobs j ON j.tenant_id=t.tenant_id AND j.id=t.job_id
        WHERE t.kind='jobLifecycle' AND t.enabled AND t.removed_at IS NULL AND j.enabled
          AND NOT EXISTS (SELECT 1 FROM app.lifecycle_deliveries d
            WHERE d.tenant_id=e.tenant_id AND d.trigger_id=e.trigger_id
              AND d.source_run_id=e.source_run_id AND d.terminal_state=e.terminal_state)
        UNION ALL
        SELECT 'webhook_processing'::text,count(*)::int,
          floor(extract(epoch FROM now()-min(received_at)))::int
        FROM app.webhook_deliveries WHERE outcome='received'
        UNION ALL
        SELECT 'webhook_verification'::text,count(*)::int,
          GREATEST(0,floor(extract(epoch FROM now()-min(next_attempt_at)))::int)
        FROM app.pending_verifications
        UNION ALL
        SELECT 'job_events'::text,count(*)::int,floor(extract(epoch FROM now()-min(received_at)))::int
        FROM app.job_events WHERE received_at < now()-interval '14 days'
        UNION ALL
        SELECT 'webhook_deliveries'::text,count(*)::int,floor(extract(epoch FROM now()-min(d.received_at)))::int
        FROM app.webhook_deliveries d
        WHERE d.received_at < now()-interval '14 days' AND d.outcome <> 'received'
          AND NOT EXISTS (SELECT 1 FROM app.pending_verifications p WHERE p.tenant_id=d.tenant_id AND p.delivery_id=d.delivery_id)
        UNION ALL
        SELECT 'vm_image_verifications'::text,count(*)::int,floor(extract(epoch FROM now()-min(created_at)))::int
        FROM app.vm_image_verifications WHERE status IN ('succeeded','failed') AND created_at < now()-interval '14 days'
        UNION ALL
        SELECT 'integration_changes'::text,count(*)::int,floor(extract(epoch FROM now()-min(created_at)))::int
        FROM app.integration_changes WHERE created_at < now()-interval '14 days'
        UNION ALL
        SELECT 'integration_generations'::text,count(*)::int,floor(extract(epoch FROM now()-min(created_at)))::int
        FROM app.integration_generation_journal WHERE (state='staged' AND created_at < now()-interval '1 day')
          OR (state='committed' AND committed_at < now()-interval '7 days')
          OR (state IN ('rolled_back','expired') AND created_at < now()-interval '1 day')
        UNION ALL
        SELECT 'expired_temporary_records'::text,
          (SELECT count(*)::int FROM app.github_setup_states WHERE expires_at < now() OR used_at IS NOT NULL)
          +(SELECT count(*)::int FROM app.oauth_consent_previews WHERE expires_at < now() OR used_at IS NOT NULL)
          +(SELECT count(*)::int FROM app.oauth_device_authorizations WHERE expires_at < now())
          +(SELECT count(*)::int FROM app.oauth_connections WHERE expires_at < now() OR used_at IS NOT NULL)
          +(SELECT count(*)::int FROM app.auth_reset_tokens WHERE expires_at < now() OR used_at IS NOT NULL)
          +(SELECT count(*)::int FROM app.auth_sessions WHERE expires_at < now() OR revoked_at IS NOT NULL)
          +(SELECT count(*)::int FROM app.access_tokens WHERE expires_at < now() OR revoked_at IS NOT NULL),
          GREATEST(
            COALESCE(floor(extract(epoch FROM now()-(SELECT min(expires_at) FROM app.github_setup_states WHERE expires_at < now() OR used_at IS NOT NULL))),0),
            COALESCE(floor(extract(epoch FROM now()-(SELECT min(expires_at) FROM app.oauth_consent_previews WHERE expires_at < now() OR used_at IS NOT NULL))),0),
            COALESCE(floor(extract(epoch FROM now()-(SELECT min(expires_at) FROM app.oauth_device_authorizations WHERE expires_at < now()))),0),
            COALESCE(floor(extract(epoch FROM now()-(SELECT min(expires_at) FROM app.oauth_connections WHERE expires_at < now() OR used_at IS NOT NULL))),0),
            COALESCE(floor(extract(epoch FROM now()-(SELECT min(expires_at) FROM app.auth_reset_tokens WHERE expires_at < now() OR used_at IS NOT NULL))),0),
            COALESCE(floor(extract(epoch FROM now()-(SELECT min(expires_at) FROM app.auth_sessions WHERE expires_at < now() OR revoked_at IS NOT NULL))),0),
            COALESCE(floor(extract(epoch FROM now()-(SELECT min(expires_at) FROM app.access_tokens WHERE expires_at < now() OR revoked_at IS NOT NULL))),0)
          )::int
      ) backlog ORDER BY queue`);
    return result.rows.map(row => ({ queue: row.queue, pending: row.pending, oldestAgeSeconds: row.oldest_age_seconds }));
  }

  /**
   * Bound independent history and expired one-time record growth. Every lane
   * selects and deletes under row locks, so concurrent maintenance workers
   * divide the work instead of blocking each other. Pending webhook delivery
   * and resource cleanup ownership are deliberately retained.
   */
  async cleanupIndependentHistory(): Promise<IndependentHistoryCleanupResult> {
    const lanes: Array<[string, string]> = [
      ["job_events", `WITH expired AS (
        SELECT tenant_id,id FROM app.job_events WHERE received_at < now()-interval '14 days'
        ORDER BY received_at,tenant_id,id LIMIT $1 FOR UPDATE SKIP LOCKED
      ) DELETE FROM app.job_events e USING expired x WHERE e.tenant_id=x.tenant_id AND e.id=x.id`],
      ["webhook_deliveries", `WITH expired AS (
        SELECT d.tenant_id,d.id FROM app.webhook_deliveries d
        WHERE d.received_at < now()-interval '14 days' AND d.outcome <> 'received'
          AND NOT EXISTS (SELECT 1 FROM app.pending_verifications p WHERE p.tenant_id=d.tenant_id AND p.delivery_id=d.delivery_id)
        ORDER BY d.received_at,d.tenant_id,d.id LIMIT $1 FOR UPDATE OF d SKIP LOCKED
      ) DELETE FROM app.webhook_deliveries d USING expired x WHERE d.tenant_id=x.tenant_id AND d.id=x.id`],
      ["vm_image_verifications", `WITH expired AS (
        SELECT tenant_id,id FROM app.vm_image_verifications WHERE status IN ('succeeded','failed')
          AND created_at < now()-interval '14 days'
        ORDER BY created_at,tenant_id,id LIMIT $1 FOR UPDATE SKIP LOCKED
      ) DELETE FROM app.vm_image_verifications v USING expired x WHERE v.tenant_id=x.tenant_id AND v.id=x.id`],
      ["github_setup_states", `WITH expired AS (
        SELECT tenant_id,nonce FROM app.github_setup_states WHERE expires_at < now() OR used_at IS NOT NULL
        ORDER BY expires_at,tenant_id,nonce LIMIT $1 FOR UPDATE SKIP LOCKED
      ) DELETE FROM app.github_setup_states s USING expired x WHERE s.tenant_id=x.tenant_id AND s.nonce=x.nonce`],
      ["oauth_consent_previews", `WITH expired AS (
        SELECT id FROM app.oauth_consent_previews WHERE expires_at < now() OR used_at IS NOT NULL
        ORDER BY expires_at,id LIMIT $1 FOR UPDATE SKIP LOCKED
      ) DELETE FROM app.oauth_consent_previews p USING expired x WHERE p.id=x.id`],
      ["oauth_device_authorizations", `WITH expired AS (
        SELECT device_code FROM app.oauth_device_authorizations WHERE expires_at < now()
        ORDER BY expires_at,device_code LIMIT $1 FOR UPDATE SKIP LOCKED
      ) DELETE FROM app.oauth_device_authorizations a USING expired x WHERE a.device_code=x.device_code`],
      ["oauth_connections", `WITH expired AS (
        SELECT id FROM app.oauth_connections WHERE expires_at < now() OR used_at IS NOT NULL
        ORDER BY expires_at,id LIMIT $1 FOR UPDATE SKIP LOCKED
      ) DELETE FROM app.oauth_connections c USING expired x WHERE c.id=x.id`],
      ["auth_reset_tokens", `WITH expired AS (
        SELECT digest FROM app.auth_reset_tokens WHERE expires_at < now() OR used_at IS NOT NULL
        ORDER BY expires_at,digest LIMIT $1 FOR UPDATE SKIP LOCKED
      ) DELETE FROM app.auth_reset_tokens t USING expired x WHERE t.digest=x.digest`],
      ["auth_sessions", `WITH expired AS (
        SELECT id FROM app.auth_sessions WHERE expires_at < now() OR revoked_at IS NOT NULL
        ORDER BY expires_at,id LIMIT $1 FOR UPDATE SKIP LOCKED
      ) DELETE FROM app.auth_sessions s USING expired x WHERE s.id=x.id`],
      ["access_tokens", `WITH expired AS (
        SELECT tenant_id,id FROM app.access_tokens WHERE expires_at < now() OR revoked_at IS NOT NULL
        ORDER BY expires_at,tenant_id,id LIMIT $1 FOR UPDATE SKIP LOCKED
      ) DELETE FROM app.access_tokens t USING expired x WHERE t.tenant_id=x.tenant_id AND t.id=x.id`],
      // Keep the incremental cursor honest: any consumer older than this
      // floor must fetch the current collection instead of applying a gap.
      ["integration_changes", `WITH expired AS (
        SELECT tenant_id,revision FROM app.integration_changes WHERE created_at < now()-interval '14 days'
        ORDER BY created_at,tenant_id,revision LIMIT $1
      ), floors AS (SELECT tenant_id,max(revision) AS revision FROM expired GROUP BY tenant_id),
      advanced AS (UPDATE app.integration_collections c SET changes_pruned_through=GREATEST(c.changes_pruned_through,f.revision)
        FROM floors f WHERE c.tenant_id=f.tenant_id RETURNING c.tenant_id)
      DELETE FROM app.integration_changes c USING expired x WHERE c.tenant_id=x.tenant_id AND c.revision=x.revision
        AND EXISTS (SELECT 1 FROM advanced) RETURNING c.revision`],
      ["integration_generations", `WITH expired AS (
        SELECT tenant_id,generation_id FROM app.integration_generation_journal
        WHERE (state='staged' AND created_at < now()-interval '1 day')
           OR (state='committed' AND committed_at < now()-interval '7 days')
           OR (state IN ('rolled_back','expired') AND created_at < now()-interval '1 day')
        ORDER BY created_at,tenant_id,generation_id LIMIT $1 FOR UPDATE SKIP LOCKED
      ) DELETE FROM app.integration_generation_journal j USING expired x WHERE j.tenant_id=x.tenant_id AND j.generation_id=x.generation_id`],
    ];
    const result: IndependentHistoryCleanupResult = [];
    for (const [queue, statement] of lanes) {
      const deleted = await this.database.pool.query(statement, [HISTORY_BATCH_SIZE]);
      result.push({ queue, deleted: deleted.rowCount ?? 0 });
    }
    return result;
  }

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
