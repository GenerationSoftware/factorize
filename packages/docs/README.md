# Factorize documentation

This is an independently previewable and publishable [Mintlify](https://mintlify.com) package. Install the Mintlify CLI, run `npm run dev --workspace=factorize-docs`, and open the local URL. Publish with `npm run deploy --workspace=factorize-docs` from a configured Mintlify project. See [the publishing runbook](../../docs/mintlify.md) for repository, custom-domain, DNS, and verification configuration.

The API Reference tab renders `openapi.yaml` directly. This is the generated API artifact consumed by the docs, clients, and CI. Update the executable catalog in `packages/app/src/api-contract.ts`, run `npm run generate:openapi` from the repository root, and commit the resulting YAML. Shared schemas and general metadata live beside the catalog.

Run `npm run validate --workspace=factorize-docs` to check artifact freshness, parsed method/path equality, Mintlify configuration, and LLM exports. CI also regenerates the artifact and rejects any diff. `llms.txt` and `llms-full.txt` provide documentation summaries and point to the generated contract for operation details.
