# Durable Object reset runbook

GEN-2030 intentionally resets all application data stored in Durable Objects. It does not replace the `factorize` Worker, its KV namespace, its environment variables, or any Wrangler secrets.

## Data loss and user impact

The reset deletes tenant membership, Jobs, triggers, runs, Access Tokens, OAuth grants stored in Durable Objects, installed integrations, and saved execution connections. After deployment, every user must sign in again and reconnect Linear, GitHub, Cloudflare Tail, exe.dev, and Amp integrations as applicable.

## Phase 1: switch to fresh namespaces

1. Confirm the existing Worker secrets and environment configuration are present. Do not run `wrangler delete`, create another Worker, change the Worker name, replace the OAuth KV binding, or remove secrets.
2. Deploy this revision with `npm run deploy:app`. Migration `v3-fresh-durable-objects` creates the SQLite-backed `TenantV2` and `GitHubInstallationRegistryV2` classes. The existing binding names switch to those fresh namespaces, while the legacy class exports remain available for safe rollback.
3. Confirm the deployment succeeds before taking any retirement action. Sign in, reconnect an execution integration, and create a Job with a Manual trigger, prompt template `{{trigger-1.prompt}}`, and that execution target. Confirm the Job is created without `SQLITE_CONSTRAINT_NOTNULL`.
4. Notify users that they must sign in again and reconnect integrations.

## Phase 2: retire legacy namespaces

Perform this only in a later deployment after Phase 1 is live and verified:

1. Add a new migration after `v3-fresh-durable-objects`:

   ```json
   { "tag": "v4-delete-legacy-durable-objects", "deleted_classes": ["Tenant", "GitHubInstallationRegistry"] }
   ```

2. Remove the legacy `Tenant` and `GitHubInstallationRegistry` aliases from the exports in `src/index.ts` and `src/worker.ts`. Keep the V2 bindings, V2 exports, Worker name, variables, KV binding, and secrets unchanged.
3. Run `npm run check`, deploy the Worker normally, and verify sign-in and Job creation again.

Never combine legacy deletion with the Phase 1 namespace switch: the replacement bindings must be live and verified first.
