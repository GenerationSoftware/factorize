# Factorize

[![CI](https://github.com/GenerationSoftware/factorize/actions/workflows/ci.yml/badge.svg)](https://github.com/GenerationSoftware/factorize/actions/workflows/ci.yml)
[![Deploy to Cloudflare](https://img.shields.io/badge/Deploy_to-Cloudflare-F38020?style=flat&logo=cloudflare&logoColor=white)](https://deploy.workers.cloudflare.com/?url=https://github.com/GenerationSoftware/factorize&path=packages/api)

**A no-code software factory for Linear teams.** Factorize turns selected Linear issue changes into coding-agent jobs on isolated, ephemeral exe.dev VMs.

```text
Linear webhook → Cloudflare Worker → Durable Object → exe.dev /exec → isolated agent VM
                                         ↑ polls status              ↓
                                      concurrency control      Linear comments
```

## Why Factorize?

- Keep control: agents run on your own exe.dev VM, not a shared runner.
- Automate deliberately: match Linear issues by owner, creator, status, label, or assignee.
- Isolate work: every agent run gets a fresh VM that is deleted as soon as the run ends.
- Stay isolated: each Linear workspace has its own Cloudflare Durable Object.
- Avoid duplicate work: a claimed issue stays claimed until its agent job completes.

## Deploy to Cloudflare

Click the **Deploy to Cloudflare** button above to create a copy of the app Worker in your own Cloudflare account. The button selects `packages/api` as the Worker root; Cloudflare provisions the Durable Object binding and configures Workers Builds for the copied repository.

> The Deploy to Cloudflare button works for public GitHub or GitLab repositories. If you are using a private fork, deploy with Wrangler instead.

### Deploy with Wrangler

1. Clone the repository and install dependencies.
2. Set `APP_ORIGIN` in `packages/api/wrangler.jsonc` to your final HTTPS Worker URL or custom domain.
3. Create a dedicated OAuth KV namespace with `npm exec --workspace=factorize -- wrangler kv namespace create OAUTH_KV`, then set its ID in `packages/api/wrangler.jsonc`.
4. Configure the Linear OAuth callback as `https://your-domain.example/auth/linear/callback`.
5. Build assets, add secrets, and deploy:

```bash
npm ci
npm run build:css

npm exec --workspace=factorize -- wrangler secret put LINEAR_CLIENT_ID
npm exec --workspace=factorize -- wrangler secret put LINEAR_CLIENT_SECRET
npm exec --workspace=factorize -- wrangler secret put LINEAR_WEBHOOK_SIGNING_SECRET
npm exec --workspace=factorize -- wrangler secret put CREDENTIAL_ENCRYPTION_KEY
npm exec --workspace=factorize -- wrangler secret put SESSION_SIGNING_SECRET

npm run deploy:app
```

For a headless machine, authenticate first with `npx wrangler login --device --browser=false`, then open the displayed URL and approve the device code from your browser.

## Quick start

### Prerequisites

- A Cloudflare account with Workers enabled.
- A Linear OAuth application with webhooks enabled.
- Optional: a ClickUp OAuth application for ClickUp task triggers.
- An exe.dev account. Fresh VMs include supported coding agents such as Codex and Claude.
- An exe.dev HTTPS API token allowed to run `ls`, `new`, `ssh`, and `rm`.

### Develop locally

```bash
npm install
cp packages/api/.dev.vars.example packages/api/.dev.vars
npm run dev
```

Set the Linear OAuth callback URL to:

```text
http://localhost:8787/auth/linear/callback
```

Fill `.dev.vars` with the Linear OAuth credentials, webhook signing secret, and two independent application secrets. Generate the encryption key with:

```bash
openssl rand -base64 32
```

## Account authentication

Factorize owns authentication in PostgreSQL. Create a native account at `/auth/signup` with an email address and a password of 12–200 characters. Emails are case-insensitive. Verify the email before signing in at `/auth/login`; email plus password are accepted. Linear is connected after sign-in from **Settings → Integrations**, only for Linear-backed jobs.

Postmark sends one-hour, single-use verification and password-reset links. `/auth/verify/request` resends verification; `/auth/password-reset` handles recovery. Links never appear in application responses or logs. Passwords use salted PBKDF2-SHA-256. **Change password** in the account menu requires the current password. Password reset, password change and sign-out invalidate existing sessions via membership session versions, including delegated API credentials.

Before deploying, configure `POSTMARK_SERVER_TOKEN` as a **production GitHub environment secret**. The deployment copies it to a Worker secret; the verified sender and transactional message stream are non-secret Worker vars in `packages/api/wrangler.jsonc`. For a manual Postmark preflight, set the following environment variables along with `APP_ORIGIN`:

| Setting | Required value |
| --- | --- |
| `POSTMARK_SERVER_TOKEN` | Postmark **server** API token for the sending server; never an account token or a committed value |
| `POSTMARK_FROM_EMAIL` | Plain email address on a verified Postmark sender signature or verified domain |
| `POSTMARK_MESSAGE_STREAM` | Active **transactional** stream ID, commonly `outbound` |

`APP_ORIGIN` must be the canonical HTTPS origin, without a trailing slash. Run `npm run auth:validate-email --workspace=factorize` manually when needed: it checks the server token/stream with Postmark and sends one preflight email from/to the configured sender, rejecting unverified senders or sending failures. It prints no credentials. Missing configuration fails the manual check. The deploy workflow does not run this check or send a preflight email. Runtime signup and recovery also fail closed if configuration or delivery fails; users can resend verification after a delivery failure. Local mail testing needs an HTTPS origin and a separate Postmark test server/sender; automated tests mock Postmark and never send mail.

### Existing account migration

Apply `0008_native_accounts.sql` and `0009_remove_auth_usernames.sql` before deploying this code. They reject ambiguous legacy emails that differ only in case (reconcile those identities before retrying migration), preserve tenant IDs, memberships, jobs and encrypted Linear connections, and backfill explicit Linear organization-to-workspace mappings. Existing Linear-only users choose **Forgot password or previously signed in with Linear?**, receive a reset email at their existing address, and set a password. Email possession is required; signup cannot replace an existing account's credentials. Existing native users keep their passwords and may sign in by email; unverified accounts must verify first. A reset never promotes a member to owner. An account with multiple existing owner memberships currently opens the oldest workspace; no new workspace-switching UI is introduced.

Linear OAuth requires an authenticated owner, binds state to that user/workspace, stores the connection there, and never creates a Factorize session. A Linear organization already bound to another workspace cannot be claimed. Existing webhook routes resolve the explicit mapping. Do not delete that binding to work around an account-recovery problem.

### Authentication verification

`npm run check` runs unit/contract tests and Postmark preflight tests. CI also runs the real PostgreSQL authentication suite against a disposable service. To run it locally, set `AUTH_TEST_DATABASE_URL` to an isolated PostgreSQL server whose user can create/drop test databases, then run `npm test --workspace=factorize -- --run test/native-auth.postgres.test.ts`. The suite creates and removes its own database and applies every migration, including a legacy connection fixture before the auth migration.

## Configure Linear

Use authorization-code OAuth and enable **Webhooks** on the OAuth application. Configure:

| Setting | Value |
| --- | --- |
| Callback URL | `https://your-domain.example/auth/linear/callback` |
| Webhook URL | `https://your-domain.example/webhooks/linear` |
| Webhook events | **Issues** and **Issue labels** |
| Webhook secret | Store as `LINEAR_WEBHOOK_SIGNING_SECRET` |

After changing the webhook settings, re-authorize existing workspaces so Linear creates a fresh workspace subscription.

## Configure ClickUp

Create a ClickUp OAuth application with the callback URL `https://your-domain.example/auth/clickup/callback`, then store its client ID and secret in `CLICKUP_CLIENT_ID` and `CLICKUP_CLIENT_SECRET`. Connecting ClickUp from Settings registers the signed task webhook automatically. ClickUp triggers can filter a list by status, tag, assignee, or creator; all configured rules must match.

## Create a Job

1. Sign in with Linear.
2. Connect exe.dev using an account-level HTTPS API token and the VM tags needed to attach integrations.
3. Create a Job, choose its execution target, and add authenticated provider triggers. Every Linear matching rule must match.

Matching provider events queue work up to the Job’s configured concurrency. Each run creates a tagged VM, clones the configured repository, runs the agent directly, captures its output, and deletes the VM on every terminal outcome.

Cloudflare Worker failures can also start Jobs through the separately deployable Tail relay. See [Cloudflare Tail job trigger](docs/cloudflare-tail.md).

## Configuration reference

| Variable | Purpose |
| --- | --- |
| `LINEAR_CLIENT_ID` | Linear OAuth client ID |
| `LINEAR_CLIENT_SECRET` | Linear OAuth client secret |
| `LINEAR_WEBHOOK_SIGNING_SECRET` | Verifies Linear webhook signatures |
| `CLICKUP_CLIENT_ID` | ClickUp OAuth client ID |
| `CLICKUP_CLIENT_SECRET` | ClickUp OAuth client secret; ClickUp also uses a per-installation webhook secret stored encrypted by Factorize |
| `CREDENTIAL_ENCRYPTION_KEY` | Base64-encoded 32-byte key for encrypted credentials |
| `SESSION_SIGNING_SECRET` | Independent secret for signed browser sessions |
| `APP_ORIGIN` | Public Worker origin, configured in `packages/api/wrangler.jsonc` |
| `OAUTH_KV` | KV binding containing OAuth clients, grants, refresh tokens, and revocation state |

Never commit `.dev.vars` or production secret values. The included `.dev.vars.example` is a safe template.

## Development commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Build CSS and start local Wrangler development |
| `npm run build:css` | Compile Tailwind into `packages/api/public/styles.css` |
| `npm test` | Run the unit test suite |
| `npm run check` | Type-check/test the app and dry-run both Worker deployments |
| `npm run deploy:app` | Deploy only the `factorize` app Worker |
| `npm run deploy:tail-relay` | Deploy only the `factorize-tail-relay` Worker |
| `npm run deploy` | Deploy the app, then the Tail relay; stop on the first failure |

GitHub Actions installs the single root lockfile and runs `npm run check` on every push and pull request. The two packages are independently deployable Cloudflare Workers; the root scripts only provide a unified developer workflow.

## REST API and OAuth

Read the complete, implementation-accurate API and MCP documentation at [docs.factorize.sh](https://docs.factorize.sh), including the checked-in [OpenAPI definition](packages/docs/openapi.yaml).

API clients use OAuth 2.1 authorization code flow with PKCE S256 or the OAuth 2.0 Device Authorization Grant for headless environments. Factorize publishes authorization-server and protected-resource discovery metadata, supports Client ID Metadata Documents, and retains dynamic client registration at `/oauth/register` for older clients. Access tokens last one hour and may be refreshed for up to 30 days; RFC 7009 revocation is advertised by discovery metadata.

Available scopes are `flows:read`, `flows:write`, `runs:read`, and `runs:write`. The resource owner must sign in through the native Factorize session and explicitly approve the requested scopes. Factorize rechecks owner membership and session version on every service call.

The versioned API is rooted at `/api/v1`:

```bash
curl -H "Authorization: Bearer $FACTORIZE_ACCESS_TOKEN" \
  https://app.factorize.sh/api/v1/jobs

curl -H "Authorization: Bearer $FACTORIZE_ACCESS_TOKEN" \
  'https://app.factorize.sh/api/v1/runs?jobId=JOB_ID&state=running&contextQuery=customer%20impact&limit=25'

curl -H "Authorization: Bearer $FACTORIZE_ACCESS_TOKEN" \
  https://app.factorize.sh/api/v1/runs/RUN_ID

curl -X POST -H "Authorization: Bearer $FACTORIZE_ACCESS_TOKEN" \
  https://app.factorize.sh/api/v1/runs/RUN_ID/stop
```

Connected GitHub App installation metadata, including the installation IDs used by GitHub Job triggers, is available without exposing credentials:

```bash
curl -H "Authorization: Bearer $FACTORIZE_ACCESS_TOKEN" \
  https://app.factorize.sh/api/v1/github-installations
```

Job CRUD is available at `/jobs` and `/jobs/:id`; job metadata includes `currentRuns` and `maxConcurrency`. Run collections return `{ "items": [...], "nextCursor": "..." }`; pass `nextCursor` back as the `cursor` query parameter. Runs can be filtered by `jobId`, `state`, and `contextQuery`; context queries use case-insensitive literal substring matching and matching items contain a bounded `context_excerpt`, never the full context. `GET /runs/:runId` returns the rendered `prompt`, complete structured trigger `context`, and invocation metadata, including the firing `trigger_id`. The canonical Job prompt contract is documented in [docs/job-trigger-context.md](docs/job-trigger-context.md). Errors consistently use `{ "error": { "code": "...", "message": "..." } }`.

Production diagnostics are authenticated and tenant-scoped. `GET /api/v1/runs/:runId/diagnostics` reports generic run lifecycle checks without returning credentials or internal command payloads. `POST /api/v1/integrations/exe/:connectionId/diagnostics` checks saved exe.dev permissions and creates then deletes a disposable tagged VM to verify the configured agent and managed model integration.

The Wrangler-backed E2E suite loads the complete Worker and Durable Objects from `wrangler.jsonc`. Its exe.dev lifecycle tests disable external networking and use a stateful command-API stub to cover successful completion, masked shell-launch failures, run diagnostics, integration diagnostics, output capture, and VM cleanup without creating a real VM or calling an LLM.

## MCP clients

Configure a compatible remote MCP client with this single URL:

```text
https://app.factorize.sh/mcp
```

The client discovers OAuth automatically, opens Factorize in a browser, completes native Factorize sign-in if necessary, requests consent, and returns to the client after PKCE authorization. No Linear or exe.dev credential is copied into the MCP client. The server is stateless Streamable HTTP and exposes Job CRUD, run inspection/filtering, provider webhook activity, and active-run stopping tools.

Factorize also supports the OAuth 2.0 Device Authorization Grant (RFC 8628) for headless clients. Discovery advertises `device_authorization_endpoint`; clients obtain a code from `POST /oauth/device_authorization`, direct the user to `/device`, and poll `/oauth/token` with grant type `urn:ietf:params:oauth:grant-type:device_code`. Device codes expire after ten minutes, polling is rate-limited, and approved grants use the same scoped access and refresh tokens, tenant checks, and revocation behavior as browser PKCE authorization.

## Security

- Linear and exe.dev credentials, issue prompts, and agent results are AES-GCM encrypted at rest in the Durable Object.
- Linear webhooks require a valid HMAC-SHA256 signature and fresh timestamp before workspace routing.
- Session cookies are signed, expire after seven days, and are checked against workspace membership.
- OAuth access is tenant-bound, scope-checked, revocable, and revalidates current owner membership at the shared service boundary.
- Public REST and MCP responses omit connection tokens, credential records, and internal execution requests/responses. Authorized run inspection includes the rendered prompt sent to the agent.
- Agent output is retained in Factorize run inspection and is not copied into Linear.
- The dashboard uses a restrictive content-security policy and locally built Tailwind CSS.

## License

[Apache License 2.0](LICENSE)
Test line for the Factorize PR-check and merge-queue flow.

### Static application migration

The existing Worker now lives in `packages/api`. `packages/app` contains the Vite/React frontend foundation and `packages/api-client` contains the generated public API client. Production still serves the existing dashboard while feature routes migrate. See [the staged rollout and route inventory](docs/package-migration.md).

| Command | Purpose |
| --- | --- |
| `npm run dev:api` | Run the existing API/legacy dashboard Worker |
| `npm run dev:app` | Run the static frontend development server |
| `npm run generate` | Generate OpenAPI and browser client types |
| `npm run build:app` | Build static frontend assets |
| `npm run check:boundaries` | Reject frontend/backend implementation imports |
| `npm run check` | Validate packages, generated client, tests and builds |

Use Node 24. Keep local secrets in `packages/api/.dev.vars`; the static frontend does not expose environment variables.
