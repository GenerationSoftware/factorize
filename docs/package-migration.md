# GEN-2157 static application and rollout

## Architecture

`packages/api` owns the existing `factorize` Cloudflare Worker, protocols, database,
scheduler, execution and ingestion. `packages/app` is a static Vite/React/Tailwind
application with lazy TanStack Router routes and a single TanStack Query cache.
`packages/api-client` contains browser-safe types/client generated from the executable
API catalog and committed OpenAPI. Browser features import that public package only.
CI rejects static, dynamic and type imports across implementation boundaries, checks
client/contract drift and keeps merge-group checks.

The same Worker identity and ASSETS binding serve the separate static build under
`https://app.factorize.sh`. The Worker does not generate application/consent/device
HTML. `ui.ts`, browser-source generators, generated CSS and their extracted-script/
source-substring tests are retired. Feature browser tests exercise compiled React.
No database migration or production binding/resource/secret/issuer is renamed.
`scripts/hosting-invariants.test.mjs` compares all backend configuration with the
pre-cutover snapshot, including all six Durable Object migrations.

## Exact route ownership

| Read namespace | Owner | Other methods |
| --- | --- | --- |
| `/`, `/jobs`, `/jobs/new`, `/jobs/:id`, `/jobs/:id/edit`, `/job-runs/:id` | Static GET/HEAD entry | Backend 404 |
| `/settings`, `/settings/integrations`, `/settings/api-keys`, `/settings/authorized-clients`, `/settings/password` | Static GET/HEAD entry | Backend 404 |
| `/auth/login`, `/auth/signup`, `/auth/password-reset`, `/auth/verify`, `/auth/verify/request` | Static GET/HEAD entry | Existing form handlers where registered |
| `/authorize` | Backend validates owner, client and OAuth request, then static GET/HEAD consent | Existing signed POST consent handler, Origin protected |
| `/device` | Backend owner check, then static GET/HEAD device screen | Existing POST device approval, Origin protected and row locked |
| `/assets/:filename`, `/styles.css` compatibility asset | Static asset binding | Backend 404 |
| `/api/v1` and descendants | API for every method, including errors | Never SPA HTML |
| `/oauth`, `/mcp`, `/.well-known/*` | OAuth/device/MCP protocols | Never SPA HTML |
| Provider `/auth/linear`, `/auth/clickup`, `/auth/github/install`, their registered callbacks/setup URLs | Existing backend redirects/callbacks | Never SPA HTML |
| `/webhooks`, `/internal`, `/healthz` | Existing backend handlers | Never SPA HTML |
| Unknown paths or extra application segments | Backend 404 | Never SPA HTML |

The assets configuration uses `run_worker_first:true` and `not_found_handling:none`.
There is no blanket SPA fallback. Explicit deep links fetch the built `/index.html`;
query parameters stay in the browser URL and are never embedded in HTML. Static
route guards are UX only; every API request retains server-side authorization.

## Public contracts and compatibility

All JSON application operations are catalogued/dispatched under `/api/v1` through
`packages/api/src/protected-api.ts`. Public schemas describe required/nullable fields
and safe mappings for identity, jobs/triggers, targets/provider resources, settings,
keys/clients, runs and trace pages. Full run mapping enumerates existing safe row
fields/aliases; manual invocation occurrence may be null. Secret fields never enter
public integration/job responses. Invalid server output is an internal error, not a
400 client validation error. Opaque user context and diagnostic payloads remain JSON
records, not backend implementation types.

Session/native auth uses existing Secure-on-HTTPS, HttpOnly, SameSite=Lax cookies.
Exact declared public auth operations bypass authentication; other application
operations do not. Auth JSON rejects Authorization headers. Cookie mutations,
including login/logout and consent/device decisions, require exact APP_ORIGIN and
reject cross-site fetch metadata. Bearer REST/MCP clients and signed callbacks keep
their existing policy. Owner-session restrictions, tenant membership, session version,
revocation, non-enumerating requests and transactional one-time tokens remain server
owned. Safe local return paths and the interrupted OAuth/device cookie survive login.
Identity changes clear tenant queries/mutations and remount local feature state.
Passwords, grants and API keys are never stored in localStorage; only theme preference is.

Consent previews bind a parsed server-owned OAuth request to owner/tenant/session
version and expiry. Decisions recheck registered redirects and selected scopes before
issuance. Device previews expose only client/scopes/code/expiry; decisions lock pending
records and never expose protocol credentials to the browser. Legacy native form POST
URLs remain: successes retain cookies/redirects, and errors/instructions use plain text,
without backend HTML rendering. Existing OAuth token/register/metadata URLs are unchanged.

Full jobs arrays, full run detail, legacy trace pages and MCP tool names remain available.
Summaries/selectors are additive bounded pages, UUID-descending with exclusive cursor,
literal case-insensitive search and optional enabled filter; keep filters fixed between
pages. Statistics are batched and prompts/config are omitted from summaries. No
cross-request snapshot across job pages is promised. Conditional writes use optional
`expectedUpdatedAt`: stale writes return `409 stale_job`; omission retains legacy
last-writer-wins REST/MCP behavior. Enabled-state changes advance the revision. The
editor performs a three-way merge and requires explicit choices for overlapping fields;
triggers reconcile atomically while retaining server identities.

Canonical run states include succeeded/stopping/stopped. `state=done` retains compatibility
with historical done and canonical succeeded; ignored remains a literal legacy filter.
Status avoids full detail decryption/assembly. Trace revisions bind metadata/pages to one
statement snapshot; mismatches reset from zero and discard old caches. Live appends retain
revision; canonical replacement/replay changes it. Polling continues through terminal
artifact/cleanup finalization. Rich data loads on expansion; continuous traces virtualize
DOM and retain expanded/focused/selection-endpoint rows. Markdown never interprets raw
HTML, and ANSI becomes escaped React text with generated style values.

## Local development and validation

Use Node 24.12+ and `npm ci`. Install Chromium with
`npx playwright install --with-deps chromium`. `npm run dev` builds the frontend and
starts Vite and local Wrangler together. Open `https://localhost:5173`, accepting the
local development certificate. OpenSSL creates ignored `.dev-certs` for Vite; Wrangler
uses its own local HTTPS certificate. `npm run dev:api` and `npm run dev:app` also work
in separate terminals. The API dev command sets APP_ORIGIN to the HTTPS Vite origin;
the proxy preserves Host/Origin and same-origin cookies. The OAuth library requires an
HTTPS issuer even locally. The proxy's self-signed-certificate exception is development
configuration only; production CSP/CORS/issuer identifiers do not change.

Keep local secrets in ignored `packages/api/.dev.vars`, and provide a local PostgreSQL
Hyperdrive connection using the documented Wrangler environment variable
`CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`. Vite exposes no environment
prefix and never reads API secrets. Regenerate the development certificate after its
30-day expiry by deleting `.dev-certs` and restarting.

- `npm run generate`: OpenAPI then generated client; drift is checked in CI.
- `npm run build:app`: static production output. `build:css` is a compatibility alias.
- `npm run build`: frontend and marketing production builds.
- `npm run check`: hosting/infrastructure/deployment gates, package boundaries, generated
  client, TypeScript, compiled browser suites, API tests, actual local Cloudflare routing,
  real OAuth/device/REST/MCP protocol round trips when AUTH_TEST_DATABASE_URL is set,
  and API/tail-relay dry runs. The hosting runtime test uses local KV/assets and a loopback
  Hyperdrive URL, never production state.
- `npm run test:static-slice --workspace=factorize`: compiled React through actual Worker
  routing/dispatcher/repositories and disposable PostgreSQL. Build app first; set
  AUTH_TEST_DATABASE_URL to a disposable local admin database.
- `npm run validate --workspace=factorize-docs` and `npm run build:marketing` preserve docs/
  marketing checks. Tail relay remains independently deployable.

The protocol runtime test uses an isolated local KV directory and disposable PostgreSQL,
actual dynamic client registration, signed owner sessions, PKCE consent, device approval,
OAuth MCP calls and scoped API-key REST/MCP calls. It verifies session-version revocation
and preserves the OAuth `/mcp` audience (OAuth tokens do not gain REST access).

CI provisions PostgreSQL, installs Chromium and runs the real static slice after the
root checks. Browser feature fixtures complement the real dispatcher/DB slice: external
provider infrastructure and actual execution scheduling are not launched by those tests.
Performance samples and limitations are in
`packages/api/performance/GEN-2157-feature-parity.md`. Historical baseline artifacts remain.
`gen-2157-legacy-compatibility.json` records seven legacy screens against the new API,
using five Chromium samples per screen and disposable PostgreSQL with 20 ms query delay.

## Staged production rollout

1. Deploy **API compatibility anchor `ff4b51b`** before the static cutover. This anchor
   contains every dependent API addition and the documented session response header
   `X-Factorize-Contract:gen-2157-static-v1`, while still serving legacy HTML and CSS.
   Use an isolated checkout/worktree of that commit, `npm ci`, `npm run build:css`, and
   the existing `npm run deploy:app` for the same Worker. Do not change state bindings,
   secrets, origins or database state. The root stage check and legacy Chromium repeat
   validate old-frontend/new-API compatibility. For a fresh self-hosted installation,
   bootstrap this API stage at the configured HTTPS origin before deploying the static tree.
2. Verify the public session marker with
   `node scripts/verify-public-routing.mjs https://app.factorize.sh --api-ready`.
   The final production workflow checks this **before** migrations, secret configuration
   or deployment, and refuses static cutover if the API stage is absent. Normal root/API
   deploy commands perform the same gate and build static output. For direct CLI deployment
   after the first cutover, set `FACTORIZE_RETAINED_ASSET_ARCHIVES` to trusted release zip
   archives from every app deployment in the previous 30 days (OS path delimiter). The
   command restores them and checks the live entry bundle is included; otherwise it refuses
   deployment. Prefer the workflow, which selects these archives automatically. `deploy:prepared` is
   reserved for the workflow after its gate, build and asset restoration.
3. Deploy the final tree with the existing production workflow/environment. It builds
   static assets, seeds the old stylesheet from preserved commit `2d63d64`, restores
   immutable chunks from actual successful trusted app deployments in the last 30 days,
   and deploys the existing `factorize` Worker. All prior infrastructure identities and
   migration history remain unchanged. Marketing is deployed before the app so its failure
   cannot prevent recording a successful app snapshot. No new state resources are provisioned.
4. The workflow uploads the **current release only**, not recursively retained chunks,
   as a 35-day artifact. Future restoration trusts this repository's deploy workflow on main or the explicit
   initial-cutover branch `gen-2157-auth-contracts` (not arbitrary branches or forks)
   and verifies its app-deployment step succeeded, including runs whose later verification
   failed. Extraction restores only safe asset filenames/legacy CSS; never entry HTML,
   configuration, symlinks or traversal paths, and immutable collisions fail closed.
5. The workflow runs `scripts/verify-public-routing.mjs` against the real public origin
   after deployment. It verifies deep links, external bundles, static CSP/security/cache
   headers, API/protocol error ownership and unchanged OAuth issuer/device metadata.
   Complete authenticated owner/provider/OAuth/MCP smoke checks in the production environment
   as part of release review. Local runtime/DB/browser checks alone do not establish
   production acceptance; see the separate production evidence and owner report below.

Static responses use external-bundle CSP with no nonce/unsafe-inline, nosniff, DENY frame
policy, same-origin referrer policy, permissions policy and HTTPS HSTS. Hashed assets cache
immutably; entry HTML revalidates. Missing chunks are no-store and display an explicit
recovery notice; no automatic reload discards a draft. Open tabs older than the retention
window may need a deliberate reload. Small root HTML is never restored from an old artifact.

## Rollback

Use **`ff4b51b`**, which retains all new APIs while restoring legacy page ownership.
Never revert database state or rename/recreate a Worker to roll back the frontend.
In an isolated anchor checkout, build legacy CSS; restore the last current/retained
`assets/` from trusted successful deployment artifacts into `packages/api/public/assets/`.
Do not copy index.html. The anchor's assets-first binding serves those hashed assets to
already-open SPA tabs while its backend serves legacy deep links. Keep `/styles.css`.
Deploy that checkout with its existing root command. OAuth KV, sessions, R2, Hyperdrive,
scheduler and migration history remain the same. Verify session marker, legacy login,
jobs/run/settings links and existing bearer REST/MCP clients. A corrected static rollout
can then deploy from the final tree using the same retained asset set.

The local rollback runtime test starts the actual `ff4b51b` Worker with restored compiled
chunks and proves legacy login/deep-link ownership, the additive API marker, stylesheet
and unchanged chunk bytes. CI fetches history so the preserved anchor is available.

Local tests check restoration collisions/path safety, the unchanged infrastructure
snapshot and actual Cloudflare local route ownership. They do not perform a production
rollback, configure external OAuth clients, or migrate production data. Production
release gates intentionally remain operator-visible rather than silently claiming a
successful rollout from a draft PR or a prior agent's exit status.

## Production execution evidence (2026-10-09)

The compatibility anchor `ff4b51b` and static tree `c64590c` were deployed through
the existing production workflow, preserving infrastructure identity. The final
[deployment run](https://github.com/GenerationSoftware/factorize/actions/runs/37994318377)
passed, including archive restoration/upload and public routing/security/cache
verification. The first static run reached the previous Worker immediately after
deploy and failed on a 302 for `/jobs`; a later complete verifier passed. Post-deploy
verification now retries the full suite for at most 55 seconds of propagation waits
and still fails persistent errors. The API-first pre-write gate remains immediate.

Asset restoration explicitly trusts main and the initial cutover branch
`gen-2157-auth-contracts`, with repository/workflow/successful Worker-step checks.
This preserves initial-cutover chunks when future main deployments take over.
Read-only production bearer REST/MCP checks and anonymous Chromium auth/deep-link
screens passed. See `packages/api/performance/gen-2157-production-rollout.json`.
The earlier cutover-validation artifact remains historical local evidence.

Brendan Asselstine subsequently reported on GEN-2157 at 2026-10-09 21:46 UTC:
“I have checked app.factorize.sh and everything seems to work.” This supplies the
owner review requested after deployment. It is a general production acceptance
report, not an itemized automated result for each provider/OAuth/device scenario.
The attached integration remains bearer-only; no owner credentials were obtained.
A fresh public routing/security/cache verification also passed during final review.

## Branch and pull request lineage

All three branches share one linear history based on main `82a9cda`:

| Reference | Role |
| --- | --- |
| PR #205 / `gen-2157-package-boundary` at `a5c8579` | Initial mechanical move and package foundation; entirely included in #206 |
| `gen-2157-api-rollout-anchor` at `ff4b51b` | Intermediate additive API deployment and rollback checkpoint; intentionally retains legacy UI |
| PR #206 / `gen-2157-auth-contracts` | Complete migration, including the foundation, API anchor, static cutover and deployment fixes |

PR #206 is the canonical merge candidate. #205 requires no separate merge. The
anchor is older than #206, not a newer implementation, and must remain available
for documented rollback and the rollback runtime test. Preserve merge history
when landing #206 so the deployment's historical stylesheet and rollback commits
remain reachable; do not squash away the staged migration history.
