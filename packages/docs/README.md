# Factorize documentation

This is an independently previewable and publishable [Mintlify](https://mintlify.com) package. Install the Mintlify CLI, run `npm run dev --workspace=factorize-docs`, and open the local URL. Run `npm run validate --workspace=factorize-docs` in CI; it checks the route inventory against the Worker and verifies the LLM exports. Publish with `npm run deploy --workspace=factorize-docs` from a configured Mintlify project. See [the publishing runbook](../../docs/mintlify.md) for the repository, custom-domain, DNS, and verification configuration.

`openapi.yaml`, `llms.txt`, and `llms-full.txt` are checked-in artifacts so API clients and LLMs can consume the contract without rendering the site.
