ALTER TABLE app.fly_execution_configurations ADD COLUMN preset_name text;

CREATE TABLE app.vm_presets (
  tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  name text NOT NULL,
  settings jsonb NOT NULL,
  execution_config_id text NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX vm_presets_name ON app.vm_presets (tenant_id, lower(name));

-- Preserve legacy configuration IDs for jobs. Disambiguate names that differ only by case.
DO $$
DECLARE
  cfg record;
  preset_name text;
  suffix integer;
BEGIN
  FOR cfg IN SELECT * FROM app.fly_execution_configurations ORDER BY tenant_id, created_at, id LOOP
    preset_name := cfg.name;
    suffix := 1;
    WHILE EXISTS (SELECT 1 FROM app.vm_presets WHERE tenant_id = cfg.tenant_id AND lower(name) = lower(preset_name)) LOOP
      suffix := suffix + 1;
      preset_name := left(cfg.name, 119 - length(suffix::text)) || ' ' || suffix;
    END LOOP;
    INSERT INTO app.vm_presets VALUES (cfg.tenant_id, cfg.id, preset_name,
      jsonb_build_object('provider','fly','image',cfg.image,'region',cfg.region,'size',cfg.size), cfg.id::text);
  END LOOP;
END $$;
