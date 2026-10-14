CREATE TABLE app.execution_targets (
  tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  name text NOT NULL,
  integration_kind text NOT NULL,
  integration_id text NOT NULL,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  agent_kind text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, name),
  UNIQUE (tenant_id, integration_kind, integration_id, name),
  CHECK (integration_kind IN ('exe', 'amp'))
);
CREATE INDEX execution_targets_tenant_updated ON app.execution_targets(tenant_id, updated_at, id);

INSERT INTO app.execution_targets(tenant_id, id, name, integration_kind, integration_id, tags, agent_kind)
SELECT c.tenant_id, md5(c.tenant_id::text || ':target:' || c.kind)::uuid,
       CASE WHEN c.kind LIKE 'exe:%' THEN 'exe.dev · ' || right(split_part(c.kind, ':', 2), 8) ELSE 'Amp · ' || right(split_part(c.kind, ':', 2), 8) END,
       split_part(c.kind, ':', 1), split_part(c.kind, ':', 2), '[]'::jsonb,
       CASE WHEN c.kind LIKE 'exe:%' THEN COALESCE((SELECT j.execution_target->>'agentKind' FROM app.jobs j WHERE j.tenant_id=c.tenant_id AND j.execution_target->>'connectionId'=split_part(c.kind, ':', 2) LIMIT 1), 'codex') ELSE 'Amp' END
FROM app.connections c
WHERE c.kind LIKE 'exe:%' OR c.kind LIKE 'amp:%'
ON CONFLICT (tenant_id, name) DO NOTHING;

UPDATE app.jobs j
SET execution_target = j.execution_target || jsonb_build_object('targetId', t.id)
FROM app.execution_targets t
WHERE t.tenant_id=j.tenant_id
  AND t.integration_id=j.execution_target->>'connectionId'
  AND t.integration_kind=CASE WHEN j.execution_target->>'agentKind'='Amp' THEN 'amp' ELSE 'exe' END;
