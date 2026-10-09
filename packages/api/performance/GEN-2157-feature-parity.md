# GEN-2157 feature reads and long traces

The committed `gen-2157-feature-reads.json` records a warmup and five samples for
both a 10-job workspace and a 205-job workspace with 50k-character prompts/context
and 20,000 trace events. The API service includes authoritative authorization.
Queries count database calls; request counts represent equivalent API operations,
not complete browser navigation. Timing includes local PostgreSQL 16 and encryption,
not Cloudflare/Hyperdrive or network transit. Historical artifacts remain unchanged;
changes in fixture trigger configuration and random ordering mean their exact byte
counts and timings must not be used as controlled before/after comparisons.

For the current large fixture:

| Operation | Requests | Queries incl. auth | JSON bytes |
| --- | ---: | ---: | ---: |
| Compatible full jobs array | 1 | 4 | 10,347,884 |
| 30 summaries | 1 | 2 | 8,595 |
| Full editor job | 1 | 4 | 50,940 |
| Legacy editor job + all jobs | 2 | 8 | 10,398,827 |
| Static editor job + targets + availability + template metadata | 4 | 10 | 56,706 |
| Optional 30-item lifecycle selector | 1 | 2 | 3,225 |
| Compatible full run detail | 1 | 6 | 151,363 |
| Frequent status | 1 | 2 | 360 |
| Revision-bound 100-event trace page | 1 | 2 | 59,670 |

The static editor does not request the selector unless its lifecycle picker is open;
provider resources load for the selected provider and selected installation/list/repo.
Full detail and diagnostics load on expansion. Active refresh uses status and trace
pages, continues through terminal artifact finalization, and invalidates expanded
metadata on state/finalization transitions. Continuous trace refresh rereads only the
last loaded page, rather than every accumulated page.

`gen-2157-trace-browser.json` records one compiled React/Chromium sample with mocked
HTTP pages: 20,000 events, 102 trace requests including live/reset reads, and at most
38 mounted event rows. Expanded details survive scrolling, and a live generation
change discards old pages. The virtualizer retains focused and selection-endpoint rows
in addition to its viewport/overscan. The measured traversal includes Playwright
scrolling and waits; it is not a frame-time benchmark or production performance claim.
Memory still grows with loaded event data; DOM work is bounded independently.

Reproduce service reads with `AUTH_TEST_DATABASE_URL` pointing to a disposable local
PostgreSQL admin database and `npm run benchmark:migration --workspace=factorize`.
Reproduce browser evidence after `npm run build:app` with
`GEN_2157_RECORD_TRACE=1 node --test packages/app/test/jobs.browser.test.mjs`.
The compiled-app/actual-Worker/PostgreSQL test separately proves job navigation,
invocation idempotency, canonical reset, concurrent edit reconciliation, trigger
identity, encrypted prompts, API-key lifecycle and static CSP routing. It does not
launch execution providers or validate Cloudflare's deployed production edge.

`gen-2157-cutover-validation.json` records final package/runtime checks and their
limits. The actual local protocol runtime exercises public registration, PKCE,
static consent, device approval, OAuth MCP calls, API-key REST/MCP access, scopes
and session-version revocation using isolated KV/PostgreSQL. The actual rollback
runtime restores `ff4b51b`, its legacy UI and compiled chunks without state changes.
HTTPS Vite-to-Worker session proxying also passed.

The initial pre-cutover check returned 401 for `/api/v1/session`; that historical
result is recorded in `gen-2157-cutover-validation.json`. The subsequent API anchor
and static production deployments succeeded, as recorded separately in
`gen-2157-production-rollout.json`. Brendan's later Linear production review reports
that app.factorize.sh works. See `docs/package-migration.md` for release evidence,
its limits, branch lineage and the preserved rollback checkpoint.
