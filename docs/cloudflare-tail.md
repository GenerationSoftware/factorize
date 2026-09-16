# Cloudflare Tail job trigger

Cloudflare Tail is an authenticated Factorize Job trigger for native uncaught Worker exceptions and structured `console.error` failures. Tail Workers require a Workers Paid or Enterprise plan. The relay is a separate Cloudflare Worker and must be deployed in the same Cloudflare account as the producer Workers; the Factorize app Worker may be in any account.

## Configure the job and relay

1. Create a Job, add a **Cloudflare Tail** trigger, and save it. Copy its relay destination and signing secret.
2. From the repository root, run `npm ci` and set `FACTORIZE_TAIL_DESTINATION` as a Wrangler variable in `packages/tail-relay/wrangler.jsonc`.
3. Authenticate Wrangler to the producer Workers' Cloudflare account, then run `npm exec --workspace=factorize-tail-relay -- wrangler secret put FACTORIZE_TAIL_SECRET` and `npm run deploy:tail-relay`. Keep the relay name `factorize-tail-relay`; Factorize excludes its own relay traces to prevent loops.
4. Add the relay to every producer Worker. One relay can consume multiple producers and forwards each event with its `scriptName`:

```jsonc
{
  "tail_consumers": [{ "service": "factorize-tail-relay" }]
}
```

Deploy each producer after changing `tail_consumers`.

MCP clients create or update a Job with a `cloudflareTail` webhook trigger and an execution target returned by `list_execution_targets`. Protected REST and MCP never return the signing secret. After rotating it, update `FACTORIZE_TAIL_SECRET` in Wrangler and redeploy the relay.

The relay redacts sensitive key names (authorization, cookies, tokens, secrets, credentials, prompts, and bodies), truncates oversized structures, signs the exact body with HMAC-SHA256, and aborts delivery after three seconds. Factorize sanitizes again before activity or agent context, rejects deliveries older than 60 seconds, deduplicates delivery IDs, and rate-limits repeated event fingerprints.

For caught internal failures, log a structured event:

```js
console.error(JSON.stringify({ event: "factorize_unexpected_failure", component: "billing", message: error.message }));
```

Do not include request bodies, headers, credentials, or prompts in the structured log. Expected 4xx/domain failures remain ordinary Tail events unless the Job handler explicitly accepts them.
