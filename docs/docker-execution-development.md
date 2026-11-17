# Local Docker execution validation

Use the pinned Factorize validation runner documented in
[factorize-validation-runner.md](factorize-validation-runner.md). Run `npm ci`,
then `npm run test:local` for the required complete suite. For focused iteration,
bootstrap the isolated local database and run `npm run test:docker` with the
printed variables. Remote/shared databases are refused.

The Docker lane builds only the isolated code-job fixture image. It executes a
saved job through the real API, scheduler, Fly lifecycle backend, job launcher,
localhost identity helper, signed JWT verifier, selected backend egress,
artifact persistence and provider cleanup. A test-local Unix-socket issuer
supplies synthetic Fly-shaped JWTs and fixture JWKS. This is deterministic
protocol evidence, not live Fly identity evidence. No production verifier
fallback or fixture key is installed by application code.

The test also checks an unselected credential, permanent disconnect revocation,
credential-free guest configuration, stored results and cleanup after artifact
collection. Docker resource labels, isolated database names, bounded process
trees and independent fallback cleanup keep failures local to this invocation.
The separate infrastructure test covers idempotent creation and guest transport.

The standalone proxy image and owner proxy/unlock setup API have been removed.
`TEST_DOCKER_EXECUTION` exposes only an explicitly enabled test execution target;
production execution uses documented exe.dev or Fly identity and provisioning.
