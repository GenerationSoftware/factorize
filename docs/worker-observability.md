# Factorize Worker observability

In Cloudflare, open **Workers & Pages → factorize → Observability**. Look for
`event = integration_failure`. When an AWS or Hetzner setup error shows a
request ID, use that exact value to filter `requestId` in the logs. The same
value is sent in the REST response's optional `X-Request-Id` header; it is a
server-generated support reference, not a credential. No error codes, response
bodies, or authorization rules change.

The event fields are provider, operation, reason, duration in milliseconds,
and (when known) an upstream HTTP status. A bad Hetzner token or AWS trust/IAM
denial is a warning, not an operator error. AWS list calls with an unavailable
issuer are warnings so that visiting Settings does not produce an app error.
Unexpected inventory failures, failed AWS setup due to deployment configuration,
and incomplete AWS verification are operator errors. Cloudflare Issues groups
production failures; use its dashboard to set notifications for new or recurring
issues, with a threshold appropriate to traffic. No notification destination is
configured by this repository.

The Worker configuration retains application logs and enables Issues and source
map upload. Automatic invocation logs and tracing are off, and Cloudflare query
string redaction is explicitly enabled. Check issue context with synthetic input
before sending any notifications outside Cloudflare. Full URLs or query
strings can include OAuth codes, signed URLs, and customer inputs. Do not enable
them until collection and redaction are verified. Never add raw request data,
provider errors, credentials, or AWS scripts to application telemetry.

After production deploy the workflow checks the AWS OIDC discovery and JWKS
over HTTPS. It rejects unexpected endpoints and unusable or non-public keys.
It does not create an AWS role, assume one, or prove STS works. Missing
discovery initially warns because AWS signing is optional. After configuring
the production Worker signing key and verifying the smoke check succeeds, set
the production GitHub Actions variable `FACTORIZE_REQUIRE_AWS_ISSUER` to
`true` so a future missing issuer fails the deployment check. Neither logs nor
this check configure the AWS signing key.
