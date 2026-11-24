CREATE TABLE app.vm_permission_grants (
  tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL,
  provider_kind text NOT NULL CHECK (provider_kind IN ('exe', 'fly')),
  provider_epoch integer NOT NULL CHECK (provider_epoch > 0),
  vm text NOT NULL,
  vm_app text NOT NULL DEFAULT '',
  request_key text NOT NULL,
  scopes text[] NOT NULL,
  preset_id uuid,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  machine_key text,
  issuer text,
  subject text,
  public_key jsonb,
  created_by text NOT NULL,
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  revoked_at timestamptz,
  cleaned_at timestamptz,
  cleanup_after timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (id),
  UNIQUE (tenant_id, request_key),
  FOREIGN KEY (tenant_id, provider_id) REFERENCES app.agent_integrations(tenant_id, id),
  CHECK ((provider_kind = 'fly') = (vm_app <> '')),
  CHECK (
    (activated_at IS NOT NULL AND machine_key IS NOT NULL AND issuer IS NOT NULL AND subject IS NOT NULL AND public_key IS NOT NULL)
    OR
    (activated_at IS NULL AND machine_key IS NULL AND issuer IS NULL AND subject IS NULL AND public_key IS NULL)
  )
);

-- Serialize enrollment of a target and prevent duplicate grants when two
-- connections can address the same verified machine.
CREATE UNIQUE INDEX vm_permission_grants_live_target
  ON app.vm_permission_grants (tenant_id, provider_id, vm_app, vm)
  WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX vm_permission_grants_live_machine
  ON app.vm_permission_grants (tenant_id, provider_kind, machine_key)
  WHERE revoked_at IS NULL AND activated_at IS NOT NULL;
CREATE INDEX vm_permission_grants_cleanup
  ON app.vm_permission_grants (cleanup_after)
  WHERE revoked_at IS NOT NULL AND cleaned_at IS NULL;

CREATE TABLE app.vm_permission_proofs (
  tenant_id uuid NOT NULL,
  grant_id uuid NOT NULL,
  proof_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, grant_id, proof_id),
  FOREIGN KEY (tenant_id, grant_id) REFERENCES app.vm_permission_grants(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX vm_permission_proofs_expiry ON app.vm_permission_proofs (expires_at);
