## Linear

This project in Linear is "Factorize"

## API architecture

- Every JSON application endpoint must live under `/api/v1` and be documented in `packages/docs/openapi.yaml`.
- Frontend code must call the same `/api/v1` endpoints as external clients. Never add a frontend-only `/api/*` route.
- Register API operations only in `packages/app/src/protected-api.ts`; page, auth callback, webhook, health, and internal routes belong in their existing non-API namespaces.
- A new API operation must include authorization, validation, OpenAPI documentation, and contract or boundary tests in the same change.
- `/auth`, `/oauth`, `/webhooks`, `/internal`, `/mcp`, and `/healthz` are explicit non-API namespaces and must not be used to hide frontend application endpoints.
