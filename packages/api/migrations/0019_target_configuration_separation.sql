-- GEN-2416: make execution targets the sole owner of executable configuration.
-- Additive and restart-safe: legacy connection fields remain readable until the
-- compatibility window is closed.
ALTER TABLE app.execution_targets
  ADD COLUMN IF NOT EXISTS model text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS effort text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS models jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS models_refreshed_at timestamptz;

-- Legacy jobs own model/effort. Copy them into the target only for an
-- unambiguous one-job target; the compatibility reader preserves differing
-- job values until the split backfill below can report them.
UPDATE app.execution_targets t
SET model=COALESCE(NULLIF(j.model,''),''), effort=COALESCE(NULLIF(j.effort,''),'')
FROM app.jobs j
WHERE j.tenant_id=t.tenant_id AND j.execution_target->>'targetId'=t.id::text
  AND NOT EXISTS (SELECT 1 FROM app.jobs other WHERE other.tenant_id=j.tenant_id
    AND other.execution_target->>'targetId'=t.id::text AND (other.model,j.effort)<>(j.model,j.effort));

CREATE TABLE IF NOT EXISTS app.gen_2416_migration_checkpoint (
  tenant_id uuid PRIMARY KEY REFERENCES app.tenants(id) ON DELETE CASCADE,
  phase text NOT NULL DEFAULT 'inventory',
  report jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.gen_2416_migration_inventory (
  tenant_id uuid PRIMARY KEY REFERENCES app.tenants(id) ON DELETE CASCADE,
  connections bigint NOT NULL, targets bigint NOT NULL, jobs bigint NOT NULL,
  runs bigint NOT NULL, ambiguous_targets bigint NOT NULL DEFAULT 0,
  split_targets bigint NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now()
);

-- Split shared legacy targets where jobs carried different model/effort values.
-- The UUID and name are deterministic, so interrupted migrations are safe to
-- rerun and unrelated tenant targets cannot collide.
DO $migration$
DECLARE r record; new_id uuid;
BEGIN
  FOR r IN SELECT j.tenant_id, j.id job_id, t.id target_id, j.model, j.effort
    FROM app.jobs j JOIN app.execution_targets t ON t.tenant_id=j.tenant_id
      AND t.id::text=j.execution_target->>'targetId'
    WHERE (j.model,j.effort)<>(t.model,t.effort)
  LOOP
    new_id := md5(r.tenant_id::text || ':gen-2416:' || r.target_id::text || ':' || r.model || ':' || r.effort)::uuid;
    INSERT INTO app.execution_targets(tenant_id,id,name,integration_kind,integration_id,tags,agent_kind,model,effort,models,models_refreshed_at)
      SELECT tenant_id,new_id,left(name || ' · ' || substr(md5(r.model || ':' || r.effort),1,8),120),integration_kind,integration_id,tags,agent_kind,r.model,r.effort,'[]'::jsonb,NULL
      FROM app.execution_targets WHERE tenant_id=r.tenant_id AND id=r.target_id
      ON CONFLICT (tenant_id,id) DO NOTHING;
    UPDATE app.jobs SET execution_target = execution_target || jsonb_build_object('targetId',new_id), updated_at=updated_at
      WHERE tenant_id=r.tenant_id AND id=r.job_id;
  END LOOP;
  INSERT INTO app.gen_2416_migration_inventory(tenant_id,connections,targets,jobs,runs,ambiguous_targets,split_targets)
    SELECT t.id, (SELECT count(*) FROM app.connections c WHERE c.tenant_id=t.id),
      (SELECT count(*) FROM app.execution_targets e WHERE e.tenant_id=t.id),
      (SELECT count(*) FROM app.jobs j WHERE j.tenant_id=t.id),
      (SELECT count(*) FROM app.runs x WHERE x.tenant_id=t.id),
      (SELECT count(*) FROM app.execution_targets e WHERE e.tenant_id=t.id AND e.integration_kind='exe' AND e.tags='[]'::jsonb),
      (SELECT count(*) FROM app.execution_targets e WHERE e.tenant_id=t.id AND e.name ~ ' · [0-9a-f]{8}$')
    FROM app.tenants t ON CONFLICT (tenant_id) DO UPDATE SET connections=excluded.connections,targets=excluded.targets,jobs=excluded.jobs,runs=excluded.runs,ambiguous_targets=excluded.ambiguous_targets,updated_at=now();
END $migration$;
