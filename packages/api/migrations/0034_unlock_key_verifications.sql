CREATE TABLE app.unlock_key_verifications (
  tenant_id uuid PRIMARY KEY REFERENCES app.tenants(id) ON DELETE CASCADE,
  generation_id uuid NOT NULL,
  encrypted_verification text NOT NULL CHECK (length(encrypted_verification) BETWEEN 1 AND 4096),
  created_at timestamptz NOT NULL DEFAULT now()
);
