# Custom source rollout

Custom sources remain disabled unless `CUSTOM_SOURCES_ENABLED=true`. Before enabling them:

1. Provision the `factorize-custom-handlers` Workers for Platforms dispatch namespace in default untrusted mode.
2. Deploy `wrangler.custom-egress.jsonc` and configure that service as the namespace outbound Worker. The outbound Worker always returns 403 and does not inspect or log requests; configuring it also disables outbound TCP.
3. Deploy `wrangler.custom-deployer.jsonc`. Store the least-privilege Workers Scripts API token as its `CLOUDFLARE_API_TOKEN` secret and configure `CLOUDFLARE_ACCOUNT_ID` there. The main Factorize Worker receives only a service binding; management credentials are never present in tenant objects or user Workers.
4. Run production probes that attempt HTTP and TCP egress, service binding access, cache persistence, and reads of secrets and every supported binding. Enable only when every access fails.
5. Enable one internal tenant and monitor deployment/invocation failures, CPU termination, outbound attempts, and overflow drops.

Custom triggers are intentionally lossy once a flow has 100 pending jobs. Valid signed provider deliveries are still acknowledged to prevent retry storms.
