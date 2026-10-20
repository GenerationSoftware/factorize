-- Execution targets identify a saved integration and its agent. Jobs own the
-- per-job VM tags, model, and effort; runs retain their immutable snapshots.
ALTER TABLE app.jobs ADD COLUMN IF NOT EXISTS tags jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Before this migration, target-backed runs used target-owned settings. Copy
-- those effective settings to every referencing job before new writers switch
-- to job-owned configuration. Historical run snapshots are deliberately left
-- untouched.
UPDATE app.jobs j
SET tags=t.tags,
    model=t.model,
    effort=t.effort
FROM app.execution_targets t
WHERE t.tenant_id=j.tenant_id
  AND t.id::text=j.execution_target->>'targetId';

-- Empty display names are valid, and a target is identified by its integration
-- and agent rather than a mutable label. Retain legacy columns for rollback
-- compatibility; application readers and writers no longer use them.
ALTER TABLE app.execution_targets
  DROP CONSTRAINT IF EXISTS execution_targets_tenant_id_name_key,
  DROP CONSTRAINT IF EXISTS execution_targets_tenant_id_integration_kind_integration_id_name_key;
