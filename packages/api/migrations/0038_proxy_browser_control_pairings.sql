CREATE TABLE app.credential_proxy_browser_pairings (
  tenant_id uuid PRIMARY KEY REFERENCES app.tenants(id) ON DELETE CASCADE,
  proxy_identity text NOT NULL,
  boot_epoch uuid NOT NULL,
  browser_origin text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (browser_origin ~ '^https://[^/]+$')
);
