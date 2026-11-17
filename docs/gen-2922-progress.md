# GEN-2922 completion ledger

Continue on PR #404 (`codex/gen-2922-vendor-identity`). Do not mark the issue
complete or release the breaking change until every remaining gate passes.

## Current implementation

- [x] Vendor JWT signature, issuer, audience, lifetime, VM and run binding primitives;
  immutable PostgreSQL bindings and renewal/revocation fixtures.
- [x] Managed bearer/model storage, selected existing GitHub/Linear connections,
  provider/model forwarding and scope snapshot fixtures in the preceding PR commits.
- [x] Correct Fly issuer and subject configuration to use the connected organization
  **slug**, independently of the app name and organization display name. Apply the
  same pinned issuer/subject on launch and renewal.
- [x] Reject redirects and bound discovery/JWKS fetches to ten seconds.
- [x] Live vendor signature verification described below.
- [x] Vendor identity authentication at the existing backend API/MCP boundary,
  with fixture coverage for scope snapshots, eligibility/revocation, invocation
  permissions, invalid tokens and fresh exe.dev attachment checks.
- [ ] Adopt vendor authentication in guest/runtime setup and outbound forwarding.
  Current run bearer credentials and standalone proxy admission still exist.
- [ ] Move outbound forwarding and model authentication/refresh into the backend.
- [ ] Replace runtime provisioning, guest discovery/client setup and scheduler gates.
- [ ] Remove standalone proxy/pairing/unlock API, UI, configuration and dependencies.
- [ ] Implement and test the documented breaking migration and job repair behavior.
- [ ] Reconcile operator/user docs, superseded work, and deployment/release gates.
- [ ] End-to-end live vendor/run/proxy evidence and final complete root validation.

## Live vendor evidence — 2026-11-17

These checks used real vendor-signed tokens and vendor discovery/JWKS with the
repository verifier. They used an explicit local test run binding, so they do
not prove production run eligibility, persistence, forwarding, disconnection or
cancellation. JWTs and credentials are intentionally absent from this record.

Fly isolated app `factorize-gen2922-identity-20261117`, Machine `811112ea04e618`
(`vendor-identity-check`), organization slug `brendan-asselstine`:

- Token obtained through the documented `/.fly/api` Unix socket and
  `POST /v1/tokens/oidc`, for the explicit test run audience.
- Live issuer was `https://oidc.fly.io/brendan-asselstine`; subject was
  `brendan-asselstine:factorize-gen2922-identity-20261117:vendor-identity-check`.
  This exposed and corrected the previous app-issuer/display-name assumptions.
- RS256 signature verified using live discovery and JWKS. A second token renewed
  the same VM binding. Wrong issuer, audience, subject, Machine and inactive run
  were rejected against the real token.
- Test app and Machine deleted; subsequent org inventory contained zero apps.

exe.dev unique WIF integration `fz-gen2922-live-check`, directly attached only
to `expressway-by-scraper` with a one-hour grant:

- Live inventory showed a single VM attachment, generated issuer
  `https://exe.dev/issuer/kilo-extra-sun`, and an integration-scoped subject.
- Token obtained from the documented integration `/token` endpoint; RS256
  signature verified against live discovery/JWKS. Wrong issuer, audience,
  subject, VM and inactive run were rejected.
- The unattached VM `factorize-gen2922-validation` received HTTP 403 from that
  endpoint. No assumption was made that the WIF subject itself identifies a VM.
- Temporary WIF integration removed after the test. The isolated validation VM
  is retained while implementation and required local validation continue.

Signing-key rotation, database revocation, terminal/canceled runs, cross-tenant
isolation and provider requests remain deterministic fixture evidence until the
backend cutover permits an end-to-end live test.

## Validation

Node 24.12.0 / npm 11.19.0; clean `npm ci` passed. Focused vendor identity and
Fly backend suites: 32 tests passed. Root local validation on the development VM
stopped before tests because its PostgreSQL password does not match the runner
configuration. No host repair was attempted. A new isolated exe.dev VM is booted
from the documented immutable validation-runner image for the required suite.


The complete root suite at `47ccf62` passed on a fresh exe.dev VM using the
pinned validation image: backend, static slice, functional/browser unit, proxy,
and Docker E2E lanes all passed. SSH does not inherit the OCI browser-path
environment; the image's existing login profile supplies it. The image smoke
was run through a root login shell (and itself launches a non-login `exedev`
Chromium process), and validation through an `exedev` login shell. This is not
evidence that non-login Factorize job processes inherit OCI environment on
exe.dev; that separate runner-image gate remains unchanged.

The request-admission fixture suite adds five PostgreSQL/Worker tests and
passed in the isolated validation VM. Complete validation of that follow-up
commit is pending.
