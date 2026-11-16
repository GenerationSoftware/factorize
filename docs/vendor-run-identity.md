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
  app-scoped issuer, short-lived tokens, and key publication. Factorize must
  pin the app issuer/audience and compare the signed machine ID to the
  provisioned machine.

`packages/api/src/vendor-run-token-sources.ts` implements the documented guest
token requests: exe.dev WIF `GET https://<integration>.int.exe.xyz/token` and
Fly `POST http://localhost/v1/tokens/oidc` through the Machine's
`/.fly/api` Unix socket with the configured `aud`. Renewal repeats the provider
request and must pass the same verifier and immutable binding. Focused source
tests use deterministic response fixtures; they do not establish live vendor
behavior.

The token sources are not yet invoked by execution provisioning, and verified
identities are not yet persisted from a launch. This branch therefore remains
an incomplete implementation checkpoint, not an admission path. Proxy
admission and replacement of the existing proxy identity are later milestones
and must not use a shared-secret fallback.
