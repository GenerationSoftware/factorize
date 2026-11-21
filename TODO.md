# Built-in MCP workflows and renewable VM grants

## Execution instructions

Implement each item from top to bottom. An item is complete only when all its acceptance criteria are fulfilled and checked off, with local verification evidence recorded beneath it. Only then start the next item. Continue until all items are complete. Do not mark unverified work complete.

All criteria must be achievable by this agent in this VM. Use the existing pinned Factorize validation runner container (Node 24.12.0, npm 11.19.0), isolated loopback PostgreSQL and deterministic local provider/model fixtures. No criterion requires production deployment, a live provider account, external approval or publishing a plugin. Never validate against production/shared databases. Preserve package boundaries and existing client compatibility. Register JSON application operations under /api/v1, document them in OpenAPI and regenerate the public client. Run the complete root npm test after the final code change.

## 1. [x] Canonical build-shipped workflow skills

Create five standard, portable SKILL.md files: manage presets; manage skills; run and supervise work; manage triggers; manage environments and access. Explain real MCP operations with useful examples, authorization prerequisites, safe edits/retries and verification. Cover all preset types/defaults, skill frontmatter and dependencies, direct runs and pinned inputs, completion subscriptions and fallback, automation delivery diagnostics, reflection, exe.dev/Fly.io lifecycle and renewable grants. These files are the single source of truth; no plugin manifests or installation artifacts yet. Embed deterministic generated content into the Worker build without reading files at runtime.

Acceptance:

- [x] Exactly five canonical skills have valid standard name/description frontmatter and cover the agreed workflows and operation names.
- [x] Local tests compare embedded bytes against the canonical files and validate stable, content-versioned URIs, exact byte sizes and SHA-256 manifests.
- [x] Generation is deterministic; a local drift check rejects stale generated content. No team/session/provider credentials appear in the catalog.

Evidence: Pinned runner npm ci completed; generate:skills and check:skills passed. builtin-skills.test.ts: 4 tests passed, including exact canonical bytes/manifests, deterministic generation, stale-output rejection and invalid URI rejection.

## 2. [x] Static MCP Skills extension boundary

Publish only the built-in catalog through skills/list and skills/get for active authenticated identities, independent of skills:read. Serve its exact Markdown through resources/read. Editable team skills remain behind existing tools; retain authorized legacy team resources for compatibility. Pinned run packages remain readable resources but never appear in extension discovery. Keep authorization checks on every read and preserve Pi's pinned input references.

Acceptance:

- [x] Local MCP tests discover/get/read exactly five built-ins with matching manifests and no team or run entries, including clients without skills:read.
- [x] Different tenants/scopes/runs and team edits/renames/deletes cannot change built-in catalog content; inactive identities and invalid/noncanonical URIs are rejected.
- [x] Local tests prove team list/get tools still work with their existing scopes, legacy resources remain protected, and active runs can read their own immutable pinned supporting files without skills:read.
- [x] Hosted Pi discovery/read tests pass with the static catalog and retained pinned input resources.

Evidence: Pinned runner MCP catalog tests (4), package helpers (3), canonical catalog tests (4) passed; hosted-pi-mcp.postgres.test.ts (7) passed after updating the deterministic model fixture to discover built-ins. Tests cover cross-team/scope stability, rejected inactive identities/paths, retained team tools/resources and pinned supporting files after edits/deletion. Logs: /tmp/factorize-workflows-item2.log and /tmp/factorize-workflows-item2-pi.log.

## 3. [x] Explicit renewable one-hour grant leases

Decouple new VM grant expiry from the issuing OAuth access token. Creation and explicit renewal give one hour from that operation; token refresh alone does not renew a grant. Add renew_vm_grant and POST /api/v1/agent/vm-grants/{grantId}/renew. Only the same active parent OAuth authorization may renew with vm:grant, proxy:use and continuing access to the provider and every selected integration. Expired/revoked grants cannot be renewed or revived by replaying creation; require a new grant/idempotency key. Preserve existing exe.dev grant input and receipt compatibility. Timeout/revocation removes access, never deletes the VM.

Acceptance:

- [x] Local database/API tests verify one-hour creation independent of remaining token lifetime, successful renewal and no implicit renewal during ordinary requests/replayed creation.
- [x] Tests reject expired/revoked/foreign-parent/foreign-tenant renewal, missing scopes and revoked/disconnected provider or selected integrations; rejected renewal does not extend expiry.
- [x] Proxy access remains limited to selected integrations and checks current parent authorization; expiry/revocation blocks access and cleanup preserves the VM.
- [x] REST/MCP renewal use the same implementation; OpenAPI and generated client contain the validated operation.

Evidence: vm-grant-renewal.postgres.test.ts: 12 passed for shared REST/MCP renewal, token-independent leases, replay, ownership, expiry/revocation and integration access changes. Real Worker/OAuth agent-api-runtime.test.mjs: 2 passed with signed exe.dev identity, grant creation/renewal, subset enforcement, expiry/revocation and cleanup. npm run generate passed. Logs: /tmp/factorize-workflows-item3.log and /tmp/factorize-workflows-item3-runtime.log.

## 4. [x] Fly.io grants using shared OIDC primitives

Extend grant_vm to Fly.io with an app selector plus exact Machine ID, preserving exe.dev calls. Reuse shared issuer discovery/signature/claim verification, Fly token acquisition and guest execution. Bind grants to the connected organization, app, machine, exact subject, grant-specific audience and guest-local proof. Return usable provider-specific token acquisition instructions. Expose both provider capabilities in reflection. Provider-specific cleanup never destroys the VM.

Acceptance:

- [x] Deterministic local provider fixtures enroll both providers and authenticate actual signed OIDC tokens through the proxy boundary; Fly grants renew/revoke/expire like exe.dev grants.
- [x] Tests reject wrong organization/app/machine/subject/audience, invalid/expired signatures, wrong proof, cross-parent access and changed provider identity/configuration.
- [x] Tests verify idempotent enrollment/retries, conflicting idempotency input rejection, selected-integration limits, fresh token renewal and safe cleanup without VM deletion.
- [x] Reflection and generated contracts identify exe.dev and Fly.io grant capabilities; existing exe.dev callers and receipts remain compatible.

Evidence: Real Worker/OAuth runtime suite: 2 passed, including signed Fly and exe.dev OIDC enrollment/authentication, malformed identities/proofs, changed app organization/machine subject, idempotent enrollment recovery, token refresh plus explicit renewal, parent revocation and non-destructive cleanup. Shared verifier/token-source/lease suites: 29 passed. API TypeScript check passed. Logs: /tmp/factorize-workflows-item4-runtime.log and /tmp/factorize-workflows-item4-tests.log.

## 5. [x] Documentation, integration review and complete validation

Update MCP overview/tool reference and integration authorization documentation for static workflow discovery, live team skill tools, pinned resources, both grant providers and explicit one-hour lease renewal. Verify examples and contracts against implementation. Review authorization and compatibility together and complete root validation.

Acceptance:

- [x] Documentation validation, generated-content/contract drift checks, TypeScript and package boundary checks pass locally.
- [x] The complete root npm test passes after the final code change in the pinned runner with isolated databases, including real Worker/OAuth and Chromium lanes.
- [x] git diff --check passes; review confirms exact build-owned skills, preserved pinned/team reads, bounded delegation, renewal ownership and provider identity verification.
- [x] All preceding items have local evidence recorded here; the handoff reports changed behavior, validation and any limitations honestly.


Evidence: Complete root npm test passed after the final code change on 2026-11-21 in factorize-proxy-validation-final, using the pinned runner image sha256:1333c4a7bb49c4cbcdd28ca2b57331dfcbff7cf611db1aaeaa4830517aacf6d4, Node 24.12.0 and npm 11.19.0. npm ci completed before validation; bootstrap:test created the isolated loopback database and db:migrate applied 0093_fly_vm_grants. Reproduce from the repository root:

```sh
docker exec -u exedev -w /work \
  -e DATABASE_URL=postgresql://postgres:local-validation-only@127.0.0.1:55434/factorize_workflows_validation \
  -e AUTH_TEST_DATABASE_URL=postgresql://postgres:local-validation-only@127.0.0.1:55434/factorize_workflows_validation \
  -e QUEUE_TEST_DATABASE_URL=postgresql://postgres:local-validation-only@127.0.0.1:55434/factorize_workflows_validation \
  factorize-proxy-validation-final npm test
git diff --check
git diff --cached --check
```

Result: all root validation steps passed, including generated skills/contracts and drift checks, builds, documentation/MCP inventory, package/API boundaries, TypeScript, Worker bundles/runtimes and OAuth, compiled app/API/PostgreSQL integration, Chromium, portable proxy and Docker. Backend: 149 files, 892 passed / 5 existing skips. Compiled integration: 40 passed. Functional Chromium: 6 passed. Application/browser checks: 139 passed / 1 existing skip. Proxy: 32 protocol tests and 4 harness tests passed. Docker historical compatibility: 2 passed. Full log: /tmp/factorize-workflows-root-final.log. Separate documentation generation/validation and package boundary checks passed; both whitespace checks passed. Final review covered static exact-byte publication and deployment generation, authenticated built-in reads, protected team/pinned resources, additive migration compatibility, parent ownership and current integration epochs at renewal, exact provider OIDC bindings, guest proof handling and non-destructive cleanup. Provider acceptance uses deterministic local fixtures and signed JWTs, without claiming new live-provider/deployment validation. Plugin packaging remains intentionally outside scope.
