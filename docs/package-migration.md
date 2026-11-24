# Package architecture and release procedure

## Architecture

- `packages/api` owns the `factorize` Worker, JSON API, MCP server, database migrations, schedules, and provider webhooks.
- `packages/app` is the static React frontend. It calls the same documented `/api/v1` operations as external clients.
- `packages/api-client` is generated from `packages/docs/openapi.yaml` and has no application implementation dependencies.

Application HTML belongs to the static frontend. Backend auth, OAuth, MCP,
webhook, health, and internal protocol routes remain in their existing
namespaces. Every JSON application operation is documented in OpenAPI and
registered in `packages/api/src/protected-api.ts`.

## API and schema changes

1. Add or change an authorized and validated API operation in the executable API catalog.
2. Add the matching SQL migration and Drizzle schema update. Migrations are forward-only; destructive data removal must be explicit and tested against the isolated local database.
3. Run `npm run generate` to refresh the OpenAPI document, API client, and embedded workflow Skills.
4. Update the browser frontend to call the documented API client operation.
5. Add or retain focused contract, tenant-boundary, browser, and database coverage for the changed behavior. Delete tests for retired features rather than keeping dead compatibility expectations.

Events are versioned definitions with durable occurrences. Triggers belong to
one Event and publish occurrences from configured input sources. MCP update
notifications indicate that stored occurrence data is ready to read; they are
not the persistence mechanism.

## Local development and validation

Use Node 24.21.0 and npm 11.19.0. After a clean checkout run `npm ci`. For full
local validation, use the image and isolated database described in
[`factorize-validation-runner.md`](factorize-validation-runner.md), then run
`npm run test:local`. This applies migrations and runs the complete root suite.
Never point validation at production or a shared database.

Run `npm run generate`, `npm run check:boundaries`, `npm run build:app`, and
`npm run validate --workspace=factorize-docs` during focused development as
appropriate. The root suite remains the complete handoff gate.

## Release and rollback

Deploy the Worker and its additive API contract before deploying static
frontend assets. Keep the Worker identity, bindings, scheduler Durable Object,
OAuth data, and migration history stable. The deploy process retains recent
hashed assets so already-open frontend tabs continue to load their chunks.

Before static cutover, confirm the API contract marker and run the public
routing checks. After deployment, verify static deep links, immutable assets,
API ownership, MCP/OAuth routes, and security/cache headers. For rollback,
redeploy a compatible Worker/frontend release while retaining current hashed
assets; do not revert applied database migrations or delete production data.
