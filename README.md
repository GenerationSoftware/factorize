# Factorize

[![CI](https://github.com/GenerationSoftware/factorize/actions/workflows/ci.yml/badge.svg)](https://github.com/GenerationSoftware/factorize/actions/workflows/ci.yml)

Factorize hosts jobs for your coding agents. **Connect your agent → create a job → run it → inspect the result → automate it.**

Start at [app.factorize.sh](https://app.factorize.sh). Sign up with email and password, verify email, and connect an execution account in **Settings → Integrations**. You supply execution, repository/model access and any provider accounts; Factorize hosts job configuration, triggers, queues and run history.

Connect a supported remote MCP client to:

```text
https://app.factorize.sh/mcp
```

Follow [Connect your agent](https://docs.factorize.sh/mcp/overview) for Codex/Claude Code configuration and browser consent. Then ask:

> Show me my available execution targets. Create a manual job called ‘Review recent changes’ using my repository’s target. Have it clone REPOSITORY_URL, review the latest commit and summarize any problems. Run it once and report the result.

The conversational agent calls `list_execution_targets`, checks existing jobs, creates a job, invokes it with a stable idempotency key, and reads `get_run` until completion. Current exe.dev targets select an account/agent, not a repository: put the repository URL in the prompt. Browser-only signup, integration credentials, resource selection and consent are separate from MCP job management.

Read [Your first job](https://docs.factorize.sh/quickstart), [safe editing and configuration replacement](https://docs.factorize.sh/work/jobs), and [stop/retry behavior](https://docs.factorize.sh/work/stop-retry). Add [schedules](https://docs.factorize.sh/recipes/scheduled-review), [Linear](https://docs.factorize.sh/recipes/linear-job), [GitHub](https://docs.factorize.sh/integrations/github), [ClickUp](https://docs.factorize.sh/integrations/clickup), or [job chaining](https://docs.factorize.sh/recipes/chaining) after a successful manual run.

MCP provides selected scoped operations, not every REST capability. REST contracts remain available in [OpenAPI](packages/docs/openapi.yaml) and [authentication reference](https://docs.factorize.sh/api/authentication). Credential management and trace replay require an interactive owner session. Agents can use the generated [llms.txt](packages/docs/llms.txt) and [llms-full.txt](packages/docs/llms-full.txt).

## Development and documentation

Use Node 24.12.0 and npm 11.19.0 (`.node-version` and `package.json`), then run `npm ci`, `npm run dev`, and `npm test`. The root test is the complete required validation used by CI; `npm run check` is an alias, and `npm run test:backend` / `npm run test:browser` are the focused shared lanes. The Worker lives in `packages/api`, React frontend in `packages/app`, and generated public contract in `packages/api-client`. Frontend calls documented `/api/v1` routes. Keep local secrets in ignored `packages/api/.dev.vars`.

For a fresh VM, install PostgreSQL and Chromium, run `npm run bootstrap:test`, export the three printed database variables, and then run `npm test`. The bootstrap uses only an isolated local database and refuses remote URLs. Missing prerequisites must be fixed before handoff; do not mark work done after only `git diff --check`.

Run `npm run generate --workspace=factorize-docs` after guide edits and `npm run validate --workspace=factorize-docs` before publishing. See [docs publishing](docs/mintlify.md) and [package migration](docs/package-migration.md) for development and release gates.

## Optional self-hosting

Hosted users do not deploy Factorize. To operate your own instance, follow [deployment](https://docs.factorize.sh/self-hosting/deployment), [configuration](https://docs.factorize.sh/self-hosting/configuration), and [operations](https://docs.factorize.sh/self-hosting/operations). These contain Cloudflare/Worker, Postmark, provider OAuth registration, webhook infrastructure and secret setup.

[Apache License 2.0](LICENSE)
