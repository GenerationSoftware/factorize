# Run history retention

Factorize uses a global 14-day history window measured from immutable run creation time. A run is eligible only after it is terminal, its execution-provider cleanup is confirmed, artifact finalization is no longer pending, and required lifecycle automation has been handed off. Nonterminal runs remain protected regardless of age. Finishing an overdue run does not give it a new retention window.

## Cleanup processing

The scheduler alarm runs bounded retention and artifact cleanup work in addition to ordinary run scheduling. The alarm coordinator keeps a maintenance heartbeat no more than 15 minutes away, even when there are no queued runs or schedules. Each retention batch uses one cutoff, limits candidates, and rechecks state, age, cleanup ownership and pending lifecycle deliveries under aggregate locks before deleting an invocation.

Artifact object keys are copied into `app.run_retention_cleanup` in the same database transaction that removes the invocation aggregate. The queue has no foreign key to the run, job or tenant. Workers lease one receipt at a time, delete a bounded batch from R2, and remove each receipt after success. Failures retain the receipt with capped exponential backoff; an expired lease makes interrupted work eligible again.

Terminal runs whose execution-provider cleanup is incomplete use a separate bounded reconciliation lane. Workers claim rows with `FOR UPDATE SKIP LOCKED`, store a ten-minute lease, and ask the recorded backend to stop the recorded handle. A confirmed stop or provider-confirmed absence completes cleanup; failures retain the run and retry with capped exponential backoff. A terminal row with no handle and no provider start timestamp is explicitly treated as never launched. A started row with no handle cannot prove provider absence, so it retains an error and remains ineligible for retention until reconciled. Since retention requires provider cleanup completion, unresolved handles cannot be purged with their authoritative records.

Explicit job deletion also snapshots every incomplete run's provider configuration, handle, and start evidence into `app.deleted_job_provider_cleanup` in the same transaction as the job cascade. This independent queue lets the maintenance lane stop or reconcile provider resources after the source job and run rows are gone. A started run without a saved handle stays queued for retry and manual reconciliation; a never-started run can be removed from the queue safely. R2 artifacts for explicit job deletion continue to be deleted before the database cascade so a storage failure leaves the authoritative keys available for retry.

Successful cleanup removes its retry state from the run. Failed work retains only a bounded diagnostic string and retry timestamp; operator metrics and backlog dashboards remain follow-up work for this rollout.

## Rollout and recovery

The retention sweep is intentionally not enabled by a schema migration and no data purge runs during migration. Before enabling or increasing destructive work, refresh the read-only inventory and dry-run eligible, active/exempt, cleanup-blocked, pending-automation and orphan-artifact cohorts. Deploy additive schema and cleanup code first. Use bounded batches and an operational pause switch; retain the pause until provider reconciliation, upload/trace race tests, independent-history cleanup and backlog observability are ready.

Resume interrupted cleanup by allowing the next alarm to reclaim expired leases. Do not clear a provider handle or cleanup retry record after an error. A provider-confirmed absent resource is idempotently complete. Recheck ownership before deleting any artifact classified as orphaned, and use a grace period so in-flight uploads can commit receipts. Report before/after counts, oldest backlog age, retries, provider results, and pending external deletions. Database deletion is atomic per run, but PostgreSQL space reuse and external object deletion are asynchronous.

Disabling retention stops future deletion; it does not restore deleted history or objects. Archived branches and backups require separate lifecycle decisions. Never use this workflow to delete the archived validation branch or run a production purge as part of an implementation checkpoint.
