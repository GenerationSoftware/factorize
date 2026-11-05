-- A null proxy name identifies credentials issued into legacy guest environments.
-- New authentication accepts only proxy-issued credentials. Existing rows remain
-- for audit, but cannot gain the proxy's read scopes during the cutover.
ALTER TABLE app.run_credentials ADD COLUMN proxy_name text;
