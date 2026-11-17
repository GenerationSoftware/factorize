# GEN-2922 completion ledger

Implementation complete on PR #404 (`codex/gen-2922-vendor-identity`). Final
application code is `cc5ae0e`; the subsequent ledger commit changes documentation
only. Production has not been deployed or migrated. Review and the documented
maintenance/cutover gates remain release responsibilities.

## Acceptance checklist

- [x] exe.dev and Fly vendor signature, issuer, audience, lifetime and exact
  provisioned VM/run verification; immutable tenant/run bindings, renewal and
  signing-key rotation; no Factorize-issued VM bearer fallback.
- [x] Real vendor tokens and live guest/helper/backend checks for both vendors;
  actual evidence is separated from fixtures below.
- [x] Token-free owner/session/API-scope snapshot and immutable selected credential
  IDs; job edits do not broaden existing runs, including empty-scope runs.
- [x] Backend API/MCP and outbound admission use current vendor identity and run
  eligibility. Cancellation/terminal state denies normal access immediately.
  Stopping artifact finalization requires an additional signed upload grant.
- [x] Server-encrypted bearer/model storage, write-only secret input, safe metadata,
  owner-only ChatGPT device authorization and API-key replacement. Server-side
  refresh is serialized, persisted and checked against disconnect/rotation.
- [x] Existing GitHub App and Linear connections reused without new upstream
  permission layers. Only explicit tenant/run selections authorize forwarding.
- [x] Streaming backend proxy: GitHub REST/GraphQL Bearer, smart HTTP Basic,
  raw/archive routes, Linear, custom HTTPS origins and model streaming.
- [x] Durable per-run disconnect revocation; reconnect cannot revive old grants.
- [x] Runtime provisioning, exclusive exe.dev WIF attachment checks, guest discovery,
  localhost helper, Worker-compatible Fly guest exec, cancellation and cleanup.
- [x] Standalone proxy workspace/image, certificate tunnel, pairing/control/enrollment,
  guest bearer, unlock API/UI, browser capabilities and obsolete dependencies removed.
- [x] Guarded migration 0052 and operator preparation; drain all runs, retain managed
  records and execution connections/configuration, tombstone unreadable inner
  ciphertext, disable affected jobs without silently altering selections.
- [x] Job repair UI and DB/browser behavior tests; missing selections remain explicit
  until the owner replaces/removes them and starts a newly authorized run.
- [x] OpenAPI/client generation, API namespace and package boundaries, user/operator
  documentation, release/rollback gates and superseded work reconciled.
- [x] Complete required root validation after the final application code change.

## Deterministic evidence

The complete root suite on `cc5ae0e` passed with Node 24.12.0 and npm 11.19.0
on the isolated exe.dev validation VM, using the documented immutable runner
image and `npm ci`. `npm run test:local` bootstrapped only its isolated local
PostgreSQL database and ran the root `npm test` suite:

- Backend: 104 files, 670 tests passed, five intentionally skipped; generated
  contract drift, boundaries, docs, app build and Worker dry-run passed.
- Compiled static app/API/PostgreSQL integration: two tests passed.
- Functional Chromium: six tests passed. Browser unit checks: 94 passed, one skipped.
- Process cancellation/deadline checks: four passed. Backend protocol/guest/signature
  checks: 30 passed. Docker lifecycle/infrastructure E2E: both tests passed.

Behavioral fixtures cover cross-tenant/unselected denial, identity errors and
VM/run mismatches, signing-key rotation, immutable scopes, restart/renewal,
termination/cancellation, owner session revocation, provider connection reuse,
permanent disconnect/reconnect denial, Git API/smart-HTTP authentication and
headers, streaming, model refresh concurrency/persistence and repairability.
Device authorization fixtures cover encrypted challenges, polling limits, PKCE,
expiration/cancel and replacement/disconnect without credential disclosure.

The image smoke ran through the image's existing login profile and launches a
non-login exedev Chromium process. SSH itself does not inherit the OCI browser
path. This does not close GEN-2889's separate requirement that Factorize job
processes inherit the image environment; no unrelated runner-image gate is claimed.

## Earlier live vendor primitives — 2026-11-17

Real Fly RS256 JWTs from `/.fly/api` were verified against live discovery/JWKS:
organization `brendan-asselstine`, isolated app
`factorize-gen2922-identity-20261117`, Machine `811112ea04e618`. The issuer uses
the organization slug, not its display name or app name. A renewed token passed;
wrong issuer, audience, subject, VM and inactive run bindings were rejected.

Real exe.dev WIF tokens from a uniquely attached test integration were verified
against live discovery/JWKS at `https://exe.dev/issuer/kilo-extra-sun`. An
unattached validation VM received HTTP 403. The integration subject was not
assumed to identify a VM; exclusive vendor attachment supplied that binding.
Wrong issuer/audience/subject/VM and inactive run bindings were rejected.
Temporary primitive-test resources were removed.

## Live guest/backend verification — completed 2026-11-17

These checks provisioned real guests through the production execution backend
classes, persisted verified bindings and token-free scope snapshots in isolated
PostgreSQL databases, and served the actual Worker request handlers through a
temporary exe.dev HTTPS relay. The attached Reflection integrations supplied
control-plane authentication through test-only transport rewriting. No fixture
JWT key, identity verifier bypass or production tenant was used. This is live
VM/helper/backend protocol evidence; the full scheduler/artifact lifecycle is
separately exercised by Docker/DB fixtures, not claimed as a production deployment.

- exe.dev: run `f80bf764-a2a9-4438-a369-7b560954a4b6`, VM
  `factorize-f80bf764-a2a9-4438-a369-7b560954a4b6`. Its exclusively attached
  per-run WIF integration was checked against actual vendor inventory, and
  signatures against actual issuer discovery/JWKS. The guest saw vendor identity
  and an empty scope snapshot, received 403 for jobs API access and an unselected
  credential, and used its selected backend egress to an actual public HTTPS
  status endpoint. Changing the run to stopping made runtime-context return 401.
- Fly: run `9f6249bc-948a-4125-bbe0-e3aaae36b40a`, Machine `86ed0ece491768`,
  isolated app `fz-gen2922-live-9f6249bc`, organization `brendan-asselstine`.
  The real guest Unix-socket JWT was verified and durably bound to the exact
  Machine/run. The same empty-scope, unselected credential, selected HTTPS
  egress and stopping/401 checks passed through the guest helper and backend.
- Egress used a synthetic bearer and `https://httpbin.org/status/200`; the
  service returned only status, not echoed credentials. This proves live
  routing, not authentication to a real GitHub, Linear or model account.
  Credential injection, Git protocols, model streaming/refresh and permanent
  disconnect revocation remain explicitly deterministic fixture evidence.
- Both test guests, all temporary Fly apps/Machines and run WIF integrations
  were removed and absence verified. The relay was stopped, its VM returned to
  private visibility, and the development tunnels removed. The isolated
  validation VM is removed after final validation completes.

Live testing found a Fly startup assumption that fixtures had missed: an
immediate start of a paused/created Machine returned 412. The final backend
uses the documented default base-image boot with a sleeping init process,
bounded three-minute readiness polling and one explicit start only for
stopped/suspended Machines. No job payload is delivered until vendor verification.
Unknown/ambiguous start results are not repeated. Never-started Machines can
be deleted without an invalid stop request. Focused readiness/lifecycle tests
pass, and the live Fly guest passed with this final startup behavior.

## Superseded work and release

GEN-2824's user-unlocked separate proxy architecture, GEN-2892's boot/control
enrollment (already canceled), and GEN-2826's browser pairing decision are
superseded. GEN-2921's Docker validation intent is retained through the new
backend/identity lifecycle E2E. No unrelated Linear issues were closed.

The concrete operator plan/apply script and migration regression tests validate
credential classification, preparation gating, encrypted managed preservation,
unchanged execution connections and unchanged selections on disabled jobs.
See `packages/docs/self-hosting/credential-cutover.mdx` before deployment.
Migration 0052 is breaking; the old release cannot operate against its removed
tables. No production cutover or upstream model consent was performed here.
