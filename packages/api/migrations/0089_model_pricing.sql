CREATE TABLE app.model_pricing_overrides (
 tenant_id uuid NOT NULL,
 integration_id uuid NOT NULL,
 model text NOT NULL,
 rates jsonb,
 revision integer NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,integration_id,model),
 FOREIGN KEY(tenant_id,integration_id) REFERENCES app.integration_records(tenant_id,id) ON DELETE CASCADE
);
INSERT INTO app.schema_migrations(version) VALUES ('0089_model_pricing') ON CONFLICT DO NOTHING;
