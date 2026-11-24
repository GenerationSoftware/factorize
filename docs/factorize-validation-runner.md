# Factorize validation runner image

The Factorize-specific exe.dev runner image is built from
[`Dockerfile.validation-runner`](../Dockerfile.validation-runner), using the
documented exe.dev `exeuntu` base. It keeps the base image's SSH, systemd,
`exedev` user, and agent setup while adding prerequisites for the complete
Factorize test suite.

The image pins Node 24.21.0, npm 11.19.0, and Playwright/Chromium 1.64.0. It
installs PostgreSQL 16 without starting systemd during image build, enables
the PostgreSQL service for VM boot, and sets the `postgres` password used by
`scripts/bootstrap-test.mjs`. PostgreSQL listens on loopback; the test
bootstrap creates and recreates only its isolated validation database. The
image sets `PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright` as an OCI environment
variable so non-login job processes inherit the installed browser location.
The Docker build launches Chromium as `exedev`; the post-boot smoke command
also checks password authentication over TCP and Chromium from the job user.

## Build, publish, and pin

The build/publish script uses the attached GHCR integration and prints the
immutable public image reference with its registry digest:

```sh
bash scripts/build-validation-runner-image.sh
```

The resulting package must be public because exe.dev job images are pulled by
the host and private images are unsupported for jobs. Set the Factorize Dev
job's image to the printed
`ghcr.io/generationsoftware/factorize-validation-runner@sha256:…` reference,
preserving its other execution configuration. Do not use a mutable tag for
the job image. Record the exact digest in the issue handoff and validation
record below.

## Fresh-VM acceptance

After booting the pinned image, run the image smoke check, then check out the
Factorize repository and run the full local validation:

```sh
bash scripts/smoke-validation-runner-image.sh
npm ci
npm run test:local
```

`test:local` resets the local validation database, applies the migrations
from that checkout, sets all three isolated database URLs in the root test
process, and runs `npm test`. Before it drops or recreates the database,
`test:local` launches Chromium and authenticates to the configured local
PostgreSQL admin URL, so missing image prerequisites fail before migrations
or the full suite. A failure requires correcting the image or bootstrap and
publishing a new digest, followed by repeating this sequence.

## Validated image record

The current image was built from Factorize commit
`7255cbd24e8a6904284a8f58db43375ca57f226e` and published on 2026-11-24.
The `7255cbd24e8a` tag resolves to the digest below. A Docker pull with an
empty config verified public access to the digest.

| Field | Value |
| --- | --- |
| Public image digest | `ghcr.io/generationsoftware/factorize-validation-runner@sha256:def581d5231b508165c88d97daedccba6de2cb6d568440cabad3ac7913f66930` |
| Platform | `linux/amd64` |
| Node / npm / Playwright | 24.21.0 / 11.19.0 / 1.64.0 |
| Container smoke | Chromium launched as `exedev` and PostgreSQL accepted password authentication after manual service startup. |
| Full container suite | `npm ci` succeeded. Browser and proxy checks passed. Two backend tests in `consent-api.test.ts` failed because the permission-preset fixture returned a row with no `scopes` field. |
| Fresh Dev VM and Dev job image pin | Pending fresh-VM acceptance (GEN-2889). |

### Previous Node 24.12.0 checkpoint

| Field | Value |
| --- | --- |
| Public image digest | `ghcr.io/generationsoftware/factorize-validation-runner@sha256:1333c4a7bb49c4cbcdd28ca2b57331dfcbff7cf611db1aaeaa4830517aacf6d4` |
| Node / npm / Playwright | 24.12.0 / 11.19.0 / 1.64.0 |
| Image smoke and full suite | Passed in a Docker container pulled anonymously from the immutable digest; not fresh-VM evidence |
| Fresh Dev VM and Dev job image pin | Pending; keep PR #392 draft and GEN-2889 In Progress until this gate passes |

The checkpoint pull and container validation were repeated on 2026-11-11.
An unauthenticated GHCR manifest request returned HTTP 200 for the digest,
and `docker pull` with an empty Docker config downloaded the same digest. In a
container from that image, the PostgreSQL authentication helper and image smoke
passed, followed by `npm ci` and `npm run test:local` on Factorize commit
`02f96e9e23908537fffc2584b26abe85c34b1090` (backend 569 passed / 5 skipped,
browser 102 passed / 1 skipped, proxy checks and builds passed). The container
test starts PostgreSQL and invokes the image's authentication helper as setup;
it does not verify exe.dev VM boot behavior. The Dev job remains on
`ghcr.io/generationsoftware/anarack:latest`. A fresh Dev VM must still boot
from the digest and pass these checks before the job image is pinned.
