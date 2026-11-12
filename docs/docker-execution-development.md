# Local Docker execution and credential-proxy E2E

Docker is a test-only execution infrastructure adapter. Application jobs select
`executionConfigId: "docker"` only when the local API has an explicit
`TEST_DOCKER_EXECUTION` configuration. Deployed Workers do not configure it,
do not list Docker, and reject that selection. Docker supports code jobs only.

## Prerequisites and commands

Use Node 24.12.0 and npm 11.19.0, PostgreSQL, Chromium and Docker with Linux
container/bridge-network permissions. For an exe.dev VM use the pinned validation
runner described in [factorize-validation-runner.md](factorize-validation-runner.md).
Docker is an additional host prerequisite: verify `docker info` succeeds. Missing
prerequisites fail validation rather than skipping coverage.

```sh
npm ci
npm run bootstrap:test
# Export DATABASE_URL, AUTH_TEST_DATABASE_URL and QUEUE_TEST_DATABASE_URL printed above.
npm run test:docker
npm test
```

The focused command builds the deployable credential-proxy Dockerfile and a small
code-job fixture image with cached Docker layers. Initial builds require registry
and Debian/npm download access; subsequent runs reuse layers. No image publication,
Fly token, model account or external API credential is needed. The command resolves
locally built images to immutable Docker image IDs and uses those exact IDs for
provisioning. Keep several GiB free for images/build cache.

For a separate local PostgreSQL container, bind its port to loopback and supply
`VALIDATION_DATABASE_URL` and `VALIDATION_DATABASE_ADMIN_URL` to bootstrap. Include
`?sslmode=disable` for a local server without TLS. Both URLs must use localhost or
127.0.0.1; never use a shared or production database.

The complete scenario has a 120-second test deadline after image preparation;
the host subprocess also has a deadline. Root validation includes this command
and allows 760 seconds for the complete suite.

## Shared host boundary

`MachineJobExecutionBackend` implements reservation/recovery, launch sequencing,
run-credential delivery, guest-generated keys/CSR enrollment, shared launcher and
mTLS tunnel installation, result/log/file collection and shutdown. The Fly wrapper
retains existing Fly handles and identities. Docker implements container lifecycle,
operation labels, private stdin execution and bounded file transfer. Host Docker
access is never mounted into the proxy or job.

`createLocalExecutionRunner` drives the real PostgreSQL scheduler in Node, with a
public provider factory used consistently for launch, polling and cleanup.
`createLocalArtifactStorage` supplies local artifact persistence. The local HTTPS
server passes requests to the application's real Fetch handler. The E2E provides
only Node replacements for unavailable Cloudflare platform classes; it does not
mock backend or scheduler methods. Production Fly execution-host deployment is
outside this issue's scope.

The owner-session `/api/v1/credential-proxy/setup` operation calls the configured
execution host and completes real proxy registration. Browser capabilities for
unlock/lock/apply/status are one-use, valid for 60 seconds and bound to owner,
action, application origin and proxy boot. Unlock keys go directly to the proxy,
which verifies the current encrypted generation before admitting access. Factorize
never accepts plaintext unlock keys through these application endpoints.

## Evidence and limits

The scenario creates its own migrated database, owner identity, HTTPS CA and
synthetic credentials. Jobs, encrypted integrations, verification records, grants
and runs are created/updated through authenticated application APIs. Provisioning
uses the shared one-use bootstrap and real control/enrollment endpoints.

The job and fake API occupy separate networks; only the proxy joins both. The fake
API has no published port. Saved code proves direct TCP access fails and proxy
access succeeds, discovers its granted integration, validates a unique response,
and writes a correlated structured result and output. Independent fixture receipts
verify the injected bearer credential, method, path and body. Locked access and a
saved but ungranted integration produce no additional upstream receipt.

Container inspection, observed guest stdin, installed files, logs and stored
artifacts are checked for upstream/run credential leakage. Results/logs are
persisted and the scheduler destroys the job container before the teardown's
cleanup runs. The built proxy image exercises its actual entry points, OpenSSL,
writable runtime directories and memory-backed TLS storage; it stays healthy
beyond the former two-second startup deadline and shuts down normally.

The test-only exact-origin transport requires NODE_ENV=test plus an explicit test
configuration. It pins the fixture IP, origin and CA while retaining TLS hostname
and certificate verification. Production destination policy continues to reject
private IPs. This does not validate live Fly authentication, networking or exec/SFTP.

## Cleanup and recovery

The command uses unique `fz-*` namespaces, ephemeral ports and isolated
`docker_e2e_*` databases. Both fixture teardown and outer process cleanup cover
failures/signals. After a hard host termination, inspect:

```sh
docker ps -a --filter label=sh.factorize.test.namespace
docker network ls --filter name=fz-
```

Remove only containers/networks whose labels/names match the interrupted run.
Stop its runner before dropping its exact `docker_e2e_*` database. Cached test
images remain deliberately for reuse; remove only the Factorize test image tags
or their known build-cache entries when reclaiming space.

The narrower infrastructure check remains available:

```sh
docker pull alpine:3.22
npm exec --workspace=factorize -- vitest run --config scripts/docker-infrastructure.config.ts
```
