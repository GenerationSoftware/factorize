# Restore VM permission grants

Complete each of these steps in order.  Complete means that the criteria is fully met, at which point the box can be checked and you can move onto the next.  Continue until all acceptance criteria is met, then validate the work and push to origin/main

Each checkbox represents a step. Record the verification command and outcome before checking a box. Follow [AGENTS.md](AGENTS.md) and preserve unrelated changes. Use an isolated local database and simulated provider endpoints for automated tests. Keep live provider access and production release separate from local validation.

## Scope

A team can grant Factorize permissions to an existing exe.dev VM or Fly.io Machine, replace those permissions, or revoke them. An enrolled VM can use scoped Factorize REST endpoints and MCP tools as a workload identity. The VMs page lists active grants and lets users edit or revoke them. Initial grants are made through REST or MCP. VM creation, destruction, suspension, resumption, and inactivity shutdown stay with the providers.

## Implementation and acceptance criteria

### 1. Establish the validation and provider identity requirements

- [x] Confirm the local validation environment and define the provider evidence each adapter must verify.

**Acceptance criteria**

- Record the results of the [validation runner](docs/factorize-validation-runner.md) smoke check, `npm ci`, and a baseline `npm run test:local` using Node 24.21.0 and npm 11.19.0. If the host lacks Chromium, use the documented runner image.
- Trace the historical VM grant enrollment and verifier from the parent of commit `d5bad9f`. Record which behavior can be reused without restoring run or job execution.
- Document the provider trust rules. Fly.io signs the exact `machine_id`. exe.dev's WIF subject identifies an integration, so its direct and exclusive attachment must be checked together with documented provider evidence that the target is still the original VM. A name, tag, mutable attachment, or copied guest key cannot establish that continuity.
- Identify which guarantees can be exercised with fixtures and which need live provider evidence. The local acceptance path requires no provider credentials or live VM mutations. [Fly.io workload identity](https://fly.io/blog/oidc-cloud-roles/) · [exe.dev WIF](https://exe.dev/docs/integrations-gcp-wif) · [exe.dev attachments](https://exe.dev/docs/integrations-attach)

**Verification record**

- The parent of `d5bad9f` contains `vm-grants.ts`, `vm-grant-providers.ts`, and `vendor-run-identity.ts`. The issuer discovery, JWKS, signature and claim checks, and exact provider target checks can be reused independently of job execution. The old reusable guest secret will be replaced by proof of possession of a guest key.
- Fly.io documents a signed Machine ID. The exe.dev inventory example documents the VM name, and the WIF documentation exposes the integration issuer and subject. These documented fields do not yet supply evidence of continuity across replacement. Keep exe.dev disabled unless a documented source of that evidence is verified. [Fly.io signed claims](https://fly.io/blog/oidc-cloud-roles/) · [exe.dev VM inventory](https://exe.dev/docs/api.md) · [exe.dev WIF inventory](https://exe.dev/docs/integrations-gcp-wif)
- The documented runner image smoke check passed with Chromium 156.0.8078.4 as UID 1000 and loopback PostgreSQL password authentication. Run `npm ci` as `exedev` with a writable npm cache in the container. The first container attempt inherited the root npm cache from `runuser --preserve-environment`; the retry uses a per-container cache.
- The clean `02ca4be` checkout passed `npm ci` and `npm run test:local` in the documented image at `sha256:def581d5231b508165c88d97daedccba6de2cb6d568440cabad3ac7913f66930`. The baseline included 201 API tests, 24 browser tests, both Worker runtime tests, and all static checks. `git fetch origin main` confirmed the same baseline commit on `origin/main`.

### 2. Add durable grants and delegation checks

- [x] Add the forward database migration, grant repository, and shared authorization logic.

**Acceptance criteria**

- The migration applies to an empty database and to the schema left by the previous VM removal. Persist team ownership, the provider connection and target, a verified machine binding, the permission snapshot, revision, enrollment or revocation state, and audit metadata. Store the guest public key only. Repeated and concurrent grants cannot create duplicate active grants for the same team and verified VM.
- Register `vms:read` and `vms:edit` in the existing scope catalogs and permission pickers. Read grants require `vms:read`. Grant, edit, and revoke require `vms:edit`. A caller can use the team's selected VM provider connection for enrollment with `vms:edit`. The separate integration proxy still requires its own permissions.
- Accept exactly one permission source, a team preset ID or an explicit scope list. Resolve the preset at grant time and save the concrete scopes. Preset edits or deletion leave the snapshot intact.
- Reject the whole request when any scope exceeds the caller's current effective access, including disabled client scopes, integration overrides, unavailable integrations, and stale integration scope versions. Tests assert that a rejected grant leaves the existing revision and scopes intact and makes no enrollment call. A VM granting onward follows the same subset rule.
- Tests verify tenant isolation, immediate effect of disconnected or superseded integration scopes, and the team-owned lifetime of grants after the issuing client disconnects. An authorized team caller can revoke any of its team's grants.

**Verification record**

- `0101_vm_permission_grants` applied from both an empty database and an isolated database migrated through `0100`. `test/vm-permissions.postgres.test.ts` passed both tests for concurrent reservations, preset snapshots, tenant isolation, revocation, and full-request rejection. The transaction test verifies rejection does not invoke the continuation that reserves the grant.
- `npm run generate`, `npm run test:static`, and the focused API type check passed. End-to-end admission, provider calls, and API coverage are verified in the later steps.

### 3. Enroll and verify the exact VM

- [x] Implement provider adapters for enrollment and verification, using documented provider interfaces.

**Acceptance criteria**

- Resolve an exe.dev target by the selected team connection and VM name. Resolve a Fly.io target by the selected team connection, app, and Machine ID. Check provider ownership through the control plane before enrollment. Reserve a grant ID before making provider changes. Activate only after the target proves its identity and possession of the guest-generated key. Retries use the reservation and cannot activate an ambiguous or partial enrollment.
- Have the target guest mint a fresh provider-signed OIDC token for a unique grant audience. Validate approved signing algorithms, the signature, trusted provider discovery and signing-key origins, exact issuer, subject and audience, and token lifetime. The test suite covers missing and mismatched claims, invalid signatures, expired and future-issued tokens, trusted signing-key rotation, and an unknown signing key.
- For Fly.io, verify the connected organization and app through the provider API and require the signed `machine_id` to match the persisted Machine ID. Tests reject another Machine in the same app and organization, a same-name replacement, a token missing the Machine ID, and provider app or organization mismatches.
- For exe.dev, check the grant-specific WIF integration and its exact direct attachment. Gate activation on documented provider evidence that distinguishes the original VM from a clone or same-name replacement. Tests reject detached, moved, shared, tag-based, or replaced attachments, an unresolved rename, a same-name replacement, and a clone carrying the original guest key. Missing or ambiguous identity evidence fails closed. A release configuration test verifies exe.dev grants stay disabled until that evidence is available and verified.
- Fixture tests use real signed test JWTs and simulated provider responses. They cover interruption after remote setup, safe retry, and provider unavailability. Credentials, guest private keys, and raw tokens are absent from public responses, audit records, and error logs.

**Verification record**

- Targeted Vitest run passed 16 tests across VM permissions, vendor OIDC, and Fly enrollment. The fixtures exercise signed Machine identity, wrong organization, signing-key rotation, rejected delegation without provider calls, and retry after OIDC discovery fails following guest setup. The API type check passed.
- No documented exe.dev machine-continuity proof was verified. The release gate denies exe.dev activation for every attachment or guest-key state, including a copied key with ambiguous identity. Its live provider checks remain pending.

### 4. Authenticate VM workloads and enforce revocation

- [x] Route VM identity through the real REST and MCP Worker entry points and downstream authorization.

**Acceptance criteria**

- A distinct VM principal derives its tenant, machine, and scope snapshot from the active grant. A grant ID supplied by a guest serves only as a lookup hint. The intended VM can call scoped REST endpoints and MCP tools. Interactive owner-session checks still apply. Invalid VM authentication fails without falling back to another credential.
- Require a fresh provider token and a signed request-bound proof from the enrolled key. Bind the proof to the grant, presented token, HTTP method, and request target, and give it a short validity window and replay identifier. On both REST and MCP, reject a copied token without the enrolled key, a proof for a different grant, token or request, and repeated proofs. Concurrent use of the same proof admits at most one request.
- Recheck the active grant, provider binding, and effective scopes before admitting each request. Provider failures that prevent verification deny access. Scope retained proxy operations, responses, and payloads to the VM principal. Queued work rechecks authorization before dispatch, and live subscriptions recheck authorization before delivering further updates.
- An atomic edit checks the grant revision, changes only the permission snapshot, and cannot reactivate a revoked grant. Revocation blocks subsequent requests and reads even when provider cleanup fails. Cleanup retries can remove only the provider material owned by that grant. Re-granting creates fresh identity material and cannot restore access to old credentials.

**Verification record**

- The focused suite passed 17 tests. Tests invoke the Worker REST and MCP paths with Fly-signed fixture JWTs and request proofs, reject proof replay and concurrent duplicate use, and verify revocation blocks retained reads and prevents queued upstream dispatch. API type checking passed.
- Fly issues Machine OIDC itself and creates no per-grant provider attachment to clean up. Revocation is committed in Factorize and requires no provider call. exe.dev enrollment and cleanup remain behind the closed continuity gate.

### 5. Add the REST and MCP operations

- [x] Expose the shared grant service through the public contract and MCP.

**Acceptance criteria**

| Operation | REST | MCP | Scope |
| --- | --- | --- | --- |
| List active grants | `GET /api/v1/vms` | `list_vms` | `vms:read` |
| Grant or replace permissions | `POST /api/v1/vms/grants` | `grant_vm_permissions` | `vms:edit` |
| Revoke permissions | `DELETE /api/v1/vms/grants/{grantId}` | `revoke_vm_permissions` | `vms:edit` |

- Register routes through the existing protected API architecture. REST and MCP share input validation, target verification, delegation checks, and state transitions. An authorized edit takes the existing grant ID and revision. Initial enrollment supports safe retries.
- Tests call both surfaces through the Worker and cover success, forbidden scopes, invalid or ambiguous inputs, cross-team targets, stale revisions, and immediate revocation. A VM with `vms:edit` can grant a narrower set through either surface.
- Document the routes, scopes, errors, grant snapshots, and workload authentication in `packages/docs/openapi.yaml` and the relevant product documentation. Regenerate the public client with `npm run generate` and verify the contract and package boundaries.

**Verification record**

- Targeted tests passed for Worker REST grant, list, edit, stale revision, and revoke, and for MCP list, grant, and revoke from VM principals. They also cover an excessive requested scope, an exact Machine mismatch, and reuse of an old token after enrollment under a new grant.
- `npm run generate`, the OpenAPI and API boundary checks, and documentation inventory and export validation passed.

### 6. Add the VMs page

- [x] Put **VMs** beside **Clients** in team navigation and support editing and revoking existing grants.

**Acceptance criteria**

- Show one row per active grant with the provider, VM identifier, and saved permissions. Show the preset name when available. A revoked grant disappears from the active list.
- A read-only user can list grants. A user with edit access can choose a preset or explicit scopes in **Edit permissions** and save against the current revision. A stale edit shows the conflict and refreshes the grant.
- **Revoke permissions** explains that the workload loses Factorize access and the VM keeps running. The page uses the generated `/api/v1` client and exposes actions for existing grants only.
- Browser tests verify navigation and the authenticated list, empty and error states, read-only access, edit, revision conflict, and revoke.

**Verification record**

- All three VM Playwright tests passed in the pinned runner. They verify navigation order, the read-only grant list, preset selection, conflict refresh, explicit scope edits, revoke confirmation, and empty and error states. The frontend type check passed.

### 7. Verify provider release controls and validate the full change

- [x] Verify the release controls and run the complete required local validation.

**Acceptance criteria**

- Automated tests assert that a provider without release evidence cannot enroll or authenticate a VM. A live smoke procedure documents how an agent can record evidence against explicitly authorized dedicated VMs. For each provider, it covers intended and peer VM authentication, clone and same-name replacement rejection, permission edit, and revocation through REST and MCP. For exe.dev it also covers rename, attachment movement, and a clone carrying the original guest key. Keep each provider disabled until its own live identity checks pass. Record unavailable live checks as pending.
- Run `npm run generate` before final validation. Generated artifacts match the OpenAPI contract. `npm run check:boundaries` and `git diff --check` pass, and the working tree contains only intended changes.
- On the documented runner, `npm run test:local` passes after the final code change. It applies the migrations to the isolated database and runs the complete root `npm test` suite. Record test counts, including the VM security and browser tests.

**Verification record**

- `npm run test:local` passed on the pinned runner after the final code change. All lanes passed, including 219 API tests across 50 files, 27 browser tests, both Worker runtime tests, both Worker dry runs, generated client and OpenAPI drift, and package boundaries. This includes 18 VM backend tests and three VM browser tests.
- `npm run generate`, documentation export generation, and `git diff --check` passed. A separate repeat of `npm ci` ran out of host disk space. The final test run reused the pinned runner checkout where `npm ci` had already passed with the unchanged lockfile, and applied the migrations to a fresh isolated PostgreSQL database.
- Fly.io live checks are pending dedicated test resources. exe.dev additionally needs documented machine-continuity evidence. Both production gates remain closed. The procedure and gate record are in [VM permissions validation](docs/vm-permissions-validation.md).

### 8. Publish the validated change

- [ ] Commit the implementation and completed checklist and push the validated commit to `origin/main`.

**Acceptance criteria**

- Every implementation criterion has a recorded result. The checklist records the status of each provider's live release gate.
- Reconcile with current `origin/main` and repeat full validation if the code changes during reconciliation. Preserve unrelated commits and use a normal push.
- Confirm the intended commit is present on `origin/main` after the push. Report the commit and validation results.
