# Run history retention

Factorize uses a global 14-day history window measured from immutable run creation time. A run is eligible only after it is terminal, its execution-provider cleanup is confirmed, artifact finalization is no longer pending, and required lifecycle automation has been handed off. Nonterminal runs remain protected regardless of age. Finishing an overdue run does not give it a new retention window.

## Cleanup processing

The scheduler alarm runs bounded retention and artifact cleanup work in addition to ordinary run scheduling. The alarm coordinator keeps a maintenance heartbeat no more than 15 minutes away, even when there are no queued runs or schedules. Each retention batch uses one cutoff, limits candidates, and rechecks state, age, cleanup ownership and pending lifecycle deliveries under aggregate locks before deleting an invocation.

Artifact object keys are copied into `app.run_retention_cleanup` in the same database transaction that removes the invocation aggregate. The queue has no foreign key to the run, job or tenant. Workers lease one receipt at a time, delete a bounded batch from R2, and remove each receipt after success. Failures retain the receipt with capped exponential backoff; an expired lease makes interrupted work eligible again.

Terminal runs whose execution-provider cleanup is incomplete use a separate bounded reconciliation lane. Workers claim rows with `FOR UPDATE SKIP LOCKED`, store a ten-minute lease, and ask the recorded backend to stop the recorded handle. A confirmed stop or provider-confirmed absence completes cleanup; failures retain the run and retry with capped exponential backoff. A terminal row with no handle and no provider start timestamp is explicitly treated as never launched. A started row with no handle cannot prove provider absence, so it retains an error and remains ineligible for retention until reconciled. Since retention requires provider cleanup completion, unresolved handles cannot be purged with their authoritative records.

Each alarm also removes up to 500 rows per independent-history lane: job events, completed webhook deliveries and their cascading timelines, and completed VM image verifications. Webhook rows still marked `received` and any delivery referenced by a pending GitHub verification are protected. Image verifications in `cleanup_failed` and other nonterminal states remain as cleanup ownership. Expired or used GitHub setup states, consent previews, device authorizations, OAuth continuations, password-reset tokens, revoked or expired sessions, and revoked or expired access tokens are removed in bounded batches; valid long-lived access tokens survive regardless of age. Expiring a webhook delivery removes its deduplication key, so a provider retry after the retention window may be processed as a new delivery. A retry racing deletion uses an atomic upsert to reuse or recreate its delivery record, and event/timeline writes remain transactional.

Integration synchronization history is also bounded on each alarm. At most 500 change rows older than 14 days are removed per pass, and committed generation rollback archives are retained for seven days; abandoned staged, rolled-back, and expired generations are removed after one day. Current encrypted integration records and tombstones are preserved. `changes_pruned_through` advances atomically with each deleted change batch. A consumer whose cursor is below that floor receives a stale-revision response marked `resyncRequired`; it must fetch the current full collection before resuming incremental changes. This prevents a pruned gap from being mistaken for a complete change page.

## Retention inventory audit

The application schema and migrations classify retained rows by ownership rather than applying age deletion to every table:

| Class | Tables | Policy |
| --- | --- | --- |
| Durable identity and configuration | `tenants`, `auth_users`, `auth_accounts`, `members`, `connections`, `linear_workspaces`, `github_installations`, `projects`, `jobs`, `triggers`, `skills`, `job_skills`, `manual_invocation_permissions`, `integration_collections`, `integration_records`, `webhook_conditions_cutover`, `fly_connections`, `fly_execution_configurations`, `execution_targets` | Preserve. User, tenant, and current configuration are outside run-history retention. |
| Run aggregate | `invocations`, `job_runs`, `runs`, `run_artifacts`, `run_trace_events`, `run_trace_cursors`, `run_trace_chunks`, `run_trace_projections`, `run_activity`, `active_claims`, `lifecycle_events`, `lifecycle_deliveries`, `run_credentials`, `credential_proxy_states`, `credential_run_grants`, `credential_run_enrollments`, `trace_replay_limits`, `trace_replay_operations` | Remove through the invocation aggregate after terminal-state, immutable-age, cleanup, finalization, and automation checks. Foreign-key cascades remove run-owned history and temporary run access together. |
| Independent operational history | `job_events`, `webhook_deliveries`, `webhook_delivery_events`, `vm_image_verifications` | Bounded 14-day cleanup of completed history; retain pending delivery, verification, or resource-cleanup ownership. |
| One-time or expiring authentication records | `github_setup_states`, `oauth_consent_previews`, `oauth_device_authorizations`, `oauth_connections`, `auth_reset_tokens`, `auth_sessions`, `access_tokens` | Bounded cleanup after use, revocation, or actual expiry. Creation age alone never removes a still-valid credential. |
| Retryable cleanup ownership | `run_retention_cleanup`, `deleted_job_provider_cleanup` | Keep until external object/provider work is acknowledged; use leases and retry. These queues do not cascade with deleted run/job rows. |
| Scheduler and migration state | `schema_migrations`, `schedule_state`, `automatic_wakes`, `wake_hints`, `tail_fingerprints`, `pending_verifications`, `job_edit_deliveries`, `unlock_key_verifications`, `gen_2416_migration_checkpoint`, `gen_2416_migration_inventory` | Preserve while active or required for correctness; expiry/acknowledgment is governed by the owning workflow, not run age. Review one-time migration bookkeeping separately after its recovery window. |
| Integration synchronization history | `integration_changes`, `integration_generation_journal`, `integration_generation_records`, `integration_generation_changes`, `integration_generation_previous_records`, `integration_generation_previous_changes` | Change log: bounded 14-day retention with a revision floor and full-resynchronization response for stale consumers. Committed generation rollback archives: seven days; abandoned staging and completed journal records: one day. Cascading journal deletion removes generation snapshots and archives. Current encrypted integration records and tombstones remain durable configuration. |

The retention indexes cover candidate age/order and the audited foreign-key lookups for run activity, lifecycle events/deliveries, credential enrollments, webhook timelines, and pending verifications by delivery. The migrations create 66 tables, including migration-only bookkeeping tables; the 2026-11-11 production inventory observed 63 tables. Adding a table requires assigning it to an inventory class and documenting whether it cascades, expires independently, or represents durable state. No global age rule is safe for configuration, active work, or synchronization state.

Explicit job deletion also snapshots every incomplete run's provider configuration, handle, and start evidence into `app.deleted_job_provider_cleanup` in the same transaction as the job cascade. This independent queue lets the maintenance lane stop or reconcile provider resources after the source job and run rows are gone. A started run without a saved handle stays queued for retry and manual reconciliation; a never-started run can be removed from the queue safely. R2 artifacts for explicit job deletion continue to be deleted before the database cascade so a storage failure leaves the authoritative keys available for retry.

Successful cleanup removes its retry state from the run. Failed work retains only a bounded diagnostic string and retry timestamp. Each maintenance alarm emits a structured `run_retention_maintenance` log with run sweep, artifact and independent-history deletion progress plus pending counts and oldest age for terminal-provider cleanup, deleted-job provider cleanup, artifact objects, overdue nonterminal runs, independent histories, and expired temporary records. The snapshot contains no tenant, run, or object identifiers. A failed snapshot is logged separately and does not fail maintenance.

### Read-only dry run and rollout

Before enabling deletion, run the following against a read-only database snapshot with a single captured `:cutoff` value (UTC now minus 14 days). It reports database cohorts without locking or changing rows; compare R2 listing results separately because orphan classification spans object storage and PostgreSQL.

```sql
WITH old AS (
  SELECT r.*, jr.state AS job_run_state
  FROM app.runs r
  JOIN app.invocations i ON i.tenant_id=r.tenant_id AND i.id=r.invocation_id
  JOIN app.job_runs jr ON jr.tenant_id=r.tenant_id AND jr.invocation_id=r.invocation_id
  WHERE r.created_at < :cutoff
), pending_automation AS (
  SELECT DISTINCT e.tenant_id,e.source_run_id
  FROM app.lifecycle_events e
  JOIN app.triggers t ON t.tenant_id=e.tenant_id AND t.id=e.trigger_id
  JOIN app.jobs j ON j.tenant_id=t.tenant_id AND j.id=t.job_id
  WHERE t.kind='jobLifecycle' AND t.enabled AND t.removed_at IS NULL AND j.enabled
    AND NOT EXISTS (SELECT 1 FROM app.lifecycle_deliveries d
      WHERE d.tenant_id=e.tenant_id AND d.trigger_id=e.trigger_id
        AND d.source_run_id=e.source_run_id AND d.terminal_state=e.terminal_state)
)
SELECT cohort,count(*) AS runs FROM (
  SELECT CASE
    WHEN r.state IN ('queued','reserved','starting','running','blocked','stopping') THEN 'active_or_exempt'
    WHEN r.state IN ('succeeded','failed','stopped') AND NOT r.vm_cleanup_complete THEN 'provider_cleanup_blocked'
    WHEN r.state IN ('succeeded','failed','stopped') AND r.artifact_state IN ('pending','collecting') THEN 'finalization_blocked'
    WHEN r.state IN ('succeeded','failed','stopped') AND r.job_run_state <> r.state THEN 'state_mismatch_review'
    WHEN r.state IN ('succeeded','failed','stopped') AND EXISTS
      (SELECT 1 FROM pending_automation p WHERE p.tenant_id=r.tenant_id AND p.source_run_id=r.id) THEN 'automation_pending'
    WHEN r.state IN ('succeeded','failed','stopped') THEN 'eligible_terminal'
    ELSE 'other_state_review'
  END AS cohort
  FROM old r
) cohorts GROUP BY cohort ORDER BY cohort;
```

Roll out in stages: (1) apply additive migrations while retention is paused; (2) deploy cleanup code with `RUN_HISTORY_RETENTION_PAUSED=true`; (3) refresh the read-only cohort and R2 inventory, resolve old provider cleanup (including no-handle cases), and verify upload/trace/finalization/lifecycle fault tests; (4) enable the default bounded batches and review the first maintenance logs before increasing throughput. The pause switch stops run deletion, R2 deletion, and independent-history expiry. It does not disable read-only backlog metrics or terminal provider cleanup. Do not execute a production purge as part of code validation.

### Dashboard and alert signals

Build a retained time-series dashboard from `run_retention_maintenance` structured logs. Plot `backlog[].pending` and `backlog[].oldestAgeSeconds` per queue, `sweep.selected/deleted/cleanupQueued`, `artifacts.attempted/completed/retried`, and each independent-history lane's deleted count. Keep `paused` visible on every panel. Alert on a nonzero or rising `overdue_nonterminal` cohort for operator review, any sustained rise in provider or artifact oldest age, repeated artifact retries, or missing maintenance events for more than 30 minutes. A paused deployment should show backlog growth without deletion progress. Never put tenant, run, provider handle, or object key dimensions on these panels.

## Rollout and recovery

The retention sweep is intentionally not enabled by a schema migration and no data purge runs during migration. Before enabling or increasing destructive work, refresh the read-only inventory and dry-run eligible, active/exempt, cleanup-blocked, pending-automation and orphan-artifact cohorts. Deploy additive schema and cleanup code first. Set the Worker variable `RUN_HISTORY_RETENTION_PAUSED=true` to pause run deletion, R2 artifact deletion, and independent-history expiry. The scheduler continues its read-only backlog snapshot and terminal provider resource reconciliation; the latter completes normal finalization and is required before an overdue run can expire. Remove the variable or set it to `false` to resume bounded retention work. Keep retention paused until provider reconciliation, upload/trace race tests and the remaining rollout gates are ready. Maintenance runs from a heartbeat no more than 15 minutes away; cleanup lag is bounded by that cadence, each lane's batch cap, and any older backlog ahead of new work.

Resume interrupted cleanup by allowing the next alarm to reclaim expired leases. Do not clear a provider handle or cleanup retry record after an error. A provider-confirmed absent resource is idempotently complete. Recheck ownership before deleting any artifact classified as orphaned, and use a grace period so in-flight uploads can commit receipts. Report before/after counts, oldest backlog age, retries, provider results, and pending external deletions. Database deletion is atomic per run, but PostgreSQL space reuse and external object deletion are asynchronous.

Disabling retention stops future deletion; it does not restore deleted history or objects. Archived branches and backups require separate lifecycle decisions. Never use this workflow to delete the archived validation branch or run a production purge as part of an implementation checkpoint.
