# GEN-2157 staged package migration

## Current stage

Inventory based on main `82a9cda` (October 9, 2026), including #200 OpenAPI, #201 split Run, #202 trace activity, #203 mutation feedback and #204 loading improvements. The checkout was clean. The first commit moves the existing Worker to `packages/api`; the next adds an isolated static application and generated public client. **This is a foundation, not the completed React migration.** No production route has been cut over. Legacy HTML and CSS remain in the API during the compatibility period.

The Worker npm name remains `factorize`, while the browser package is `factorize-app`. Worker configuration is unchanged: name `factorize`, APP_ORIGIN `https://app.factorize.sh`, OAuth KV, Hyperdrive, R2, scheduler binding and all six Durable Object migrations. A package directory move must never rename these resources. The deployment workflow's secret configuration directory now points to `packages/api`; migration and deploy commands still select the existing Worker.

## Route inventory and final ownership

| Namespace | Current owner | Required final ownership |
| --- | --- | --- |
| `/api/v1` and descendants, every method | API/OAuth provider | API, including unknown paths and unsupported methods; never SPA fallback |
| `/mcp` | OAuth provider and protected API | API; preserve resource/issuer identifiers |
| `/oauth/token`, `/oauth/register`, `/oauth/device_authorization` | OAuth provider/device protocol | API |
| `/.well-known/*` | OAuth provider metadata | API |
| `/authorize` GET/POST | Worker parses request, renders consent, issues grant | Static consent screen via server-owned binding; protocol validation and POST semantics remain API-owned |
| `/device` GET/POST | Worker/device handler renders and approves device grants | Static device screen with documented support operations; approvals and grants remain API-owned |
| `/auth/linear`, `/auth/linear/callback` | Worker integration connection | API redirects/callbacks |
| `/auth/clickup`, `/auth/clickup/callback` | Worker integration connection | API redirects/callbacks |
| `/auth/github/install`, `/auth/github/setup` | Worker integration connection | API redirects/callbacks |
| `/auth/login`, `/auth/signup`, `/auth/password-reset`, `/auth/verify`, `/auth/verify/request` GET | Legacy user screens | Static screens, retaining links/query parameters |
| `/auth/login`, `/auth/signup`, `/auth/password-reset`, `/auth/password-reset/complete`, `/auth/verify`, `/auth/verify/request`, `/auth/password-change`, `/auth/logout` POST | Legacy native auth forms | Compatibility handlers retained until rollout; new JSON operations must be catalogued under `/api/v1` |
| `/webhooks/*`, `/internal/*`, `/healthz` | Worker | API, no static fallback |
| `/`, `/jobs`, `/jobs/new`, `/jobs/:id`, `/jobs/:id/edit`, `/job-runs/:id`, `/settings`, `/settings/integrations`, `/settings/api-keys`, `/settings/password` GET | Legacy HTML UI | Static app after feature parity |
| `/styles.css` | Legacy assets | Retain during rollback window; Vite assets use separate hashed paths |
| Unknown paths/methods | Worker 404/protocol errors | Explicit 404 outside the allowlisted static application routes |

Method-specific ownership matters: GET consent/device/auth screens cannot cause their POST protocol handlers to become static responses. A blanket SPA fallback would hide API 404s and break protocol clients. Route selection must be tested before deployment.

## Development and checks

Use Node 24 and `npm ci`. Existing `npm run dev` runs the legacy Worker. `npm run dev:api` is an explicit alias; `npm run dev:app` runs Vite on localhost:5173. Run these in separate terminals. For Vite browser authentication set the local API `APP_ORIGIN` to `http://localhost:5173` in `packages/api/.dev.vars`; the proxy preserves browser Host/Origin and cookies. Keep secrets only in the API's ignored `.dev.vars`. Vite exposes no environment prefix. No production CORS or OAuth identifier changes are required.

`npm run generate` regenerates OpenAPI then the browser client. `npm run check` validates client drift, package imports, static build and existing Worker suites/type checks/dry runs. CI preserves `merge_group` checks and explicitly checks generated artifact diffs. `npm run build:app` builds the static application; `npm run build:css` continues to build the legacy UI while it is needed. Generated bundles remain ignored. The committed legacy CSS is intentionally retained until its consumers migrate.

The browser uses only `factorize-api-client` to access the public contract. Generated types reflect current contract coverage, including its remaining generic schemas; they do not establish that those schemas are complete. Contract completion is a prerequisite for feature migration. The API cannot import browser runtime code, and the client cannot import either implementation. The boundary checker resolves TypeScript aliases and checks static/dynamic/type imports. Its adversarial fixtures run in CI.

## Rollout and rollback gates

1. Land the mechanical move/foundation with legacy routing unchanged. Confirm deployment still targets the same Worker and state bindings.
2. Add narrow public native-auth/session operations, metadata, complete response mappings/schemas and compatible performance representations. Every JSON operation goes through `packages/api/src/protected-api.ts` and its executable catalog. Test cookie mutation origin checks, tenant isolation, owner/scoped access and external bearer clients. Deploy these additions before any dependent SPA.
3. Demonstrate jobs → detail → invoke → run/trace parity and measurements. Keep the old UI working against the new API. Then cut over editor, provider/settings, auth, consent and device screens independently.
4. Configure same-origin static hosting with an allowlist of application GET routes and `/assets/*`. Backend namespaces take precedence for all methods. Use external-bundle CSP (`default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`), retain other security headers, cache hashed assets immutably and revalidate entry HTML. Retain prior deployment assets for open tabs. Handle chunk failures with a recoverable notice without automatically dropping unsaved work.
5. Verify direct refresh, unsupported API methods/404s, OAuth/device/native-auth links and critical browser flows against the actual routing layer. These hosting changes are not configured or deployed by this foundation.
6. Roll back a screen by restoring its previous route owner/assets, keeping additive API support. Never roll back database state or provision a new Worker to undo a frontend cutover. Retain compatibility handlers until the previous frontend can no longer be served. Remove legacy rendering/CSS only after parity, rollback and acceptance checks are complete.

## Baseline and remaining work

`packages/api/performance/GEN-2154.md` and its JSON artifacts preserve the landed small-workspace baseline. #204 already changed jobs data-query growth from `1 + 2N` to three batched queries; do not reintroduce per-item statistics. It still returns full jobs and decrypts their prompts. Existing editor/provider behavior, mutation pending feedback and persistent trace thinking indicators remain in the moved code.

Before SPA cutover, extend the fixture with representative large job/trace datasets, capture request counts, data query counts, response bytes and timings for jobs/detail/editor/run refresh, and compare the same fixture after migration. Current measurements are historical #204 evidence; no migration performance improvement is claimed.

Remaining acceptance work includes session/native-auth JSON APIs and CSRF, consent/device support operations, contract completion and legacy run-state policy, bounded summary/selector pagination, conditional edits, lightweight run polling and revision-bound trace pagination, every feature screen, cache clearing, accessible/mobile/browser parity, deployment routing/header tests and measured large-trace virtualization. Do not mark GEN-2157 Done on the basis of this foundation.

## Foundation validation (October 9, 2026)

The moved code passed the existing 339 non-database tests before local PostgreSQL was installed. The signed-cookie Playwright loading baseline was then repeated on Node 24.21.0, PostgreSQL 16 and Chromium 156 with ten jobs, five samples per screen and 20 ms injected query delay. Raw results are in `packages/api/performance/gen-2157-foundation.json`. This is a fresh repeatability baseline, not a before/after performance comparison; another suite was running on the VM, so timings must not be used to attribute a regression or improvement. The fixture covers seven screens but does not yet record request counts/bytes or representative large workspaces.

The first database run incorrectly selected an unmigrated queue-test database; its three queue tests failed with missing tables. A dedicated disposable local database was created and repository migrations applied before the final run. Production state and integrations were not used for test writes.
