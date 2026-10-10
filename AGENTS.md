## Linear

This project in Linear is "Factorize"

## Validation

Use Node 24.12.0 and npm 11.19.0 (`.node-version` and `package.json`) and run `npm ci` after a clean checkout.
Run `npm test` after the final code change; it is the complete required local
validation and runs the shared backend and browser lanes used by CI. `npm run
check` is an alias for the same suite. Targeted workspace commands remain
available for iteration, but do not replace the root suite before handoff.

For a fresh local VM, install PostgreSQL and Chromium as needed, then run
`npm run bootstrap:test`. It creates an isolated local database, applies
migrations, and prints the variables to export before `npm test`. Never point
validation at production or a shared database. A missing database, Node
version, or Chromium prerequisite is a hard failure with a recovery command.

## API architecture

- Every JSON application endpoint must live under `/api/v1` and be documented in `packages/docs/openapi.yaml`.
- Frontend code must call the same `/api/v1` endpoints as external clients. Never add a frontend-only `/api/*` route.
- Register API operations only in `packages/api/src/protected-api.ts`; page, auth callback, webhook, health, and internal routes belong in their existing non-API namespaces.
- A new API operation must include authorization, validation, OpenAPI documentation, and contract or boundary tests in the same change.
- `/auth`, `/oauth`, `/webhooks`, `/internal`, `/mcp`, and `/healthz` are explicit non-API namespaces and must not be used to hide frontend application endpoints.

## Package boundaries

- `packages/api` owns the Worker. Its npm name remains `factorize` during the staged migration; this does not change production infrastructure identity.
- `packages/app` is the static frontend (`factorize-app`). It may only import the generated public contract through `factorize-api-client`; never import backend implementations.
- `packages/api-client` is generated from the published OpenAPI document. It must have no backend or frontend implementation dependencies. Run `npm run generate` after contract changes.
- Run `npm run check:boundaries` to validate imports, including dynamic imports and type imports. Do not add aliases or build configuration that bypasses these boundaries.
- Application HTML belongs to the static frontend. Backend protocol/form compatibility handlers may redirect or return JSON/text but must not generate UI HTML.
- Keep full-list/detail/trace and conditional-write omission compatibility for external REST/MCP clients.
- Deploy the documented additive API anchor before static cutover; preserve Worker identity/bindings/migrations and retain old hashed assets. Follow the release and rollback gates in `docs/package-migration.md`.
