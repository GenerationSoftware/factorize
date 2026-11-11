CREATE TABLE app.fly_execution_configurations (
  tenant_id uuid NOT NULL REFERENCES app.fly_connections(tenant_id) ON DELETE CASCADE,
  id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  image text NOT NULL CHECK (length(image) BETWEEN 1 AND 512),
  region text NOT NULL CHECK (region ~ '^[a-z0-9]{3}$'),
  size text NOT NULL CHECK (size ~ '^[a-z0-9-]{1,64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, name)
);
