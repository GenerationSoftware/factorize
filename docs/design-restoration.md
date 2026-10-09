# GEN-2159 design restoration

The static React app ports the established honey/charcoal identity without changing
API operations, public contracts, routing loaders, cache keys, mutation retry policies,
session handling, or trace virtualization.

## Reference and reproduction

Visual source: `82a9cda:packages/app/src/ui.ts` and `tailwind.css`.
The executable reference uses `ff4b51b:packages/api/src/ui.ts` and `tailwind.css`,
the additive API anchor with the legacy design intact. The exact historical tokens
are retained, including primary honey `#fdc901` and warm stone/slate overrides.
Only deterministic fixture data is used: fictional owner/workspace, fixed UUIDs,
UTC time, and the same job, prompt, model, integration, run, and trace contents.

From the repository root, with Node 24 and Chromium installed:

```sh
npm ci
npx playwright install --with-deps chromium
npm run build:app
node scripts/design/capture-legacy.mjs
npm run test:visual --workspace=factorize-app
```

Reference capture reads historical files with `git archive`, bundles them into a
temporary test-only directory, compiles their own Tailwind stylesheet, renders their
actual HTML and scripts, mocks their API responses, and removes the temporary files.
Historical code never enters the application build. Historical native-auth pages
omitted theme initialization; the capture explicitly applies their existing dark
classes to compare their dark styling. Timers are frozen and cursor-aware fixtures keep each historical trace event unique. Restored runs use Playwright's fixed clock.

To intentionally change reviewed baselines:

```sh
npm run test:visual --workspace=factorize-app -- --update-snapshots
```

Review expected/actual/diff artifacts in `packages/app/test-results` and the full-page
PNGs before committing. CI runs comparisons, never snapshot updates. The suite uses
Chromium, en-US, UTC, reduced motion, fixed network fixtures, 1280×900 and 390×900.
Pixel comparisons allow at most 0.1% differences for small font rasterization changes.

## Surface inventory

| Surface | Restored presentation |
| --- | --- |
| Shared shell | Existing monochrome bee, wordmark, constrained 6xl layout, responsive navigation, active links, search affordance, account disclosure, global theme toggle, skip link, warm footer and safe-area padding |
| Foundations | Exact historical tokens; light/dark fields, labels, cards, typography, focus rings, primary/secondary/destructive/disabled buttons, status badges, native disclosures and modal backdrop |
| Jobs | Header/action, filter panel, job cards, state/model/concurrency hierarchy, pagination, empty/loading/error states |
| Job detail | Compact grouped Run/edit/enable actions, status metadata, prompt disclosure, triggers, bounded run history, separated destructive action |
| Editor | Grouped job details, execution settings, prompt/context and trigger sections; responsive fields, safe template overlay, existing variable insertion/provider/lifecycle/conflict flows |
| Runs | Timing and state hierarchy, lazy prompt/provenance/diagnostics, replay, styled user/assistant/reasoning/tool/command/error events, safe Markdown/code highlighting, ANSI terminal surface, live activity and retained virtualization |
| Settings | Desktop sidebar/mobile wrapping navigation, original provider icon shapes, integration cards/setup disclosures, API-key creation/list/one-time secret, authorized clients and account/password forms |
| Search | Native modal, explanatory empty state, honey keyboard selection, combobox semantics, results/empty/loading/error feedback, Escape and focus restoration |
| Auth/protocol | Branded login/signup/reset/verification/password cards, OAuth consent and device authorization, readable notices and pending controls |
| Remaining states | App entry, router pending/error/not-found and chunk recovery; marketing remains on factorize.sh |

## Intentional adaptations

- New bounded jobs/run filters and pagination remain visible in panels; they have no
  equivalent in the earlier full-list UI. Job cards expose model and run-state badges
  so current capabilities fit the established surfaces and typography.
- The editor keeps the current explicit inline trigger/provider/lifecycle controls
  rather than restoring the old imperative table/editor dialog. Sections use the
  original field, card, border and spacing language; reconciliation retains its draft.
- Run opens one compact native modal with all current name/prompt/JSON options.
  Submission still uses the same payload, idempotency key and retry behavior.
- Trace disclosures retain the current safe React Markdown and lazy diagnostics,
  with event-type surfaces and syntax coloring. Raw legacy HTML rendering is excluded.
  Continuous traces preserve measurement, polling/reset logic, pinned focus/selection,
  expansion identity and bounded DOM behavior.
- Integration setup remains in provider cards with native disclosures so current
  edit/test/remove behavior stays explicit. The original provider SVG shapes and
  responsive settings sidebar are retained.
- Primary actions use honey with charcoal text consistently. Historical black/white
  auth and create/save buttons are intentionally normalized to the brand primary.
- ANSI output has a stable charcoal terminal surface in both themes: the existing
  green ANSI palette measured 2.05:1 against the light stone surface. Its original
  colors are preserved on the dark terminal surface.
- The theme toggle is available on all screens. A classic blocking, content-hashed
  same-origin script runs before CSS and module scripts, honors saved choices or the
  OS, and works under `script-src 'self'` without inline-script exceptions. Brand and
  theme assets build under the existing Worker `/assets/` allowlist.
- Native auth dark styling is now initialized consistently; the reference's missing
  native-auth initialization is corrected. In-app not-found presentation is styled;
  the Worker's explicit static/protocol route allowlist remains unchanged.

## Screenshot comparisons

Each link is a committed full-page PNG. All four combinations were reviewed for
composition, field spacing, theme contrast, wrapped navigation and internal overflow.

### Light, 1280px

| Screen | Historical reference | Restored React |
| --- | --- | --- |
| Jobs | [Reference](../packages/app/test/visual/references/jobs-light-1280.png) | [Restored](../packages/app/test/visual/baselines/jobs-light-1280.png) |
| Job detail | [Reference](../packages/app/test/visual/references/job-light-1280.png) | [Restored](../packages/app/test/visual/baselines/job-light-1280.png) |
| Editor | [Reference](../packages/app/test/visual/references/editor-light-1280.png) | [Restored](../packages/app/test/visual/baselines/editor-light-1280.png) |
| Run trace | [Reference](../packages/app/test/visual/references/trace-light-1280.png) | [Restored](../packages/app/test/visual/baselines/trace-light-1280.png) |
| Settings | [Reference](../packages/app/test/visual/references/settings-light-1280.png) | [Restored](../packages/app/test/visual/baselines/settings-light-1280.png) |
| Login | [Reference](../packages/app/test/visual/references/login-light-1280.png) | [Restored](../packages/app/test/visual/baselines/login-light-1280.png) |

### Light, 390px

| Screen | Historical reference | Restored React |
| --- | --- | --- |
| Jobs | [Reference](../packages/app/test/visual/references/jobs-light-390.png) | [Restored](../packages/app/test/visual/baselines/jobs-light-390.png) |
| Job detail | [Reference](../packages/app/test/visual/references/job-light-390.png) | [Restored](../packages/app/test/visual/baselines/job-light-390.png) |
| Editor | [Reference](../packages/app/test/visual/references/editor-light-390.png) | [Restored](../packages/app/test/visual/baselines/editor-light-390.png) |
| Run trace | [Reference](../packages/app/test/visual/references/trace-light-390.png) | [Restored](../packages/app/test/visual/baselines/trace-light-390.png) |
| Settings | [Reference](../packages/app/test/visual/references/settings-light-390.png) | [Restored](../packages/app/test/visual/baselines/settings-light-390.png) |
| Login | [Reference](../packages/app/test/visual/references/login-light-390.png) | [Restored](../packages/app/test/visual/baselines/login-light-390.png) |

### Dark, 1280px

| Screen | Historical reference | Restored React |
| --- | --- | --- |
| Jobs | [Reference](../packages/app/test/visual/references/jobs-dark-1280.png) | [Restored](../packages/app/test/visual/baselines/jobs-dark-1280.png) |
| Job detail | [Reference](../packages/app/test/visual/references/job-dark-1280.png) | [Restored](../packages/app/test/visual/baselines/job-dark-1280.png) |
| Editor | [Reference](../packages/app/test/visual/references/editor-dark-1280.png) | [Restored](../packages/app/test/visual/baselines/editor-dark-1280.png) |
| Run trace | [Reference](../packages/app/test/visual/references/trace-dark-1280.png) | [Restored](../packages/app/test/visual/baselines/trace-dark-1280.png) |
| Settings | [Reference](../packages/app/test/visual/references/settings-dark-1280.png) | [Restored](../packages/app/test/visual/baselines/settings-dark-1280.png) |
| Login | [Reference](../packages/app/test/visual/references/login-dark-1280.png) | [Restored](../packages/app/test/visual/baselines/login-dark-1280.png) |

### Dark, 390px

| Screen | Historical reference | Restored React |
| --- | --- | --- |
| Jobs | [Reference](../packages/app/test/visual/references/jobs-dark-390.png) | [Restored](../packages/app/test/visual/baselines/jobs-dark-390.png) |
| Job detail | [Reference](../packages/app/test/visual/references/job-dark-390.png) | [Restored](../packages/app/test/visual/baselines/job-dark-390.png) |
| Editor | [Reference](../packages/app/test/visual/references/editor-dark-390.png) | [Restored](../packages/app/test/visual/baselines/editor-dark-390.png) |
| Run trace | [Reference](../packages/app/test/visual/references/trace-dark-390.png) | [Restored](../packages/app/test/visual/baselines/trace-dark-390.png) |
| Settings | [Reference](../packages/app/test/visual/references/settings-dark-390.png) | [Restored](../packages/app/test/visual/baselines/settings-dark-390.png) |
| Login | [Reference](../packages/app/test/visual/references/login-dark-390.png) | [Restored](../packages/app/test/visual/baselines/login-dark-390.png) |

Additional baselines cover long content, run-dialog validation, running/failed traces,
empty jobs, settings keys/clients/password, consent, device, app entry, not-found,
chunk recovery, loading/error and search states.

## Validation

The visual suite also runs axe WCAG A/AA checks on the six representative screens
in both themes and viewport sizes, plus the search modal. Functional coverage checks
profile disclosure, Escape/focus restoration, search keyboard navigation, invocation
validation/idempotency, stale-write reconciliation, pending/disabled controls, and
bounded 20,000-event trace expansion/focus/selection/reset behavior.

The real Worker/PostgreSQL browser slice checks direct nested navigation, compiled
warm CSS, decoded bee assets, initial theme, real invocation, trace reset, reconciliation,
and real API-key creation/revocation. No production credentials or live user data are
used, and no production deployment is performed.

Final command results are recorded in the PR. Browser fixtures and axe are automated
evidence, not a claim of a complete manual assistive-technology audit.

Validated on the final tree with disposable local PostgreSQL:

- `npm run check`: passed, including application build/type checking, 26 functional
  tests, 36 visual/browser tests (56 reviewed PNG baselines), axe audits, generated
  client/package/API boundaries, 324 backend tests, Worker dry-run, hosting/OAuth/
  rollback runtime checks, marketing and relay checks. Eight existing backend tests
  remain explicitly skipped by the repository's suite configuration.
- `npm run generate` plus a diff of OpenAPI/generated client: unchanged.
- `npm run test:static-slice --workspace=factorize`: two real Worker/PostgreSQL
  browser scenarios passed.
- Historical capture: all 24 reference PNGs regenerated successfully; each trace
  fixture renders exactly one copy of each of the four deterministic events.
- `git diff --check`: passed.
