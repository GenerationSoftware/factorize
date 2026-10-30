# Recovering a Worker startup failure

The production workflow requires a healthy `/api/v1/session` response before
deployment. A Worker startup exception can therefore block deployment of its own
fix. Restore a compatible working Worker version first, then rerun the normal
workflow with every release gate enabled.

## Recovery procedure

1. Read the attached Reflection integration metadata and use the documented
   Cloudflare API proxy. Start a temporary Worker tail and reproduce the failure
   with read-only health and session requests. Record the exception and deployed
   version ID; avoid saving request headers, bodies, or credentials.
2. Inspect the Worker's deployment history and version metadata. Select the most
   recent compatible working version. Check its code, runtime, bindings, assets,
   and Durable Object migration tag. A version created by a secret update before
   a broken code deployment may retain the working code with the current secrets.
   Do not force a rollback across changed secrets or incompatible state.
3. Use Cloudflare's [Create Worker Deployment API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/create/)
   to route 100% of requests to the selected version. This activates an existing
   version; it does not revert database migrations or recreate state resources.
4. Verify `/healthz` returns `200` with `{"ok":true}` and an anonymous
   `/api/v1/session` request returns `200` with `{"authenticated":false}` and
   `X-Factorize-Contract: gen-2157-static-v1`. Run:

   ```sh
   node scripts/verify-public-routing.mjs https://app.factorize.sh
   ```

5. Rerun the failed production workflow for the merged fix. Monitor the API
   prerequisite, asset retention, migrations, Worker deployment, and final public
   verification. Verify the live version and anonymous browser loading again
   after completion. Do not leave a temporary rollback as the final release.
6. Delete the temporary Worker tail and preserve the recovery evidence in a PR.

## 2026-10-30 OAuth scope incident

Cloudflare tails captured `TypeError: scopesSupported must not contain duplicate
values` on health, session, and internal trace-upload requests. `runs:write` had
become a canonical access scope but was also appended to the provider's legacy
scope list. OAuth provider construction threw before backend dispatch.

[PR #317](https://github.com/GenerationSoftware/factorize/pull/317) deduplicated the
provider scope list, but its first deployment failed at the live session gate.
The failing production version was `ee5e4bf5-9b57-4182-b5ce-2c641d351d3e`.

Recovery activated `aae2319a-c571-4be8-91e1-a3e7d1c4ef37`, whose script and runtime
matched the preceding working deployment and whose secrets were from the latest
pre-deploy secret update. Recovery deployment
`93089924-e637-4093-a9fa-c179fea8adc5` restored health and session responses at
01:14 UTC. Public routing/security/cache verification and an anonymous Chromium
page load passed, with no JavaScript page errors. The normal
[deployment workflow](https://github.com/GenerationSoftware/factorize/actions/runs/40984395531)
was then rerun for merged commit `24cf99c`.
