# MCP proxy, skills, Pi telemetry, and Phoenix

## Execution instructions

Complete each item in sequence, from top to bottom. Do not move on until every acceptance criterion for the current item has been met. Check each criterion off only after verification passes, record commands and evidence below the item, and then move to the next item. Do not stop until all items are complete.

All acceptance criteria must be achievable by an agent in this VM. Use isolated loopback PostgreSQL, local workerd/R2, Chromium, controlled clocks, and deterministic HTTP/model/Phoenix/client fixtures. No criterion requires production deployment, live credentials, an external client account, mobile hardware, an external registry update, or a live Phoenix service. Wire-contract fixtures do not establish that an external client's current release has been manually verified. Keep external discovery observations separate from proven local defects.

Use the pinned validation image, Node 24.12.0 and npm 11.19.0; install with npm ci. Preserve package boundaries, external REST/MCP compatibility and accepted run snapshots. Document new public application operations under /api/v1 in OpenAPI and regenerate the public client. Run the complete root npm test after the final code change.

## 1. MCP proxy discovery and actionable reflection

Investigate tools/list and protocol compatibility against the observed connector catalog (reflection available, proxy tools missing). Do not assume a production defect from that observation. Keep request_api and read_api_response discoverable independently of proxy consent, with execution authorization enforced. Connect reflection services to exact tool names, integration IDs, relative-path conventions, example arguments and permission requirements. Distinguish permission failures from unavailable credentials. Add a local catalog diagnostic; document external refresh/deployment investigation without making it an acceptance gate.

Acceptance:
- [x] Authenticated local MCP discovery lists reflection, request_api and read_api_response even without proxy:use.
- [x] A fixture client follows reflection's example into request_api and reaches its authorized upstream.
- [x] Missing scope, blocked integration and unavailable credentials produce distinct actionable errors without secrets.
- [x] Local diagnostic/tests distinguish missing client tools from server authorization errors.

Evidence: pinned-image npm ci completed; AUTH_TEST_DATABASE_URL pointing to isolated loopback PostgreSQL, vitest run test/proxy-discovery.postgres.test.ts: 3 passed, including real MCP discovery/calls, fixture-only HTTP, permission and damaged-credential failures. Backend tsc --noEmit passed; npm run generate completed. External connector refresh is documented, not claimed performed.

## 2. Bounded proxy results, retained responses and queries

Stream original upstream bytes into bounded artifact blocks. Default serialized model-facing proxy results to 4 KiB, allowing explicit increases up to a hard 32 KiB ceiling, accounting for encoding and both MCP content representations. Spill large results to storage and return safe status/headers, bounded preview, size, handle, expiry and read instructions. Offer companion tools and optional resource links. Add bounded JMESPath JSON filtering, text line ranges and binary byte ranges; retain range reads when JSON exceeds parser limits. Do not silently discard fields or invent upstream pagination. Temporary handles last 30 minutes and remain scoped to the authenticated OAuth connection or run.

Acceptance:
- [x] JSON, Unicode, escaped text and binary fixtures respect default/hard serialized budgets and retain exact original bytes.
- [x] Filtering, line/byte pagination, invalid queries and query/output limits pass local tests.
- [x] Downloads cross storage-block boundaries with bounded buffering.
- [x] Expiry, tenant/connection/run isolation, revocation and integration-epoch rechecks pass deterministic tests.
- [x] Existing REST response/chunk contracts remain compatible; sensitive headers are excluded.

Evidence: pinned-image vitest proxy-results.postgres.test.ts, agent-api.postgres.test.ts and hosted-pi-mcp.postgres.test.ts: 14 passed; discovery/forwarder regression run: 18 passed. Tests cover exact Unicode/control/binary bytes, measured duplicated result budgets, 1 MiB storage blocks and boundary reads, filtering/pagination/parser limits, connection isolation, TTL/epoch/revocation, active-run authorization and legacy 64 KiB REST reads. Backend tsc --noEmit and contract generation passed.

## 3. Durable HTTP operations and streaming

Use existing scheduling/storage infrastructure for durable slow operations, not request-lifetime waitUntil as a durability guarantee. Fast requests may complete inline; slow/chunked/SSE bodies return handles with poll/read/cancel tools. Clients need no persistent connection, resource subscription or progress support. Provide progress as an optional enhancement. Preserve operations across reconnects and fence recovery; never blindly replay uncertain mutating calls. Fixed limits: request 32 MiB, response 64 MiB, upstream duration 15 minutes. Surface errors, partial-data state and uncertain upstream side effects; no configuration UI.

Acceptance:
- [x] Slow/chunked/SSE fixtures expose bounded handles and incremental reads, completing across disconnect/reconnect.
- [x] Restart/recovery and duplicate submissions cannot blindly repeat mutating requests.
- [x] Cancellation, revocation, disconnect/non-2xx and size/time limits surface explicit state and partial-data information.
- [x] Ordinary tool-only clients complete operations; supported progress clients receive optional progress.

Evidence: pinned-image proxy-operations.postgres.test.ts: 4 passed, exercising persisted dispatch, reconnect SSE reads, non-2xx status, interrupted-write idempotency, partial disconnect/cancel/timeout states, 32/64 MiB limits and revocation. proxy-discovery.postgres.test.ts plus run-alarm.test.ts: 8 passed, including actual legacy Streamable HTTP progress frames and alarm-object recreation. Backend tsc --noEmit and contract generation passed.

## 4. Generic artifacts, staged request bodies and attachments

Reuse artifact storage with generic temporary payload metadata, preserving image-specific media semantics. Support authorized artifact/response references, streaming integration imports, bounded staged chunks with immutable finalization, and raw/multipart request assembly. OAuth clients need no run. Payloads expire in 30 minutes with connection/run isolation. Add a dedicated ChatGPT attachment import tool with the documented top-level OpenAI file schema and openai/fileParams metadata. Stream temporary download URLs without integration credentials; validate public origins/redirects and exclude signed URLs from logs. Add an authenticated static-frontend upload page and documented upload operations returning a handle for clients without native handoff. Do not depend on the experimental MCP files extension.

Acceptance:
- [x] File-parameter fixtures import exact bytes and reject malformed, missing, expired and oversized files with actionable errors.
- [x] Generic uploads, authorized artifacts, retained responses and integration imports become raw/multipart bodies without model-generated base64.
- [x] Staging ordering/idempotency/finalization and rejection of foreign, expired, incomplete or revoked handles pass tests.
- [x] Chromium completes the authenticated upload fallback without a run and rejects unauthorized access.
- [x] SSRF/redirect/isolation fixtures prove imports cannot reach private origins or leak credentials or signed URLs.

Evidence: pinned-image proxy-payloads.postgres.test.ts and proxy-discovery.postgres.test.ts: 8 passed (native file schema/metadata, exact binary import, URL/redirect/expiry/oversize failures, staged ordering/idempotency/checksum, raw/multipart bodies, authorized artifact/retained-response/integration sources, browser API authorization, identity expiry/revocation). App build and backend tsc passed. Chromium proxy-upload.browser.test.mjs: 3 passed at 390/1280px plus anonymous redirect, with exact uploaded binary bytes and usable handle.

## 5. Default MCP Skills publishing with tool fallback

Publish every active authorized team skill through io.modelcontextprotocol/skills by default, preserving existing tools for clients without extension support. Verify manifests/hashes, supporting resources, pagination and library updates. Preserve immutable accepted run packages; publishing does not execute or activate a skill.

Acceptance:
- [x] Discovery/list/get/read expose all authorized active packages with correct hashes and sizes.
- [x] Existing skill tools remain visible and usable without extension support.
- [x] Pagination, edits, rename/delete, failed publication, invalid paths and tenant isolation pass tests.
- [x] Pinned run packages and supporting files survive library edits, rename and deletion unchanged.

Evidence: pinned-image vitest mcp-skills.test.ts, mcp-skills.postgres.test.ts, skill-library.postgres.test.ts and hosted-pi-mcp.postgres.test.ts: 16 passed. Includes extension discovery/pagination, exact per-file digest/size, legacy tool fallback without extension negotiation, scopes/member/tenant/path isolation, edit/rename/delete, Git publication preservation, and immutable pinned run supporting files. Existing default publishing implementation retained.

## 6. Durable Pi OpenTelemetry/OpenInference capture

Instrument pinned hosted Pi model/agent boundaries using OpenTelemetry and Arize OpenInference conventions; verify rather than assume auto-instrumentor coverage. Persist independently of Phoenix: stable run trace, turn/model/tool spans, assistant/tool content, timings, retries, recovery, compaction, errors, finish reason, model/provider and reported input/output/cache/reasoning usage. Preserve trace IDs across scheduler leases and avoid duplicate accounting. Exclude credentials and temporary URLs; retain large content by reference with bounded reads and existing run retention.

Acceptance:
- [x] Deterministic Pi fixture records correlated run/turn/model/tool spans with content, timings and terminal status.
- [x] Model and compaction usage are persisted once; unavailable fields remain unavailable and cache/reasoning counts are not double-counted.
- [x] Retry, recovery, cancellation and failure preserve trace identity without duplicate spans or usage.
- [x] Authorization, tenant isolation, redaction and retention cleanup pass locally.
- [x] Capture works without Phoenix and emits valid OpenInference span attributes.

Evidence: pinned-image pi-telemetry.postgres.test.ts and hosted-pi-mcp.postgres.test.ts: 10 passed, including real five-turn Pi execution with four tools, SDK-generated OTLP spans, reported cache/reasoning usage, stable IDs/idempotent recovery, compaction/retry/error/cancel spans, encrypted bounded Unicode content, secret/URL redaction, tenant isolation and cascading run retention. scripts/hosted-pi-runtime.test.mjs passed in workerd; backend tsc passed. No Phoenix connection used.

## 7. Run telemetry UI and cost estimates

Expose authorized paginated telemetry through documented /api/v1 contracts and generated client. Add live run totals and expandable turn/model/tool details with duration, usage, estimated cost and errors. Use a maintained versioned pricing catalog plus per-model overrides. Snapshot source/rates with estimates; unknown prices/usage remain unavailable rather than zero. Do not sum overlapping durations as wall time.

Acceptance:
- [x] API tests verify authorization, pagination, bounded details and usage/cost reconciliation.
- [x] Pricing fixtures cover catalog models, overrides, unknown models, cache/reasoning semantics and immutable historical estimates.
- [x] Desktop/mobile Chromium shows live totals, expandable details, errors/cancellation and unavailable fields.
- [x] Large content uses bounded detail reads; historical runs lacking telemetry remain readable.

Evidence: pinned-image model-pricing.test.ts, run-telemetry.postgres.test.ts, pi-telemetry.postgres.test.ts and hosted-pi-mcp.postgres.test.ts: 14 passed. Covers catalog tiers, custom overrides, unknown usage/prices, non-duplicated cache/reasoning charges, immutable pricing snapshots, API scope/404/pagination/content limits and reconciled totals. Four targeted runs.browser.test.mjs Chromium scenarios passed (390/1280px, lazy bounded detail reads, live polling, canceled/error and historical/no-telemetry states). App build, generated contracts and backend tsc passed.

## 8. Phoenix Cloud integration and reliable export

Add team-scoped endpoint, encrypted API key and destination project with connection testing. Export newly captured telemetry/content through a durable batched queue independent of execution. Reuse IDs, implement bounded transient retries and visible export state, and verify ingestion with a local receiver; do not promise exactly-once provider ingestion. Store destination/trace identifiers for a precise View in Phoenix link. Disable/disconnect stops future export and keeps keys server-side. Historical backfill is out of scope.

Acceptance:
- [x] Local API/browser tests configure, test, update, disable and disconnect the integration without exposing its key.
- [x] Local OTLP/Phoenix receiver validates authenticated destination and correlated multi-turn/tool spans.
- [x] Transient/permanent failures, retry, restart and disconnect preserve run success/local telemetry and expose export state.
- [x] Run page links to the fixture destination's exact trace using stored identifiers.
- [x] No integration means no export; tenant isolation and redaction hold.

Evidence: pinned-image phoenix.postgres.test.ts, run-alarm.test.ts and hosted-pi-mcp.postgres.test.ts: 12 passed. Independent local HTTP receiver decodes actual OTLP protobuf and verifies authentication/project/trace IDs, multi-turn/tool spans and usage. Tests cover accepted-but-failed acknowledgement retries, stale sending leases, eight-attempt cap, permanent errors/key repair, link lookup repair without retransmission, disabling/disconnection, no backfill and tenant isolation. Four Chromium scenarios passed for 390/1280px configuration/test/update/disable/disconnect and exact run trace links/export status. Local telemetry remains independent of export.

## 9. Complete validation and handoff

Acceptance:
- [x] OpenAPI/client, package boundaries and documentation checks pass.
- [x] Complete root npm test passes after the final code change in the pinned image with isolated databases and deterministic providers.
- [x] Every preceding criterion has recorded local evidence and the final diff has been reviewed; no external service/client action is needed to reproduce acceptance.

Evidence: complete root npm test exited 0 on 2026-11-20 after the final code change. All backend, browser, proxy and Docker validation steps passed in ghcr.io/generationsoftware/factorize-validation-runner@sha256:1333c4a7bb49c4cbcdd28ca2b57331dfcbff7cf611db1aaeaa4830517aacf6d4, using Node 24.12.0, npm 11.19.0 and isolated loopback PostgreSQL on port 55434. Backend: 140 files, 862 tests passed, five existing optional tests skipped; compiled app/API/PostgreSQL: 40 passed; browser application suite: 128 passed, one skipped; proxy protocol: 32 passed plus four harness checks; Docker: two passed. Contract generation/drift, package boundaries, documentation, builds and Worker-runtime checks all passed. The Worker fixture explicitly verifies synchronous proxy compatibility and the actionable error when durable scheduling is unavailable. Final diff reviewed and git diff --check passed. Full local log: /tmp/factorize-complete-validation-final.log. All preceding items have local evidence; no production deployment, client refresh or live Phoenix ingestion is claimed.
