---
name: manage-environments
description: Use Factorize reflection and integration proxies to manage exe.dev and Fly.io VMs and renewable delegated proxy access.
---
# Manage environments and access

## Reflect first

Call `get_api_reflection({})` before using integrations or a workspace. It describes the authenticated identity, application `scopes`, `agentHost`, verified `current_vm` (if any), proxy instructions, and integration IDs, kinds, names, availability, access states, required consent scopes and request examples. Reflection is live discovery, not a credential health check. Do not cache IDs/permissions into these built-in instructions or invent service endpoints.

An integration can be granted, requestable or unavailable. Use granted access; requestable access needs consent in the client/browser using the returned scope. Do not construct integration scope strings or claim unavailable access succeeded. Account/credential setup belongs in the Factorize browser UI. Never expose or copy upstream credentials into model context or guests.

Use `request_api` with the returned integration ID, HTTP method, relative path, safe headers and body. Factorize injects credentials and selects the origin. OAuth proxy calls require `proxy:use`; access is bounded by integration policy and upstream permissions. Distinguish a local authorization error from an upstream non-2xx response. For retained results, use `query_api_response` or `read_api_response` and pagination/byte offsets rather than loading unlimited output. For durable HTTP operations, use `get_api_operation`/`read_api_operation`; polling does not repeat the original write.

## Use supported VMs

Provider calls go through `request_api` with the reflected provider integration. Read its instructions and the documented provider command/API schemas before writes. Use returned names and IDs, check readiness and avoid blindly repeating a create after a lost response.

- exe.dev: POST `/exec`, headers `{"Content-Type":"text/plain"}`, command in `body`. List with `ls --json`, create with documented `new` options (consult `help new`), and run a guest command with documented `ssh VM COMMAND`. Use `list_exe_connections` for safe saved connection metadata. Follow https://exe.dev/docs.md; undocumented local endpoints are unsupported.
- Fly.io: use Machines API paths. GET `/v1/apps?org_slug=CONNECTED_ORG`, GET `/v1/apps/APP/machines`, POST `/v1/apps/APP/machines` with the documented image/configuration, POST `/v1/apps/APP/machines/MACHINE/start`, and POST `/v1/apps/APP/machines/MACHINE/exec` with a JSON command array. Inspect the exact app/machine and state before acting. Follow https://fly.io/docs/machines/api/ and its resource references.

Managed runs provision an exe.dev/Fly.io workspace from their VM preset. Within a managed run, inspect `current_vm` and use `vm_exec({"command":"pwd"})`; this tool only executes in the server-bound current workspace, not an arbitrary conversation VM. Launching an external VM does not attach it as a managed run's workspace.

## Grant the conversation's proxy access to a VM

`grant_vm` delegates selected integration access from the current OAuth connection. It requires `vm:grant`, `proxy:use`, provider access and access to every selected integration. Only providers advertised with `vmGrantProvider` support it. For exe.dev:

```json
{"providerIntegrationId":"PROVIDER_UUID","vm":"RETURNED_VM_NAME","integrationIds":["SELECTED_INTEGRATION_UUID"],"idempotencyKey":"UNIQUE_GRANT_INTENT"}
```

For Fly.io, use the Machine ID as `vm` and also supply `app` from the provider inventory. Reuse the same idempotency key only for retries of the same grant request. Access is limited to the explicit subset; granting a VM never gives it the entire team catalog or the client's OAuth token.

Follow the receipt's provider-specific token acquisition and proof-file instructions inside the VM. exe.dev uses its exclusive WIF integration token endpoint; Fly obtains a short-lived OIDC token using its `/.fly/api` Unix socket and the receipt's audience. Factorize verifies provider-signed identity bound to that exact VM. The guest calls the receipt's HTTP proxy URLs with its identity token, `X-Factorize-VM-Grant` and `X-Factorize-VM-Proof`. A grant authorizes proxy operations, not general Factorize application tools. Renew the provider OIDC token when necessary; this is separate from renewing the Factorize grant.

## Renew, revoke and clean up

New grants last one hour. Record `grantId` and `expiresAt`. Call `renew_vm_grant({"grantId":"RETURNED_GRANT_UUID"})` before expiry when continued access is needed. Each explicit renewal grants one hour from that operation and rechecks the same parent OAuth connection's current access. Merely refreshing the client's token, using the proxy, or retrying grant creation does not extend the lease. Expired/revoked grants require a new grant and idempotency key.

`revoke_vm_grant` ends delegated access. Parent authorization revocation, integration disconnection or permission removal also blocks affected access. Timeout/revocation leaves the VM running; delete provider resources separately only when intended. Verify requests are rejected after revocation. Provider-native integrations are independent of this grant. A client cannot infer that closing a conversation revoked an OAuth connection: explicitly revoke grants when work ends or let their leases expire.
