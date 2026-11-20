# Preset-based skills

## Execution instructions

Complete each item in sequence, from top to bottom. As its acceptance criteria are met, check them off and record the exact verification command and result under that item. Check off the item only after all its criteria pass. Continue until all items are complete, then push the branch and open a new pull request with the implementation and validation evidence. PR publication is the handoff, not an acceptance criterion requiring an external service.

Every acceptance criterion below must be achievable by an agent in this VM. Use the pinned validation runner image, Node 24.12.0, npm 11.19.0, isolated loopback PostgreSQL, local Worker/artifact fixtures, deterministic model/integration fixtures, and Chromium. Do not require production deployment, live provider credentials, a real external model call, a live Git service for skill publication tests, or external approval. Never use production/shared databases. Use npm ci, preserve package boundaries, document JSON application endpoints under /api/v1 in OpenAPI, and regenerate the public client. Run the complete root npm test after the final code change. Do not mark unverified work complete.

## 1. [x] Frontmatter contract and round-trip editing primitives

Make SKILL.md the source of truth. Support name, description, and metadata.factorize with optional vm-preset, permission-preset, model-preset slugs; concurrency (nonnegative integer, default 0 = unlimited); and disabled (boolean, default false). Missing preset keys mean team defaults. Preserve unrelated frontmatter and the literal Markdown body. Slugs are human-readable, immutable, and unique within preset type/team. Retain internal IDs for identity and historical references.

Acceptance:
- [x] Local tests parse/validate all fields, omitted defaults, malformed YAML, invalid slugs/types, and zero/unlimited concurrency.
- [x] Round-trip tests preserve unknown frontmatter, unrelated metadata, and Markdown content when changing only Factorize controls.
- [x] Structured metadata is available through the public skill contract; generated client and backend/frontend package boundaries pass.

Evidence: In pinned runner factorize-proxy-validation-final (Node 24.12.0/npm 11.19.0): skill-definition.test.ts 8 passed; npm run generate passed; npm run check:boundaries 11 passed; API tsc --noEmit passed.

## 2. [x] Versioned VM, permission, and model presets with team defaults

Retain VM provider/image/size/region/tags configuration, add permission presets (application scopes, integrations and invocation permissions), and model presets (model account/provider, model and effort). Each preset has name, immutable slug, stable ID and immutable revision. Team settings select one default of each type. Editing creates a revision rather than mutating historical configuration. Block deletion of defaults and presets referenced by skills, returning useful reference details. Enforce tenant isolation and write authorization. Validate referenced integrations/accounts using deterministic fixtures.

Acceptance:
- [x] Local database/API tests cover CRUD for all three types, immutable slug validation, per-type/team uniqueness, revision history, and default replacement.
- [x] Tests reject deleting defaults or referenced presets and allow deleting unused presets; historical snapshots/revisions survive deletion.
- [x] Tests reject cross-team IDs/slugs, unavailable connections, unauthorized mutations, and stale writes without leaking secrets.
- [x] New operations are registered in protected-api.ts, documented in OpenAPI, and present in the regenerated public client.

Evidence: Pinned runner presets.postgres.test.ts passed: all three kinds, revisions/default replacement, default/reference deletion guards, tenant isolation, stale/invalid writes and unavailable connections. npm run generate and API tsc --noEmit passed.

## 3. [x] Migrate legacy configurations without losing instructions

Create/reuse presets for distinct team/skill VM, permission, and model configurations, select team defaults and link skills by slug in SKILL.md. Preserve extra saved prompts in the Markdown body. Preserve auxiliary skill files and Git publication semantics. Disable existing script automation and remove it from future execution; retain historical runs. Make migration resumable/idempotent and avoid external service calls in SQL migrations or test acceptance.

Acceptance:
- [x] Local legacy-fixture tests verify distinct configurations become distinct presets and equivalent configurations are reused.
- [x] Team defaults and skill references preserve effective non-script settings, concurrency semantics, prompts and supporting files.
- [x] Repeating/resuming migration neither duplicates presets/instructions nor loses committed content after a simulated failure.
- [x] Legacy script automation cannot create new runs, while historical run details and traces remain readable.

Evidence: Pinned runner preset-migration.postgres.test.ts 2 passed, including local Git publication failure/recovery, idempotence, prompt/configuration/file preservation, disabled legacy script automation and retained run rows.

## 4. [x] Central preset resolution, immutable run snapshots, disabled and concurrency

Resolve skill preset references or team defaults when creating a run, before it queues. Snapshot resolved settings plus preset IDs/slugs/revisions, inheritance flags and skill commit. Never re-resolve queued/existing runs. Apply consistent behavior to direct/manual, automated and MCP launches. Reject all new runs of disabled skills but let existing runs finish. Default skill concurrency to 0/unlimited; positive limits constrain execution. Retire script-based run creation from browser, REST and MCP; preserve historical read contracts and harmless omission compatibility. Keep credentials server-side and authorization ceilings intact.

Acceptance:
- [x] Local integration tests prove explicit/inherited resolution, queued-run freezing and provenance for all three preset types.
- [x] Changing defaults, editing/deleting presets or editing skills cannot change accepted run snapshots or supporting files.
- [x] Disabled skills reject new manual/automated/MCP runs while existing runs can complete; positive concurrency limits and zero/unlimited work with scheduler fixtures.
- [x] Permission tests prove a preset cannot exceed the caller/delegation ceiling or bypass tenant/integration authorization.
- [x] New script requests fail actionably across supported launch paths; historical script runs remain readable.

Evidence: Pinned runner preset-runs.postgres.test.ts passed: direct and scheduled admission, inherited/explicit revisions, positive and unlimited concurrency, queued snapshots claimed after edits/disable, permission ceiling rejection and script retirement. API tsc and generated contracts passed. MCP start_run delegates to the same tested service; discovery/call coverage follows in item 10.

## 5. [x] Team Settings preset list and dedicated editor pages

VM, Permissions and Models left navigation each open their preset list. Show names/slugs, useful summaries and Default badges. Add opens a dedicated creation page. Each row's accessible ellipsis menu offers Edit, Make team default and Delete. Edit opens a dedicated page; Delete uses an application confirmation modal. Default/reference restrictions are explained. Preserve existing provider/image verification behavior with local fixtures. Team capacity remains a team setting.

Acceptance:
- [x] Chromium tests complete list/add/edit/default/delete flows for each type at desktop and mobile widths using local fixtures.
- [x] Add/edit have navigable URLs, Cancel returns to the correct list, and reload preserves routing.
- [x] Ellipsis menus and confirmation modals support keyboard/focus behavior; cancel does not mutate; errors retain input.
- [x] Default deletion is unavailable/rejected and referenced deletion lists blocking references; capacity remains editable.

Evidence: npm run build:app passed in pinned runner; presets.browser.test.mjs 6 passed (all three types at 390/1280px), covering reloadable add/edit routes, immutable slugs, default switching/protection, confirmation cancel/delete, blocking-reference errors, keyboard Escape, cancel navigation and team capacity controls.

## 6. [x] Structured skill editor and rendered overview

Replace literal-file editing with controls for name, description, autocomplete VM/permission/model presets, concurrency and disabled, plus generic text editing of the Markdown body. Save the entire SKILL.md in one conditional revision, preserving unrelated metadata. Use the same editor for new skills. Overview displays a compact three-selector preset box above safely rendered Markdown; inherited values identify the resolved team default. Overview selector changes immediately save/commit only their metadata field with pending/error/conflict feedback. Remove Instructions heading and Start run. Retain the skill directory browser.

Acceptance:
- [x] Chromium creates/edits a skill via controls and body text, then verifies serialized frontmatter and Markdown rendering.
- [x] Autocomplete supports filtering, keyboard selection, clearing to Team default, and unavailable-reference feedback.
- [x] Overview autosave changes the actual skill file/revision, preserves unrelated metadata/body/files, and handles failed/stale writes without overwriting concurrent edits.
- [x] Markdown links/code/lists render safely; no Instructions heading or overview Start run button remains; directory browsing still works.

Evidence: Pinned runner skill-editor.postgres.test.ts passed for actual Git-backed file commits, unknown YAML preservation and stale revision rejection; skills-presets.browser.test.mjs 2 passed at 390/1280px for structured create/edit, Markdown safety/rendering, autocomplete/default clearing, autosave conflict/reload and supporting-file browsing. npm run build:app passed.

## 7. [x] Replace skill Settings with Triggers

Use Overview, Runs and Triggers subnavigation. Remove General/VM/Permissions settings pages and their controls. Triggers contains only non-manual trigger configuration, including disabled triggers; manual events are legacy implementation details and cannot appear in or be added through the editor. Retain independent manual invocation. Redirect old skill settings URLs to the appropriate replacement. Disabled skill messaging does not erase trigger configuration.

Acceptance:
- [x] Chromium verifies new navigation, legacy URL redirects, empty state, and add/edit/disable/remove non-manual triggers.
- [x] No manual trigger option/row or execution settings form is visible; API tests cover empty and legacy manual-only trigger configurations.
- [x] Editing triggers does not overwrite skill metadata or resolved preset choices, and disabled skills retain trigger configuration.

Evidence: skill-triggers.browser.test.mjs passed for navigation/legacy redirects, manual-only empty state and add/disable/remove schedule configuration. preset-runs.postgres.test.ts passed again, including empty visible configuration, retained independent manual invocation and unchanged SKILL.md. App build passed.

## 8. [x] Skills table

Use the shared table conventions with Skill name, Description, VM preset, Permission preset, Model preset and Triggers columns. Show Yes if any non-manual trigger exists, including disabled triggers; otherwise No. Resolve inherited preset labels. Keep New skill, existing pagination and useful loading/error/empty states. Remove the page title/subtitle, local search and List/Graph toggle.

Acceptance:
- [x] Local API fixtures and Chromium verify all columns, explicit/default labels, description, navigation, pagination and empty/error/loading states.
- [x] Disabled non-manual triggers produce Yes; absent/manual-only triggers produce No.
- [x] Desktop/mobile layouts remain usable and contain no removed title/subtitle/search/toggle.

Evidence: skill-table.postgres.test.ts passed for descriptions, body omission, trigger flags and pagination. skills-table.browser.test.mjs 2 passed at 390/1280px for columns, explicit/inherited labels, Yes/No, pagination, empty/error states and removal of title/search/toggle. App build passed.

## 9. [x] Global search for skill names and run names only

Replace trigger and trace search with skill-name and run-name matching. Do not match descriptions, skill instructions, issue identifiers/titles or message/trace contents independently. Keep useful exact/prefix/fuzzy ranking, highlighting, bounded tenant-scoped results and keyboard navigation. Link skills to their overview and runs to their detail page. Update launcher, dialog and accessibility labels.

Acceptance:
- [x] Local PostgreSQL tests verify matching/ranking/highlighting of skill and run names, deterministic ordering, isolation and bounded results.
- [x] Negative tests prove trigger names, descriptions, bodies, issue identifiers/titles and trace content alone produce no results.
- [x] Chromium verifies click/keyboard navigation for both result kinds plus empty/loading/error and stale-response states.

Evidence: search.postgres.test.ts + search.test.ts 10 passed for skill/run names, punctuation/typo matching, excluded trigger/issue/body/trace fields, tenant isolation, highlighting, 100-result bound and deterministic ordering. skill-search.browser.test.mjs passed for keyboard/click navigation, stale selection prevention and empty/loading/error states. App build passed.

## 10. [x] REST/MCP consistency and documentation

Expose consistent preset management, default selection and frontmatter-backed skill configuration to external clients. Remove obsolete script/execution-settings mutation paths or return actionable retirement errors without silently accepting ignored fields. Preserve historical read/full-list/detail/trace and conditional-write omission compatibility. Explain defaults, slug references, concurrency, disabled behavior, snapshot timing and provenance in product/API/MCP documentation.

Acceptance:
- [x] Local MCP discovery/call tests manage presets, edit skill metadata, launch and inspect a preset-backed run with the same semantics as REST/browser.
- [x] Contract/boundary tests verify authorization, validation, retired inputs, omission compatibility and historical run reads.
- [x] npm run generate, contract drift checks, package boundaries and documentation validation pass locally.

Evidence: preset-mcp.postgres.test.ts passed through real MCP discovery/calls; focused regression run passed 71 tests with one historical-preview fixture subsequently corrected and verified. preset-final-targeted.log: 7 files/17 tests passed. Worker agent-api-runtime.test.mjs: 2 passed including background acceptance. npm run generate, documentation generation/validation, package boundaries and API type checks passed. The final root suite in item 11 rechecks all contracts and historical reads together.

## 11. [x] Complete validation, review and PR handoff preparation

Acceptance:
- [x] All preceding criteria are checked with reproducible local commands/evidence; no acceptance relies on external deployment or provider availability.
- [x] The complete root npm test passes after the final code change using pinned tooling and isolated databases.
- [x] git diff --check passes; final diff review covers migration failure safety, authorization, accepted-run immutability, and removed UI/routes/contracts.
- [x] A PR title/body describing behavior, migration, test results and limitations is prepared locally for publication.

Evidence: Complete root suite passed after the final implementation/test change on 2026-11-20 in factorize-proxy-validation-final (pinned runner digest sha256:1333c4a7bb49c4cbcdd28ca2b57331dfcbff7cf611db1aaeaa4830517aacf6d4; Node 24.12.0/npm 11.19.0). Reproduce from the repository root after npm ci and isolated database bootstrap:

```sh
docker exec -u exedev -w /work \
  -e DATABASE_URL=postgresql://postgres:local-validation-only@127.0.0.1:55434/factorize_presets_validation \
  -e AUTH_TEST_DATABASE_URL=postgresql://postgres:local-validation-only@127.0.0.1:55434/factorize_presets_validation \
  -e QUEUE_TEST_DATABASE_URL=postgresql://postgres:local-validation-only@127.0.0.1:55434/factorize_presets_validation \
  factorize-proxy-validation-final npm test
git diff --check
git diff --cached --check
```

Result: every root validation step passed (generated contracts/drift, build, backend, compiled app/API/PostgreSQL integration, functional/browser, portable proxy, Docker). Backend: 147 files, 877 passed/5 existing skips; compiled integration: 40 passed; functional Chromium: 6 passed; app: 139 passed/1 existing skip; proxy protocol: 32 passed plus 4 harness tests; Docker: 2 passed. Worker runtime, docs, package boundaries and type checks passed within the root suite. Local log: /tmp/factorize-presets-root-final.log. Final diff review covered tenant/scope authorization, default/reference deletion guards, immutable run snapshots and queued execution, encrypted/restart-safe migration checkpoints, legacy-route redirects and retired mutations. Runtime fixtures use unique artifact namespaces to avoid local Git socket collisions. Both diff whitespace checks passed. All criteria above are exercised locally without external providers or deployments.

After every item is complete: commit, push this branch and open a new PR. Record the PR URL in the handoff; report external publication failures honestly without changing local acceptance results.
