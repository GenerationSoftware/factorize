# GEN-2416 migration and rollout

Migration `0019_target_configuration_separation.sql` is additive and safe to
rerun. It adds target-owned model, effort, and discovery-cache columns,
preserves legacy fields for compatibility and creates a tenant-scoped
checkpoint table. Empty tags from `0017` are ambiguous: they are retained
unless a reconciliation batch can establish their provenance. Encrypted
connection payloads are not inspected by SQL; an operator report must reconcile
account tag inventory without exposing credentials. Jobs remain the authority
for legacy model/effort until the compatibility reader is removed.

Roll out the additive schema, then deploy readers that prefer target snapshots,
then writers/UI, and finally run bounded tenant batches. Each batch inventories
connections, targets, jobs, and runs; splits targets by the tuple
`(integration, agent, model, effort, tags)` with deterministic UUIDs derived from
tenant, original target, and tuple; and records migrated/reused/split/ambiguous
counts in the checkpoint report. Queued and active runs are never relaunched:
their existing `runs.execution_config` is frozen before the scheduler switches
precedence. Historical rows are read-only.

If a batch is interrupted, rerun it from its checkpoint; deterministic IDs and
upserts prevent duplicates. Reports contain IDs and configuration conflicts but
never credentials. Rollback is limited to application readers/writers before
new-model writes; after target-owned writes, roll forward or restore from a
database backup while retaining snapshots and execution handles. Do not delete
legacy connection fields until all supported REST/MCP clients have migrated.
