# Cloudflare Tail job trigger

Cloudflare Tail is an authenticated Factorize Job trigger for native uncaught Worker exceptions and structured `console.error` failures. Tail Workers require a Workers Paid or Enterprise plan. The relay is a separate Cloudflare Worker and must be deployed in the same Cloudflare account as the producer Workers; the Factorize app Worker may be in any account.

## Configure the job and relay

1. In **Settings → Integrations**, install Cloudflare Tail. Give the installation a name and either paste a signing secret or generate one. Generated secrets are returned only once, so copy it during setup.
2. Create a Job, add a **Cloudflare Tail** trigger, select the installation, and save it. Copy the Job's relay destination.
3. From the repository root, run `npm ci` and set `FACTORIZE_TAIL_DESTINATION` as a Wrangler variable in `packages/tail-relay/wrangler.jsonc`.
4. Authenticate Wrangler to the producer Workers' Cloudflare account, then run `npm exec --workspace=factorize-tail-relay -- wrangler secret put FACTORIZE_TAIL_SECRET` and `npm run deploy:tail-relay`. Use the selected installation's secret. Keep the relay name `factorize-tail-relay`; Factorize excludes its own relay traces to prevent loops.
5. Add the relay to every producer Worker. One relay can consume multiple producers and forwards each event with its `scriptName`:

```jsonc
{
  "tail_consumers": [{ "service": "factorize-tail-relay" }]
}
```

Deploy each producer after changing `tail_consumers`.

Jobs refer to the installation by `integrationId`; secrets are encrypted and are never included in list, status, Job, REST, or MCP responses. Rotating an installation updates every Job that selects it after the relay secret is updated and redeployed. Factorize refuses to disconnect installations still referenced by Jobs, so a missing installation can never turn into unsigned ingestion.

The relay redacts sensitive key names (authorization, cookies, tokens, secrets, credentials, prompts, and bodies), truncates oversized structures, signs the exact body with HMAC-SHA256, and aborts delivery after three seconds. Factorize sanitizes again before activity or agent context, rejects deliveries older than 60 seconds, deduplicates delivery IDs, and rate-limits repeated event fingerprints.

For caught internal failures, log a structured event:

```js
console.error(JSON.stringify({ event: "factorize_unexpected_failure", component: "billing", message: error.message }));
```

Do not include request bodies, headers, credentials, or prompts in the structured log. Expected 4xx/domain failures remain ordinary Tail events unless the Job handler explicitly accepts them.
