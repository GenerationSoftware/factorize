# Factorize documentation

This is an independently previewable and publishable [Mintlify](https://mintlify.com) package. Install the Mintlify CLI, run `npm run dev --workspace=factorize-docs`, and open the local URL. Publish with `npm run deploy --workspace=factorize-docs` from a configured Mintlify project. See [the publishing runbook](../../docs/mintlify.md) for repository, custom-domain, DNS, and verification configuration.

The REST reference links to `openapi.yaml` directly. This is the generated API artifact consumed by the docs, clients, and CI. Update the executable catalog in `packages/api/src/api-contract.ts`, run `npm run generate:openapi` from the repository root, and commit the resulting YAML. Shared schemas and general metadata live beside the catalog.

Run `npm run validate --workspace=factorize-docs` to check artifact freshness, parsed method/path equality, Mintlify configuration, and LLM exports. CI also regenerates the artifact and rejects any diff. Run `npm run generate --workspace=factorize-docs` after editing guides/navigation. Both LLM exports are generated from every maintained navigation guide; validation rejects stale exports, missing/invented MCP tools, broken local links and onboarding drift. JSON examples in the first-job and recipes are parsed against implementation schemas by the API docs-workflows tests.
