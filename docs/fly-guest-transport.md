# Fly run guest transport

The backend uses the documented Machines HTTP exec API with an argv `command`
array and optional stdin. It does not run a Fly CLI or SSH agent in the Worker.
`packages/api/src/fly-http-guest-transport.ts` handles bounded output, deadlines,
file uploads and downloads. `flyJobGuest` supplies the tenant's encrypted Fly
provisioning credential only to the Machines API; it never enters the guest.

Machines are created with top-level region and `skip_launch: true`, then started
explicitly. Before job launch, Factorize verifies the guest's signed OIDC token
from `/.fly/api`, pins the organization-slug issuer and exact subject/Machine,
and persists the immutable run binding. The root-owned localhost identity
helper requests fresh vendor tokens and forwards API, selected credential and
artifact requests to the backend. Upstream credentials stay in Factorize.

The former standalone credential-proxy workspace, image, certificate tunnel and
browser capabilities are removed by GEN-2922. See the credential cutover runbook
before deploying this breaking change.
