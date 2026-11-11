# GEN-2826: Browser to credential proxy HTTPS and identity pairing

## Decision

Provision one credential proxy for the Factorize owner. Factorize trusts the new proxy identity while provisioning it and stores an immutable pairing tuple: Factorize proxy ID, Fly app/Machine identity, canonical public HTTPS origin, and the proxy SSH host public-key fingerprint. Store an identity generation with the tuple. The canonical origin is the Fly app's `*.fly.dev` name for the initial deployment; a customer domain can be added later only after its DNS ownership and Fly certificate are validated. Do not discover or silently adopt a new origin or host key at runtime.

### HTTPS route and certificate ownership

Use the proxy's public Fly app hostname as the browser URL. Fly Proxy accepts HTTPS on port 443 and performs its documented built-in TLS termination at the edge; route the decrypted request to the credential-proxy service on a private Fly network listener. The guest listener is reachable only through the app's Fly service and does not expose a public HTTP port. This explicitly trusts Fly's TLS termination and private-network boundary; browser TLS does not continue to the guest. The browser still gets normal Web PKI hostname and chain validation for the Fly app hostname.

For a later customer hostname, its owner controls DNS and authorizes Fly's certificate issuance. Attach it with documented `fly certs add <hostname>` and publish the DNS challenge/records Fly reports; verify it with `fly certs check <hostname>` before making it the canonical origin. Fly provisions and renews the edge certificate. Do not issue a production certificate or deploy as part of this proof. The fixture uses a local self-signed certificate, so a live domain, production DNS, and ACME issuance remain deployment prerequisites, not test prerequisites. References: [Fly custom domains](https://fly.io/docs/networking/custom-domain/) and [Fly TLS support](https://fly.io/docs/networking/tls/).

### Browser unlock capability and CORS

After normal Factorize owner authentication and CSRF/origin checks, Factorize returns a short-lived (60 seconds maximum), one-use Ed25519-signed capability for `POST /unlock`. Its signed claims contain issuer, audience equal to the paired proxy ID, action, owner ID, pairing generation, exact Factorize web origin, expiry, and random `jti`. The proxy has the Factorize verification public key; the signing private key never goes to Fly. The browser calls the canonical proxy HTTPS origin directly and sends this capability in `Authorization` plus the unlock key in the JSON body. The Factorize endpoint receives no unlock key and returns only the capability/status metadata. The proxy consumes `jti` atomically, rejects expired, replayed, wrong-audience, wrong-action, or stale-generation capabilities, and keeps the unlock key only in process memory.

On the proxy, require a non-null `Origin` exactly equal to the Factorize app origin for both preflight and actual requests. Allow only `POST`, `Content-Type`, and `Authorization`; answer a valid preflight with that one origin and `Vary: Origin`. Reject foreign/missing origins and invalid preflights without CORS permission. Never use `*`, reflect an arbitrary origin, allow credentialed cookies, or treat CORS as authentication; the capability is mandatory even for an allowed origin. Do not log request bodies, authorization, or unlock material. Bound the request body and reject redirects at the browser client.

### Identity binding and replacement

Browsers cannot directly pin or inspect the agent's SSH host key. The browser authenticates the HTTPS hostname and certificate through Web PKI, then authenticates the proxy's logical identity by requiring the Factorize-signed capability audience and generation to match the already paired proxy. Factorize's provisioning record binds that logical proxy ID to its Fly app/Machine and SSH host fingerprint. Enrollment authorization delivered to an agent names the same proxy ID, Fly identity, generation, and SSH fingerprint; the agent's SSH client verifies the fingerprint before its one authenticated, restricted integration-transport connection. Thus HTTPS identity and SSH identity meet at the Factorize-trusted pairing tuple, not by pretending the browser validates SSH.

Unexpected app/Machine identity, hostname, certificate origin, generation, or SSH fingerprint changes fail closed and revoke outstanding capabilities/enrollments. Recovery requires an authenticated owner to review and explicitly approve the proposed replacement identity in Factorize. Approval increments the pairing generation, replaces the tuple, and invalidates prior capabilities and enrollments; it is never inferred from DNS, a new TLS certificate for the same hostname, a restarted Machine, or a successful SSH connection. A stable proxy identity may persist across stop/restart. The unlock key and decrypted credentials never persist across process restart.

## Proof fixture

`packages/app/test/https-pairing.browser.test.mjs` starts local HTTPS origins with the test-only localhost certificate and a mock Factorize capability issuer. Chromium verifies allowed-origin unlock, foreign-origin preflight denial, expired and wrong-proxy capability rejection, identity replacement rejection until explicit approval, and that the Factorize backend never receives the unlock body. It uses ephemeral ports and closes browser/server resources. Run it with `npm run test --workspace=factorize-app`.

This is a protocol/decision proof, not a production proxy implementation or live Fly certificate check. A production implementation must keep its Fly service/private listener and certificate configuration consistent with the termination boundary above.
