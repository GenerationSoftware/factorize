# Fly guest command and file transport

`createFlyGuestTransport` in `packages/api/src/fly-guest-transport.ts` uses the documented `fly machine exec` and `fly sftp put/get` commands. It starts Fly CLI directly with an argument vector; guest command arguments and paths are never interpolated into a shell command. The Fly API token is supplied through the CLI's `FLY_API_TOKEN` environment variable and is not included in arguments, results, or transport errors.

The execution host must have a supported `fly` CLI installed and access to the selected Fly app and Machine. The token must authorize Machine execution and SFTP access. Machines must be running. The guest image must support Fly's Machine exec and SFTP paths; images do not need exe.dev's SSH tooling or systemd. `run()` accepts a nonempty executable and argv plus optional stdin bytes, returns captured stdout/stderr and the process exit code, and enforces a deadline of at most ten minutes and a combined output cap of at most 16 MiB. File operations enforce a configurable transfer cap of at most 64 MiB and use normalized absolute guest paths. Timed out operations terminate the CLI process group.

Both execution backends install and invoke the same small `factorize-job` guest launcher as `exedev`. It requires Python 3, the `exedev` account, and a writable `/home/exedev/.factorize-job` directory. It accepts a bounded JSON launch payload over stdin, starts the code script or agent argv without a shell command assembled from the payload, writes structured process state, preserves stdout/stderr and the run result, and exposes `factorize-job status` for Fly scheduler polling. Fly images also need `runuser`, `/bin/sh`, `/usr/local/bin`, Node.js and OpenSSL for portable proxy access, and the provider's documented Machine exec/SFTP support. Codex images must provide the tested `codex-cli 0.167.1`; Fly checks this as the `exedev` user before launch and returns a bounded failure for a missing or unsupported version. Code jobs do not require Codex. Image verification checks Python 3 for exe.dev execution; Fly reports a bounded launch failure when guest prerequisites are absent. The helper and job Machine are not configured to restart and replay a failed process. Custom entrypoints can finish their own setup before the backend invokes the launcher.

The local protocol fixtures verify process result handling, timeout, output overflow, disconnect, safe argv construction, and file byte transfer. They do not validate live Fly authentication, Fly CLI compatibility, routing to a real Machine, or the guest's exec/SFTP capabilities. A separate opt-in validation requires a Fly account, an authorized app/Machine and token, an installed Fly CLI, and a custom image with Fly exec/SFTP support; no Fly network call is part of the required test suite.

For portable integrations, the scheduler sends the scoped run credential over Fly's authenticated Machine exec channel directly to the dedicated credential proxy's private Unix socket. The proxy keeps it in process memory, bound to that run and provider VM identity, and removes it when durable revocation arrives. The credential is not part of Machine configuration, launch files, or the job VM payload. During guest launch, the VM generates its own private key and CSR; the proxy signs the CSR for the provider VM identity, and only the certificate and trust bundle return to the scheduler for installation. An internal-only Fly service exposes the proxy tunnel listener on port 9090. The guest starts a loopback CONNECT forwarder and sets HTTP(S)_PROXY for the job process. Each tunnel connection presents only its run ID over mTLS; the proxy retrieves its in-memory credential to perform fresh control-plane enrollment.

## Credential-proxy package and local evidence

`packages/credential-proxy` is a private npm workspace of native ES modules and
uses Node.js built-ins at runtime. Its package entry points are declared in
`package.json`; only `src/` is included in the package artifact, excluding the
test suite's synthetic TLS keys and fixtures. The Fly VM tunnel helper is generated from
`packages/api/src/fly-job-tunnel-helper.ts`. After `npm ci`, inspect the local
package contents without publishing with:

```sh
npm pack --dry-run --workspace=@factorize/credential-proxy --json
npm run test:proxy
```

The provisioner accepts only an image pinned by digest and equal to the reviewed
image supplied by deployment configuration. Proxy control credentials enter
through the private bootstrap socket; run credentials enter through Fly's
authenticated Machine exec channel and remain in proxy memory. Neither user
unlock keys nor integration credentials belong in image build arguments, image
configuration, guest environment variables, or launch payloads.

The minimal credential-proxy OCI recipe is `packages/credential-proxy/Dockerfile`.
It pins the Node 24.12.0 multi-platform manifest digest, installs the
authentication-only Codex CLI 0.167.1 from a checked-in lockfile, copies only
proxy runtime source, and runs as the unprivileged `node` user. Build locally
without publishing using `scripts/build-credential-proxy-image.sh`; Docker
Buildx emits an OCI archive with max-mode provenance and an SBOM under
`~/.factorize-job/credential-proxy-image/`, alongside a compact JSON summary
binding the archive digest to the source commit, base digest, and Codex version.
The OCI archive and generated provenance are inspectable/rebuildable artifacts;
this repository deliberately has no publishing workflow, and this local recipe
does not establish that any production digest has been published or approved.
The provisioner's reviewed-digest configuration must still be updated through
the separate release process after image review. Live Fly networking also
remains unverified.

Local coverage is split across fixtures to avoid repeating full application
startup: `packages/credential-proxy/test/fly-guest-helper.e2e.test.mjs` executes
the generated guest helper against an mTLS proxy and local HTTPS upstream and
rejects a mismatched VM binding; `proxy-listener.e2e.test.mjs` checks per-VM
reflection, locked access, configured-origin forwarding, redirect rejection,
interrupted writes, and reconnect after lock/unlock. These synthetic fixtures do
not establish live provider or production behavior. The combined
`locked scoped run reconnects with its current grant while another VM stays denied`
fixture exercises the production grant resolver with a synthetic Factorize run
snapshot and local TLS upstream. The repository runbook
`packages/docs/self-hosting/credential-proxy-security.mdx` documents key handling, lifecycle recovery,
accepted provider/control-plane risks, and the independent Fly shutdown steps.
