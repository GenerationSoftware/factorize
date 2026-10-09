## Linear

This project in Linear is "Factorize"

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
- Keep the legacy UI and production routing working until each replacement screen has parity and the rollout checks in `docs/package-migration.md` pass.
