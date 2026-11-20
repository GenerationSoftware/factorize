# Skill-centered teams implementation

## Instructions

I want you to tackle each item one at a time from top to bottom. complete the item to completion, and when the acceptance criteria passes then check the box and move to the next item.

Don't stop until all items are complete.

Check acceptance criteria only after local verification passes. Record evidence below each item. Use isolated PostgreSQL, Chromium, and deterministic service fixtures; no production database or live providers. Runs remains Runs.

## 1. Required usernames and profile settings

Implementation: Require globally unique usernames of 3–39 lowercase letters/numbers, separated by single hyphens. Normalize uppercase. Collect at signup; accept username or email with password at login. Add Profile to account settings. Backfill existing users from their email prefix; fail with a diagnostic for invalid/colliding prefixes. Enforce uniqueness in PostgreSQL, including concurrent writes. Add authorized, validated public API operations and regenerate contracts.

Acceptance:
- [x] Signup requires a valid username; format, length, normalization, and duplicate handling pass local tests.
- [x] Email and username login both work with the password.
- [x] Profile allows username changes and rejects invalid/duplicate values, including concurrent claims.
- [x] Migration backfills email prefixes and diagnoses invalid/colliding values.

Evidence: 63 targeted PostgreSQL/API/auth tests and 12 Chromium auth/profile tests passed in the pinned image; application build passed.

## 2. Personal team identity and header

Implementation: Personal team names equal owner usernames, with no independent editor. Rename atomically with username changes. Show bee and team name in the shared header; team name navigates to Skills.

Acceptance:
- [x] Browser verifies team name and Skills destination.
- [x] Profile rename updates team/header after navigation and reload.
- [x] Rejected rename changes neither username nor team name.

Evidence: PostgreSQL username/team atomicity and immutable-name assertions passed; all 12 Chromium auth/profile/header tests passed.

## 3. Team Settings layout and Git configuration

Implementation: Reuse account-settings layout with VM, Permissions, Skills sidebar. Default /settings to VM. VM owns execution/model/concurrency defaults and presets; Permissions owns scopes/integration access/destinations; Skills owns existing repository selection/folder/sync controls, removed from Skills list. Save subpages independently without overwriting others.

Acceptance:
- [x] Direct links and active selection work for all subpages on desktop/mobile.
- [x] Saving each section preserves other settings.
- [x] Repository configuration/sync work with local fixtures and appear only under Team Settings.

Evidence: application build and three compiled Chromium Skills/settings tests passed, covering desktop/mobile saves and repository replacement/sync fixtures.

## 4. Skill-owned execution settings

Implementation: Skills own agent/script mode, VM/model, permissions, prompt, and concurrency. New skills copy team defaults. Manual and triggered launches use saved skill defaults with supported explicit overrides. Existing runs retain immutable launch snapshots.

Acceptance:
- [x] New skills copy team defaults; later skill changes govern future manual and triggered launches.
- [x] Supported explicit overrides take precedence.
- [x] Agent/script modes work; scripts require a VM.
- [x] Changing skill settings does not mutate existing run snapshots.

Evidence: seven PostgreSQL execution/default tests passed for agent/script manual and triggered launches, explicit overrides, optimistic writes, and immutable existing snapshots. Skill settings API/client generated.

## 5. One optional trigger per skill

Implementation: Enforce at most one trigger per skill, retaining multiple event sources per trigger. Skill Settings > Trigger owns events and enabled state. No independent trigger name or skill selector in UI. Derive display labels from owning skill; preserve trigger IDs and workflow links internally and external API/MCP compatibility.

Acceptance:
- [x] Database/API reject a second trigger for one skill; skills without triggers work.
- [x] Multiple event sources launch the owning skill correctly.
- [x] Skill rename updates trigger display labels; trigger UI has no independent name or skill picker.

Evidence: four PostgreSQL skill settings/ownership scenarios and four Chromium Skills/settings scenarios passed; backend/frontend type checks and build passed. Legacy ownership links are explicitly staged for item 6 conversion before the final constraint.

## 6. Preserve existing context during migration

Implementation: Create a new skill for each existing trigger using prompt and execution settings. Preserve attached skill instructions/files, event templates, existing skills, trigger identities/relationships, and historical runs. Do not reinterpret event-template context or discard inputs. Keep migration-created skills across upstream syncs until published, and preserve supporting files when their instructions are edited.

Acceptance:
- [x] Fixtures cover prompt-only, attached-skill, event-template, and script triggers.
- [x] Instructions/files survive and event templates stay unchanged.
- [x] Trigger relationships and historical run readability survive migration.

Evidence: context migration fixtures passed for prompts, shared attached directories, templates, scripts, workflow grants, history and provenance. Five skill-settings/library integration scenarios also passed.

## 7. Skill pages, list, and workflow graph

Implementation: Team tabs become Skills, Runs, Integrations, Settings. Skill header is bee team / skill-name; subnav Overview, Runs, Settings. Settings sidebar General, VM, Permissions, Trigger. Overview shows instructions, directory browser, Start run; Runs includes manual/triggered runs. Remove obsolete breadcrumbs/usage labels. Improve searchable Skills list with trigger/latest-run/update information; retain trigger graph as Skills graph view. Redirect legacy trigger pages/settings to owning skill.

Acceptance:
- [x] Direct links, selected tabs, headers, skill history, and legacy redirects pass browser tests.
- [x] List search/statuses and Start run operate correctly.
- [x] Existing workflow graph edges and trigger controls remain functional.

Evidence: six compiled Chromium scenarios passed, including mobile navigation, skill defaults, both history sources, legacy redirects and graph controls/edges. Eight backend settings/history/graph tests passed.

## 8. Directory browsing and content caching

Implementation: Persistent, encrypted published-directory cache keyed by tenant/repository/immutable commit; browser caching for navigation. Directory tree and read-only file viewer, explicit binary handling, existing instructions editor. Save/sync chooses new revision; cached revision stays readable during refresh failure with notice. Preserve historical versions and tenant isolation.

Acceptance:
- [x] Instrumented Git fixture proves repeated cached revision reads add no Git fetches.
- [x] Save/sync shows new revision while historical snapshots remain unchanged.
- [x] Nested files, invalid paths, binary files, tenant isolation, and refresh failure pass tests.

Evidence: four PostgreSQL cache/library scenarios passed, including counted fetches, encrypted storage, old/new commits, tenant isolation, invalid paths and upstream failure. Seven Chromium Skills/directory scenarios passed.

## 9. Team Runs navigation and filter cleanup

Implementation: Run detail/full trace reuse team header/subnav with Runs selected, regardless of launch source. Remove trigger breadcrumb and team-table Skill filter. Retain Start run skill selection and skill-filtered links.

Acceptance:
- [x] Manual/triggered run detail and full trace show team navigation with Runs selected.
- [x] Trigger breadcrumb and table Skill dropdown are absent.
- [x] Start run skill selection and skill-filtered history remain functional.

Evidence: all 24 compiled Chromium Runs scenarios passed, including manual/triggered detail/full trace, run switching, skill-filtered links and Start run selection.

## Final validation

- [x] Regenerate OpenAPI/client; check package boundaries.
- [x] Complete root npm test suite passes in pinned validation image with isolated local database, after final code change.

Validation environment: Node 24.12.0 and npm 11.19.0 in the pinned Factorize validation runner image from `docs/factorize-validation-runner.md`. Dependencies installed with `npm ci`. All database checks use isolated loopback PostgreSQL databases; provider, Git, email and VM behaviors are covered with local deterministic fixtures.

Final verification: complete root `npm test` exited 0 after the final code change. All backend, compiled app/API/PostgreSQL, browser, proxy and Docker lanes passed. Backend: 132 test files passed (835 tests passed; five pre-existing optional tests skipped). Compiled application smoke/integration: 40 tests passed. Generated OpenAPI/client, documentation exports and package boundaries are current. Desktop and mobile layouts were also inspected in Chromium.
