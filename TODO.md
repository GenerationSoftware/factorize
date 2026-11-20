# Implementation work

## Working instructions

Implement these items from top to bottom. Complete one item, verify every acceptance criterion, check its boxes, then move to the next item. Keep implementation details and evidence here. Acceptance must be executable by an agent in this VM using isolated PostgreSQL, local services, deterministic provider/VM fixtures, and browser automation. Live deployments, third-party approval, and human actions are not acceptance prerequisites. Preserve existing data. Replace the managed-agent implementation cleanly and retire the old public contracts. Keep historical traces readable. Do not create Linear issues as part of this implementation.

Run focused checks for each item and the complete root suite after the final code change before handoff, using Node 24.12.0 and npm 11.19.0. Use the documented validation runner and isolated local database. New API operations require authorization, validation, OpenAPI, generated client updates, and boundary tests. Record incomplete work honestly and never check a criterion based only on code inspection.

## 1. Personal team ownership

Reuse tenant/membership records as personal teams. Provision a team automatically for each new user. Retire Factorize project CRUD, project navigation/filtering, and personal execution defaults. Move existing project contents under the owning team without deleting jobs, runs, skills, integrations, or historical artifacts. Preserve provider-specific project identifiers. Team settings exist before provider setup and may initially lack execution configuration. Migrate defaults deterministically and expose missing settings as actionable failures. Team invitations and switching are future work.

- [x] Local signup/verification creates exactly one personal team and settings, including retries.
- [x] Migration fixtures with multiple projects and personal defaults preserve all resource IDs/history under the correct team and select deterministic team defaults.
- [x] REST/MCP and browser entry points expose team ownership and settings, reject cross-team access, and no longer expose Factorize project CRUD or personal defaults.
- [x] Full root validation passes and evidence is recorded.

### Item 1 evidence

Completed on 2026-11-20. Migration 0067 creates shared Team settings and migrates deterministic defaults. Migration 0068 removes project requirements, preserves historical project associations as provenance, removes ineffective cross-project grants, migrates Team scopes, and creates personal teams for accounts without ownership. Existing membership roles remain intact. New jobs and runs require no project records. Personal/project default APIs, project CRUD/MCP tools, navigation, selectors, and filters are retired. Session metadata exposes the team.

The complete root npm test passed using the pinned validation image, Node 24.12.0, npm 11.19.0, and isolated PostgreSQL on port 55437. Backend tests passed 724 with 5 skipped, compiled page/API tests passed 40, browser tests passed 95 with 1 skipped plus all 6 functional tests, and runtime/proxy/Docker lanes passed. Evidence is in /tmp/item1-verified.log. Migration fixtures preserve jobs and terminal runs from multiple projects, maintain team isolation, and prune ineffective grants before flattening. Old project-specific UI tests were replaced with flat-dashboard coverage while independent graph geometry tests remain.

## 2. Canonical Triggers and Events

Rename jobs to Triggers and activation rules to Events throughout persistence, domain contracts, REST, MCP, scopes, generated clients, and docs. A Trigger owns Events, concurrency, permissions, and history. Invocation and lifecycle relationships work across the team. Remove compatibility aliases. Preserve only previously effective permission edges during flattening.

- [x] Local contract tests exercise Trigger/Event CRUD, Event firing, concurrency, tenant isolation, invocation permissions, and lifecycle relationships.
- [x] Old job operations/scopes are absent and migration tests preserve effective authorization without activating formerly invalid edges.
- [x] Full root validation passes and evidence is recorded.

### Item 2 evidence

Migration 0069 renames application tables and columns to Triggers and Events while preserving IDs, separates outbox delivery IDs from Event IDs, refreshes PostgreSQL functions and affected indexes, migrates event kinds/configuration/context envelopes and effective stored grants, and keeps webhook/caller payloads intact. Stored encrypted template references are upgraded on read. The public API, MCP operations, frontend routes, generated contract, and product docs use Trigger/Event names. Old job routes and scopes are rejected. Legacy flow/write grant expansion is removed from live authorization and applied only to stored grants during migration. Historical pre-0052 credential-cutover tests retain their original schema fixture.

Completed on 2026-11-20. The complete root npm test passed with the required pinned toolchain and isolated PostgreSQL. All 726 backend tests passed (5 skipped), all 40 compiled frontend/API tests passed, and browser, proxy, runtime, and Docker lanes passed. Evidence is in /tmp/item2-final.log. Historical artifact-kind migration preserves object keys. The archived rollback anchor is tested against its original page contract.

## 3. Dashboard Triggers table and graph

Add dashboard Triggers subnavigation. Reuse the jobs table with name, enabled state, and running count/limit. Move the project graph to the team-wide Triggers page and show cross-former-project relationships. Both views open Trigger detail.

- [x] Browser tests create and open Triggers from both table and graph, including empty/loading/error states and mobile navigation.
- [x] Focused checks pass and evidence is recorded. The complete root suite is required in item 15.

### Item 3 evidence

Completed on 2026-11-20. The dashboard Triggers page has URL-persisted Table and Graph views, a shared Create trigger action, and recoverable list/graph errors. The graph covers the entire team and opens the same Trigger details as the table. Browser checks passed 26 tests with 1 stress test skipped, including mobile create/open from both views, grouped edges, cyclic routes, touch gestures, loading, errors, retry, and empty states. All 4 graph API checks passed and package boundaries passed. Evidence is in /tmp/item3-browser-final.log, /tmp/item3-api-final.log, and /tmp/item3-boundaries.log. The app build passed. Final root validation remains required in item 15.

## 4. Shared skill and Trigger names

Use MCP Skills naming rules. Replace Trigger name/slug/description with one name. Enforce one team-wide namespace across skills and Triggers and reserve manual. Cover edits, concurrent creates, and Git imports. Reject invalid imports atomically and retain the last published library.

- [x] Local tests cover valid/invalid names, cross-resource collisions, concurrent writes, renames, and conflicting Git imports without partial publication.
- [x] Focused checks pass and evidence is recorded. The complete root suite is required in item 15.

### Item 4 evidence

Completed on 2026-11-20. Trigger REST/MCP inputs and responses expose one name, with slug/description inputs rejected. Skills and Triggers follow Agent Skills naming rules and reserve manual. Migration 0070 adds a shared transactional namespace, normalizes legacy names without deleting resources, preserves artifact pointers/history, and records previous names in configuration diagnostics. PostgreSQL uniqueness guards raw writes and concurrent creates. Skill imports validate the complete candidate library and Trigger collisions before remote writes or publication.

The 4 naming boundary/concurrency checks passed, as did Git publication and migration checks. The broad backend run passed 112 files and exposed outdated fixtures in two files; their corrected lifecycle/scope rerun passed all 28 tests (/tmp/item4-scope-lifecycle-final.log). All 5 migration checks passed (/tmp/item4-migration-lifecycle.log), including a legacy cross-resource collision with retained IDs/history. The editor/Triggers browser rerun passed 46 tests with 1 stress test skipped (/tmp/item4-browser-final.log). TypeScript, app build, and contract generation passed. Final complete root validation is still required in item 15.

## 5. Team defaults and settings layout

Store model-provider, VM, capacity, and permission defaults in Team settings. Copy concrete defaults into newly created Triggers and allow overrides. Default edits affect future Triggers and direct runs. Rename Execution to VM. Put provider credentials beside scopes and allowed destinations in Permissions. Keep model settings outside VM. Direct MCP defaults are bounded by caller grants and explicit unauthorized requests fail.

- [x] API/browser tests cover seeding, overrides, explicit empty permissions, caller bounds, default edits, missing configuration errors, and settings layout.
- [x] Focused checks pass and evidence is recorded. The complete root suite is required in item 15.

### Item 5 evidence

Completed on 2026-11-20. Migration 0071 defines initial Team capacity and permission defaults while retaining existing selections. New Triggers copy current VM/model/concurrency/scope/credential/destination settings, with explicit empty overrides preserved. Unchanged default fields are omitted by the creation form so the backend resolves current defaults. Existing Triggers retain their saved settings. Missing/unavailable VM settings and removed default destinations fail before a partial Trigger is committed. Provider credentials and allowed destinations are under Permissions, model/capacity are in General, and the canonical VM section rejects the retired Execution path.

Direct runs intersect defaults with caller scopes and integrations. Destination grants are snapshotted and delegated grants cannot exceed the active parent. Local tests cover allowed/denied invocation and revocation. The broad backend pass had 737 passing tests and one outdated request-parser expectation, which passed after correction in /tmp/item5-last-checks.log. All 7 Team default/authority cases passed, along with direct defaults and manual permission checks (20 tests total in /tmp/item5-authority-verified.log). The refreshed database passed all 5 queue checks, including shared Team capacity (/tmp/item5-queue-final.log). The main browser pass had 56 passing tests and one script-label collision; the corrected script and new defaults/layout cases passed (/tmp/item5-ui-verified.log). TypeScript, app build, generation, boundaries, and diff whitespace checks passed. Final complete root validation remains in item 15.

## 6. Context and Event templates

Agent Triggers have one optional skill and one optional prompt. Each Event has an optional Mustache template. Compose Trigger prompt, rendered Event text, and manual caller instructions in order. Missing templates contribute nothing. Full objects remain available through expressions such as {{webhook}}. Run-name templates see all structured Event data. Provide previews. Skill-only runs are valid. Empty skill and effective prompt fail before provisioning. Scripts retain their script editor.

- [x] Tests exercise skill-only, prompt-only, Event-only, manual instructions, full-object interpolation, missing templates, run-name data access, previews, and empty-input rejection.
- [x] Focused checks pass and evidence is recorded. The complete root suite is required in item 15.

### Item 6 evidence

Completed on 2026-11-20. One optional skill and a literal optional prompt replace multi-skill/template context. Each Event owns its optional Mustache template; missing templates contribute no payload, manual text appends last, and full normalized webhook objects require explicit selection. Run-name rendering retains structured Event data. REST/MCP previews use the same composition. Empty effective input fails before queueing or provisioning. Migration 0072 preserves original ciphertext, multi-skill links, and accepted run snapshots; affected Triggers require explicit context review before re-enabling.

All 22 context and migration checks passed (/tmp/item6-context-final.log), including persisted snapshots, scope and Team isolation, retired-field rejection, full objects, and skill-only direct runs. All 24 editor browser checks passed (/tmp/item6-editor-final.log), including optional prompt, Event templates, escaped previews, and scripts. The earlier dashboard/runs/editor browser pass had 67 passing tests and one stress skip. API/app TypeScript, app build, contract generation, and whitespace checks passed. Final complete root validation remains required in item 15.

The broad backend pass found outdated manual-invocation expectations and a duplicated skill-selection dependency. The relational selection is now authoritative; all 10 affected checks passed in /tmp/item6-last-fixtures.log. The broad pass had 744 other passing tests and 5 skips.

## 7. MCP Skills extension

Use the official extension and publish all active team skills and supporting files. Authorize discovery and reads. Cover editor/Git changes, rename/delete, pagination, and failed publication. Keep skill metadata independent of VM configuration. Follow the framework and extension specification for supported files and metadata.

- [x] A local MCP client discovers and reads an entire skill package and observes publication changes with cross-team reads denied.
- [x] Focused checks pass and evidence is recorded. The complete root suite is required in item 15.

### Item 7 evidence

Completed on 2026-11-20. Modern MCP discovery declares the official Skills extension. skills/list pages complete manifests; skills/get and resources/read authorize every request and validate canonical Team-prefixed URIs. Manifests contain exact SHA-256 digests and byte lengths for SKILL.md and supporting files. Literal legacy bodies receive a published frontmatter wrapper; author metadata and binary bytes are retained. Invalid metadata and oversized/duplicate manifests fail publication before remote writes. Git failures preserve the last valid publication. Skill metadata does not depend on a VM.

All package, modern MCP, Git transport, and publication checks passed (11 tests across /tmp/item7-tests.log and /tmp/item7-boundary-final.log, with the initial HTTP-header fixture corrected). Coverage includes discovery, pagination, complete package reads and digests, edits/rename/delete, cross-Team denial, revoked membership/scopes, malformed paths, binary content, and rejected Git metadata. API TypeScript, Worker dry-run bundle, generated docs, and docs validation passed (/tmp/item7-types-verified.log, /tmp/item7-bundle.log, /tmp/item7-docs-final.log). Final complete root validation remains in item 15.

## 8. Hosted Pi and PostgreSQL sessions

Bundle a pinned Pi framework in the Factorize build as the sole managed agent. Remove in-VM Pi/Codex/Claude launch paths. Keep scripts as VM workloads. Configure an OpenAI-compatible base URL, model, and optional credential through integrations. Use PostgreSQL for messages, checkpoints, tool call/results, session metadata, and run state. Reuse framework streaming, compaction, and lifecycle behavior. Determine the compatible execution host from framework runtime requirements while preserving Worker infrastructure identity.

- [x] A deterministic local OpenAI-compatible server drives a real bundled Pi turn, streaming, errors, compaction, cancellation, and session recovery from PostgreSQL after restart.
- [x] Managed-agent launches contain no guest harness dependency; retained historical traces remain readable.
- [x] Focused checks pass and evidence is recorded. The complete root suite is required in item 15.

### Item 8 evidence

Completed on 2026-11-20. Pi Agent Core and Pi AI 1.5.2 are pinned in the Factorize build. Scheduler-managed agents initialize hosted PostgreSQL sessions and never construct a guest agent backend. Scripts retain VM execution. The new model integration contract takes an OpenAI-compatible provider URL, optional key, and context/output limits; it exposes safe metadata and retires device authorization, native/portable model selection and managed harness selection. Models are independent of VM catalogs. VM connection setup and image verification no longer probe guest agent CLIs or models. Historical guest launch fixtures are test-only; historical trace parsers and retained rows remain readable.

Migration 0073 adds encrypted session/checkpoint and streaming event persistence, tool-call records, lease epochs, and compaction/turn metadata. It preserves historical run configurations and records retired Team/Trigger agent choices as diagnostics. The framework owns provider streaming, tool validation/execution, and cancellation. Framework model calls provide checkpointed compaction while retaining original events. Live message projections use the existing trace table. Provider credentials are resolved per turn and excluded from error traces.

The local real-Pi/OpenAI-compatible server and provider API pass had 11 passing checks (/tmp/item8-core-final.log), covering authenticated and keyless streaming, errors, tool continuation in a fresh harness, compaction, cancellation, competing/expired leases, and scheduler launch without guest dependencies. The broader focused pass had 34 passing checks (/tmp/item8-focused.log); all 43 VM transport checks and 23 historical trace checks passed (/tmp/item8-vm-transport.log, /tmp/item8-history.log). All 11 settings browser tests passed (/tmp/item8-settings-verified.log). A real workerd test streams and executes a framework-validated tool successfully (/tmp/item8-workerd.log) and is included in root validation. API TypeScript, app build, generated contract/docs and docs validation passed. Final complete root validation remains required in item 15.

## 9. Hosted Pi as an MCP client

Give Pi a run-scoped identity bounded by effective permissions. Use the same skills, MCP tools, resources, and reflection as external agents. Avoid privileged internal tool shortcuts. Include a provider-independent launch instruction mentioning reflection.

- [x] One unchanged skill executes through hosted Pi and an external local MCP client; denied scopes and integration revocation are enforced.
- [x] Focused checks pass and evidence is recorded. The complete root suite is required in item 15.

### Item 9 evidence

Completed on 2026-11-20. Hosted Pi discovers protocol capabilities/tools and calls the public Worker MCP boundary with short-lived HMAC credentials bound to its PostgreSQL lease epoch. Application scopes, owner validity, active state, selected integrations and revocation are enforced by the same services used by external clients. MCP exposes credential-injected request/read operations alongside reflection. Resource and Skills extension adapters give Pi standard MCP reads; pinned input packages are available only to their own active run without granting broad library access. The bootstrap instruction points to reflection and pinned skill URIs. Model credential resolution uses the new provider configuration, and retired device/subscription implementations are removed.

Migration 0074 removes the obsolete Trigger-parent requirement from permanent run credential revocations, covers all reflected integration kinds and known historical delete receipts, and remains retry-safe. Hosted invocation enforces destination grants, retains source-run provenance, and cannot expand permissions. MCP request cancellation propagates to upstream requests. Streaming journals retain framework deltas instead of repeatedly copying growing partial messages.

All 39 focused harness, MCP, invocation and forwarding checks passed (/tmp/item9-final.log), followed by all 7 final MCP checks after cancellation wiring (/tmp/item9-mcp-complete.log). These execute an unchanged skill using both real hosted Pi and a separate local MCP client, verify scope/Team isolation, stable pinned packages after deletion, token forgery/expiry/lease replacement, disconnection/reconnect denial, destination limits, and idempotent revocation backfill without revoking newer snapshots. Earlier shared integration/grant checks also passed (/tmp/item9-integration.log). API TypeScript, Worker dry-run bundle, generated contract/docs, docs validation and whitespace checks passed. Final complete root validation remains required in item 15.

## 10. Optional workspace VMs

Requires VM defaults off for agents and is mandatory for scripts. Resolve explicit configuration before Team defaults. Failure of the selected configuration is an error. Provision and wait for readiness before the first Pi turn. Bind workspace identity server-side and expose verified current_vm through reflection; VM-free runs report null. Cover exe.dev and Fly with deterministic adapters.

- [x] Local tests prove readiness precedes the first turn, explicit/default failures are surfaced, VM-free runs provision nothing, identities cannot be spoofed, and cleanup/cancellation work.
- [x] Focused checks pass and evidence is recorded. The complete root suite is required in item 15.

### Item 10 evidence

Completed on 2026-11-20. Migration 0075 preserves existing effective VM choices while new agent defaults are VM-free, and introduces independent workspace receipts. Explicit selections precede Team defaults; required missing/unavailable VMs fail without fallback. Triggers copy settings once. Scripts always require a VM. The editor and Team settings expose Requires VM; choosing a VM no longer resets model credentials.

Workspace provisioning is separate from guest harness launch. exe.dev and Fly use documented provider APIs, persisted operation identities, fenced provisioning/cleanup leases, selected integration epochs and encrypted random guest proofs. Readiness precedes the first Pi turn; later turns and vm_exec verify the binding again. Reflection describes Factorize as the agent host and the remote current_vm separately. vm_exec rejects arbitrary VM IDs and unbound external identities. Cleanup retains late provisioning and deletion failures for retry; hosted sessions retain their terminal status during cleanup.

All 11 workspace/provider checks passed (/tmp/item10-final.log), including real Pi turns after both adapters become ready, VM-free execution, explicit/default failure, Trigger default isolation, spoof/proof checks, cancellation and deletion retries. The shared hosted harness/MCP pass had 22 passing checks (/tmp/item10-vm.log). All 36 editor/settings browser checks passed (/tmp/item10-browser-final.log), following corrections to historical fixtures for explicit model configuration. API TypeScript, app build, Worker dry-run, generated contract and docs validation passed. Complete root validation remains required in item 15.

## 11. Asynchronous and recoverable runs

Return run ID promptly. Expose state, diagnostics, and results. Use idempotent launch and durable execution leases. Recover interrupted streaming and tool execution without duplicating known effects. Reconcile or explicitly report uncertain tool outcomes. Prevent concurrent resumptions and cancellation from restoring access.

- [x] Local fault-injection tests restart during provisioning, streaming, and tool execution, retry the same launch, race workers, and cancel active work with one consistent outcome.
- [x] Focused checks pass and evidence is recorded. The complete root suite is required in item 15.

### Item 11 evidence

Completed on 2026-11-20. Admission returns an idempotent receipt without provisioning or model work. Independent per-run durable alarms keep long streams and workspace startup off global admission/maintenance. PostgreSQL lease epochs fence execution and MCP authorization. Complete checkpoints recover streamed turns; a durable tool journal records canonical arguments before effects and encrypted results before delivery. Recovery uses Pi's own validated tool runner, replays committed results and executes only missing calls. Detached run/Trigger tools receive stable server idempotency keys and retry interrupted responses on the same call. Unknown mutating outcomes block with pi_tool_uncertain, call ID and diagnostics; later effects/model requests stop. Cancellation cannot reopen a lease or commit late tool output.

All 33 harness/MCP/workspace/recovery/alarm checks passed (/tmp/item11-final.log). Faults cover partial tool batches, lost detached-run responses, uncertain remote writes, expired/concurrent leases, old-worker streaming completion, asynchronous receipts, per-run alarm identity/retry, late provisioning and cancellation. API TypeScript (/tmp/item11-types-verified.log), Worker bundle (/tmp/item11-bundle.log), and package boundaries passed. Complete root validation remains required in item 15.

## 12. Media passthrough and run artifacts

Follow the pinned Pi framework's accepted media/content contracts and provider adapters. Factorize is a media pipe. Support launch attachments and media fetched through authorized tools using the same artifact references. Store bytes in existing RUN_ARTIFACTS R2 and ownership, size, type, checksum, and lifecycle in PostgreSQL. Expose uploads and reads through documented application endpoints/MCP where appropriate. Stream large transfers and keep credentials out of references and traces. Let framework capability checks report unsupported media.

- [x] A local model fixture verifies actual image bytes from launch and mid-run tool retrieval, plus every additional media type supported by the pinned Pi version.
- [x] Tests cover restart recovery, malformed/unsupported content, interrupted uploads, idempotent retries, and cross-team denial using local R2.
- [x] Focused checks pass and evidence is recorded. The complete root suite is required in item 15.

### Item 12 evidence

Completed on 2026-11-20. Migration 0076 adds independent media/upload-attempt receipts and run input/scratch links while bytes use existing RUN_ARTIFACTS R2. Documented public reservation, binary upload/download and integration-fetch operations enforce active identity, ownership, immutable idempotency, size and SHA-256. Uploads stream through incremental hashing and Worker fixed-length streams. Image-only launches are valid; the dashboard uses the same public endpoints. MCP fetch_media and read_media share ordinary integration authorization and standard image content with external clients. Hosted Pi stores references in checkpoints/tool receipts/events and hydrates original bytes only at the framework boundary. Reflection reports the exact pinned text/image capability and bounded upload/turn sizes; audio/video unsupported by Pi 1.5.2 are rejected without conversion.

All 6 media checks passed with PostgreSQL, real local R2, real Pi and public REST/MCP (/tmp/item12-media-last.log), including launch/tool image byte equality across fresh harnesses, integrity, large multi-chunk streams, cancellation/retry, malformed content, unsupported types and Team/run isolation. The shared harness/MCP/recovery pass had 19 passing checks (/tmp/item12-final.log). Both runs browser checks passed (/tmp/item12-browser.log), including raw image upload before image-only admission. A real Worker runtime test verifies incremental hashing/fixed-length streaming into R2 (/tmp/item12-runtime-final.log) and is part of root validation. API TypeScript, app build, Worker bundle, generated contract/docs and docs validation passed. Complete root validation remains required in item 15.

## 13. Artifact cleanup

Retain inputs and results for run retention. Intermediate blobs are scratch with a short recovery window. Do not add artifact promotion. Clean abandoned uploads and expired scratch without deleting active-run dependencies. Make PostgreSQL/R2 partial failure and retries safe.

- [x] Controlled-clock local tests cover abandoned uploads, active runs, terminal recovery windows, result retention, deletion retries, and partially completed writes.
- [x] Focused checks pass and evidence is recorded. The complete root suite is required in item 15.

### Item 13 evidence

Completed on 2026-11-20. Migration 0077 records first reachability and cleanup leases/tombstones. Active run dependencies are protected, scratch expires one hour after termination, and unattached uploads expire after 24 hours. Inputs and media references included in actual structured results remain with retained run history. Result reachability is automatic; no promotion endpoint or separate published-output feature exists. Invalid/foreign result references fail the run explicitly. Run deletion leaves independent receipts for object cleanup. Private HTTP proxy buffers created only for fetch_media expire immediately after capture.

Cleanup fences new attachment/read operations, claims independent PostgreSQL leases, confirms R2 deletions, retries partial failures and repeats tombstone deletion for 24 hours to cover late writes. Existing retention-pause settings also pause media expiry. All 13 controlled-clock lifecycle/media checks passed (/tmp/item13-complete.log), covering abandoned uploads, active leases/runs, terminal recovery, input/result retention, real Pi result references, missing result media, private response buffers, competing cleaners, lost deletion acknowledgements and late unadopted writes. The shared recovery pass had 18 passing checks (/tmp/item13-final.log). API TypeScript and Worker bundle passed; complete root validation remains required in item 15.

## 14. Runs Source and Prompt columns

Keep run name. Source snapshots Trigger name or manual for direct runs. Prompt shows optional /skill plus effective prompt, or shortened script. Store snapshots at creation and preserve complete detail content and historical rows.

- [x] Browser/API tests cover renamed/deleted Triggers and skills, manual Trigger invocation, direct runs, scripts, old rows, and long content at desktop/mobile widths.
- [x] Focused checks pass and evidence is recorded. The complete root suite is required in item 15.

### Item 14 evidence

Completed on 2026-11-20. Migration 0078 preserves captured Trigger source names, backfills only missing names, and adds encrypted bounded list previews plus full context snapshots. New Trigger/manual/Event and direct admissions snapshot literal effective context independently of the reusable skill body; scripts snapshot their actual script. Source is the captured Trigger name or manual for direct runs. Existing launch skill keys remain immutable. Full harness input, full context/script, run name and historical rows remain available. Authorized list reads decrypt only bounded previews for new rows, with a bounded-page historical fallback; source sorting/pagination uses snapshots.

All four PostgreSQL/API checks passed (/tmp/item14-preview.log), covering names after rename/deletion, manual Trigger/direct runs, skill-only context, Event/manual composition, script shortening, encrypted snapshots, full detail, historical fallback, permissions and pagination. All 23 runs browser checks passed (/tmp/item14-all-browser.log), including desktop/mobile Source/Prompt columns, escaping, long names/prompts, unchanged run-name links, metadata widths and table-contained scrolling. API TypeScript, app build, generated contracts and Worker bundle passed. Complete root validation remains required in item 15.

## 15. Migration and final integration validation

Complete coordinated migration while preserving accounts, integrations, skills, runs, artifacts, and historical trace readability. Identify incompatible names and multi-skill jobs with actionable local diagnostics. Validate supported upgrade paths and final public contracts. Update OpenAPI, generated client, and product docs. Test locally without requiring deployment or external approvals.

- [x] Representative pre-change database fixtures migrate without resource/history loss or unintended permission expansion, including a retry after interruption.
- [x] End-to-end local tests cover signup, Team setup, Trigger Event, MCP skill, hosted Pi, optional VM, media, result, restart, and cleanup.
- [x] npm run generate, boundary checks, and complete npm test pass on the required toolchain; evidence and any remaining limitations are recorded.

### Item 15 evidence

Completed on 2026-11-20. Representative upgrade fixtures apply migrations 0067–0079 with rollback/interruption and retry at each new migration, followed by the actual migration runner to verify no replay. Eight migration checks preserve accounts, encrypted integrations, resource IDs, historical runs/traces, artifact object keys and previously effective authorization. Invalid/colliding names migrate deterministically; previous multi-skill context is archived with an explicit review requirement. Migration 0079 preserves unstarted guest-agent admissions as blocked, with actionable diagnostics and cancellation; it never reinterprets their credentials or launches a retired harness. The runtime also rejects such legacy admissions. Already-running historical guest executions retain their existing readers; the documented production release procedure drains them before cutover. No production migration or deployment was performed.

The full local lifecycle test passes through signup and personal Team creation, provider/VM defaults, a templated Trigger Event, duplicate admission, published MCP skill metadata/files, actual hosted Pi requests after VM readiness, scoped VM commands, unchanged image retrieval, fresh-harness restart, structured result media retention, run expiry and object/VM cleanup. Tests use isolated PostgreSQL, local HTTP fixtures and local R2. Additional actual workerd tests cover OAuth consent, client isolation, integration revocation, ordinary MCP requests, guest delegation and hosted Pi background outcome delivery to an idle/reconnected session. VM execution rechecks the calling lease immediately before the command; exe.dev workspace inventory failures cannot masquerade as deletion, and shared native Factorize proxies are rejected.

The final complete root npm test passed on Node 24.12.0/npm 11.19.0 in the pinned validation runner, using only the isolated localhost:55437 database. Evidence: /tmp/item15-root-4.log (exit 0, all 12 validation stages passed). Backend: 128 files, 816 tests passed and 5 skipped. Compiled app/API/PostgreSQL: 40 passed. Browser: 111 passed and 1 skipped, plus all 6 functional checks. Proxy: 4 process-runner checks and 32 protocol checks passed. Docker: both real-container vendor-identity/script/cleanup checks passed. Contract generation/drift, package/API boundaries, docs validation, TypeScript, Worker dry-run bundles, Pi/media/conditions/hosting/OAuth/rollback runtime checks and Tail relay checks all passed. The backend lane deadline is now 480 seconds and the overall deadline 1000 seconds to accommodate the expanded suite; individual test timeouts and failure assertions remain enforced.

Focused upgrade/lifecycle evidence: /tmp/item15-integrated.log (8 migration checks, lifecycle and provider checks), /tmp/item15-last-focused.log (14 VM/provider/lifecycle checks), /tmp/item15-agent-runtime-4.log (actual workerd background outcome delivery), and /tmp/item15-static-2.log (40 compiled application checks). OpenAPI, generated client, product docs and operator runbooks describe the final contracts. The supported media contract follows pinned Pi 1.5.2: text and images; unsupported audio/video fail explicitly without conversion. Public contract renames are breaking and have no compatibility aliases. Existing data is preserved; pending legacy guest-agent runs require cancellation and a newly configured admission rather than silent credential substitution. External deployment/provider approval is outside local acceptance and was not used to claim completion.
