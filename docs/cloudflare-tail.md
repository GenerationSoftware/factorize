# Cloudflare Tail flow source

Cloudflare Tail is a Factorize flow source for native uncaught Worker exceptions and structured `console.error` failures. Tail Workers require a Workers Paid or Enterprise plan. The relay stays in the same Cloudflare account as the producer Workers; the Factorize flow may be in any account.

## Configure the flow and relay

1. Create a flow, choose **Cloudflare Tail**, and save it. Copy the one-time relay destination and signing secret from the response/flow setup view.
2. In `factorize-tail-relay`, run `npm install`, set `FACTORIZE_TAIL_DESTINATION` as a Wrangler variable, and run `npx wrangler secret put FACTORIZE_TAIL_SECRET`.
3. Run `npm run deploy`. Keep the relay name `factorize-tail-relay`; Factorize excludes its own relay traces to prevent loops.
4. Add the relay to every producer Worker. One relay can consume multiple producers and forwards each event with its `scriptName`:

```jsonc
{
  "tail_consumers": [{ "service": "factorize-tail-relay" }]
}
```

Deploy each producer after changing `tail_consumers`. In the flow activity page, use the owner-only **Test Cloudflare Tail delivery** action before enabling concurrency/automation. The synthetic exception traverses the same isolated handler and normal queue path.

The relay redacts sensitive key names (authorization, cookies, tokens, secrets, credentials, prompts, and bodies), truncates oversized structures, signs the exact body with HMAC-SHA256, and aborts delivery after three seconds. Factorize sanitizes again before activity or agent context, rejects deliveries older than 60 seconds, deduplicates delivery IDs, and rate-limits repeated event fingerprints.

For caught internal failures, log a structured event:

```js
console.error(JSON.stringify({ event: "factorize_unexpected_failure", component: "billing", message: error.message }));
```

Do not include request bodies, headers, credentials, or prompts in the structured log. Expected 4xx/domain failures remain ordinary Tail events unless the flow handler explicitly accepts them.
