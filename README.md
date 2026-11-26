# Factorize

Factorize is a development environment for your agent. [Open Factorize](https://app.factorize.sh)
and connect a supported MCP client to `https://app.factorize.sh/mcp`.

- Use approved APIs from services you connect, without giving your agent raw credentials.
- Give a supported workload, such as a VM, its own scoped access.
- Publish durable Events from webhooks, schedules, or manual Triggers so subscribers can decide what to do.

You control what gets connected, what access is approved, and when to revoke it.
[Try your first task](https://docs.factorize.sh/quickstart) or browse
[MCP tools](https://docs.factorize.sh/mcp/tools) and the
[generated REST contract](https://docs.factorize.sh/openapi.yaml).

## Operators and contributors

- [Optional self-hosting](https://docs.factorize.sh/self-hosting/deployment)
- [Documentation development](docs/mintlify.md)

Use the Node and npm versions pinned in the repository. Run `npm ci`, then
`npm run dev`. Run `npm run test:local` on the [pinned validation
runner](docs/factorize-validation-runner.md); it resets only the isolated local
database. See [repository validation](docs/ci-testing.md) for other checks.

The Worker is in `packages/api`, the frontend in `packages/app`, and the
generated public contract in `packages/api-client`. The frontend uses the
same `/api/v1` routes as external clients.
