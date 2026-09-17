# Mintlify documentation site

Factorize publishes the documentation package in [`packages/docs`](../packages/docs) at
[`https://docs.factorize.sh`](https://docs.factorize.sh).

## Project configuration

Create or select the Mintlify project connected to the `GenerationSoftware/factorize`
GitHub repository. Set the documentation root to `packages/docs` and use the `main`
branch for production publishing. Mintlify reads [`docs.json`](../packages/docs/docs.json)
as the site configuration. The package can be previewed with `npm run dev
--workspace=factorize-docs` and validated with `npm run validate
--workspace=factorize-docs`.

In the Mintlify project, add `docs.factorize.sh` as the custom domain and complete
domain verification. The custom-domain target is `cname.mintlify.builders`; keep the
domain DNS-only while Mintlify provisions TLS.

## DNS records

The `factorize.sh` Cloudflare zone contains these records for the Mintlify custom
domain:

| Type | Name | Value |
| --- | --- | --- |
| TXT | `_acme-challenge.docs` | `nfOE4G0h3ghcEY4OpRBmnmRBVD7E3X15wXV-Ia4MPBs` |
| TXT | `_cf-custom-hostname.docs` | `06da37c6-9b2e-474b-afde-478ba843baf7` |
| CNAME | `docs` | `cname.mintlify.builders` |

The records are intentionally not proxied. Preserve the unrelated apex and
`app.factorize.sh` records when updating this configuration.

## Publishing checklist

1. Run `npm ci` from the repository root.
2. Run `npm run validate --workspace=factorize-docs`.
3. Preview changes with `npm run dev --workspace=factorize-docs`.
4. Publish from the configured Mintlify project (or run
   `npm run deploy --workspace=factorize-docs` with the Mintlify CLI authenticated).
5. Confirm the custom domain is verified and that the site loads over HTTPS.
