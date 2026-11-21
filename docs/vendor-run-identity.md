# Vendor run identity verification

`packages/api/src/vendor-run-identity.ts` verifies signed OIDC identity tokens
against provider trust configuration and the run/VM association loaded by
Factorize. `VendorRunIdentityRepository` stores verified claim bindings in
PostgreSQL without storing JWTs. Each provider has one immutable VM, issuer,
subject, audience, and run binding; renewal can extend its validity window but
cannot change those values. VM and issuer/subject/audience uniqueness is
enforced across tenants. Revoked, expired, or inactive-run bindings are not
returned as active.
Issuer discovery is pinned to the documented exe.dev or Fly.io HTTPS origin;
the discovery response must repeat the configured issuer, and its JWKS URI
must stay on that vendor origin. The verifier never trusts URLs or keys
supplied by a guest.

The verifier allows only RS256 and ES256, validates the signature, exact issuer,
audience, configured subject, issue and expiry times, and active run. It binds
Fly identities to the signed `machine_id` claim. It binds exe.dev identities
to a server-side record of a unique WIF integration attached to the exact VM.
The exe.dev WIF subject is integration-scoped and is not treated as a VM ID.
Unknown key IDs trigger a JWKS refresh to support signing-key rotation; invalid
or expired tokens fail closed, so guests must renew with the vendor before the
token expires.

## Vendor evidence

* exe.dev's [GCP Workload Identity Federation guide](https://exe.dev/docs/integrations-gcp-wif.md)
  documents `--attach=vm:<name>`, integration-generated issuer and subject,
  short-lived OIDC tokens, a per-integration token endpoint reachable only by
  VMs to which the integration is attached, and HTTP 403 when the integration
  is not attached to the VM. Factorize must create and record a unique
  per-run integration attached to the run-owned VM. A team-wide or
  tag-attached integration does not establish an exclusive VM binding.
* Fly.io's [OIDC workload identity guide](https://fly.io/blog/oidc-cloud-roles/)
  documents signed machine tokens, a machine-specific `machine_id`, an
  organization-scoped issuer, short-lived tokens, and key publication. Factorize must
  pin the connected organization slug as issuer, the run audience, and the
  `org-slug:app-name:machine-name` subject and compare the signed machine ID to the
  provisioned machine.

`packages/api/src/vendor-run-token-sources.ts` implements the documented guest
token requests: exe.dev WIF `GET https://<integration>.int.exe.xyz/token` and
Fly `POST http://localhost/v1/tokens/oidc` through the Machine's
`/.fly/api` Unix socket with the configured `aud`. Provisioning creates a
uniquely named exe.dev WIF integration attached only to the run VM, reads its
issuer and subject back from the provider inventory, and verifies the returned
token before starting the job. Fly provisioning verifies its token against the
configured app issuer and the returned Machine ID. The scheduler persists only
verified claim bindings. Active VM polls renew through the same token source,
verifier, active-run check, and immutable repository update; provider cleanup
removes the per-run exe.dev integration after verifying its VM attachment.

Focused backend tests use deterministic token and provider response fixtures,
and the PostgreSQL repository tests cover immutable renewal, revocation,
expiry, duplicate bindings, and inactive runs. They do not establish live
vendor behavior. On 2026-11-17 the verifier accepted real exe.dev and Fly signed tokens using
live vendor discovery and JWKS, and rejected wrong VM, subject, issuer, audience,
and inactive-run bindings. Fly renewal was verified with a second live token.
exe.dev's WIF integration was attached only to `expressway-by-scraper`; an
unattached validation VM received HTTP 403 from its token endpoint. The local
run binding in these checks was explicit test input, not a production run or an
end-to-end backend proxy session. See [the completion ledger](gen-2922-progress.md)
for the remaining runtime and cutover gates. The existing proxy admission and
proxy identity remain outside this verification evidence.


## Backend request authentication

A VM can call the existing `/api/v1` and `/mcp` boundaries with a fresh vendor
JWT in `Authorization: Bearer ...` and its provisioned UUID in
`X-Factorize-Run-Id`. The UUID is only a lookup hint: Factorize reads the tenant,
owner/session binding, immutable vendor/VM binding and scope snapshot from its
database. It verifies the signature and exact stored issuer, subject, audience
and VM for every request. A vendor token alone grants no access. An invalid
run-identity request cannot fall back to another authentication method.

Admission requires both execution records to remain starting/running/blocked,
an unrevoked binding, a matching persisted execution handle, and a connected
execution provider. exe.dev additionally rechecks its exclusive WIF attachment
through provider inventory on every admission. Fly pins the connected
organization slug and app/Machine association. Job edits cannot broaden the
active run's API scopes; an empty scope snapshot remains empty. A run with
`jobs:write` cannot grant itself new invocation destinations.

This request path is implemented alongside the old launch/runtime path while
GEN-2922 remains in progress. Guest setup still needs to adopt it, and old run
bearer authentication must be removed during the breaking cutover. It is not
completion or release evidence for that cutover.

## Backend outbound protocol

`/internal/run-proxy/<run UUID>/integrations/<selected credential UUID>/...`
and `/internal/run-proxy/<run UUID>/providers/{github/<installation ID>,linear,model/v1}/...`
are raw outbound protocol routes authenticated by the same fresh vendor JWT and
run header. They do not expose a credential-delivery JSON API. The Worker looks
up only that run's selected credential and current tenant-owned connection.
Custom bearer origins remain fixed to a public HTTPS origin; redirects are
rejected. The deployment retains Cloudflare's documented
[`global_fetch_strictly_public`](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#global-fetch-strictly-public)
flag, so outbound fetches cannot use private zone-origin routing. Request and
response body limits and a total deadline bound streaming forwarding.

GitHub uses the existing selected App installation: REST/GraphQL uses Bearer;
Git smart HTTP uses Basic `x-access-token` and preserves `Git-Protocol` and pack
bodies. Explicit `/raw/` and `/archive/` suffixes route to the corresponding fixed
GitHub content hosts. The implementation follows the protocol distinctions in
[Clawflare's GitHub handler](https://github.com/asselstine/clawflare/blob/main/packages/github/src/index.ts).
Linear uses the existing selected connection and its existing token refresh.

Selected model accounts are resolved from managed encrypted storage. ChatGPT
refresh follows [Codex's published OAuth refresh implementation](https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/manager.rs),
restricted to its trusted authority/client. Refresh is serialized and persisted
under database locks across backend instances; failed refresh cannot use an
expired token. API key model accounts use OpenAI's API origin. Upstream tokens,
refresh tokens and model caches never cross the guest boundary.

Disconnect/suspension records a durable revocation for existing selected runs.
Reconnecting a provider slot or reusing a deleted credential UUID cannot restore
an old grant. Execution-connection disconnection also revokes its VM identity
bindings. Newly created runs can use explicitly selected reconnected credentials.
These guarantees currently apply to the new backend request path; the legacy
runtime and its bypasses still need removal before release.


## Renewable external VM grants

External session proxy grants reuse `discoverVendorIssuerTrust` and `verifyVendorMachineIdentity` without pretending to be managed runs. `vm-grant-providers.ts` supplies verified provider inventory bindings: exe.dev uses its exclusive WIF attachment; Fly uses the connected organization, selected app, exact Machine ID and inventory-derived subject. Fly enrollment reuses `acquireFlyMachineOidcToken` and `createFlyHttpGuestTransport`. A separate guest-local proof is hashed and pinned; only the hash and verified claim metadata are stored. Guests receive neither control-plane credentials nor client OAuth tokens.

The additive `0093_fly_vm_grants` migration stores an optional app on grants; existing exe.dev rows and expirations are preserved. Creation grants one hour independently of the current client token expiry. Explicit REST/MCP renewal requires the same active parent authorization and all currently authorized provider/selected integration epochs; expired or revoked grants cannot be revived. Ordinary proxy traffic, provider-token renewal and client-token refresh do not extend this lease. Every guest proxy call verifies its signed identity and current delegation policy. Cleanup removes exe.dev grant identity attachments and marks Fly grants clean without stopping or deleting Machines.

Deterministic local Worker/OAuth fixtures in `scripts/agent-api-runtime.test.mjs` exercise both providers with real signed JWTs, including Fly Unix-socket token acquisition, wrong issuer/subject/machine/audience/proof/signature rejection, refreshed-parent renewal, expiry, revocation and cleanup. These are local protocol and authorization evidence, not new live-provider acceptance claims.
