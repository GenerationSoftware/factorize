# Cloudflare Tail flow source

Cloudflare Tail is a Factorize flow source for native uncaught Worker exceptions and structured `console.error` failures. Tail Workers require a Workers Paid or Enterprise plan. The relay is a separate Cloudflare Worker and must be deployed in the same Cloudflare account as the producer Workers; the Factorize app Worker may be in any account.

## Configure the flow and relay

1. Create a flow, choose **Cloudflare Tail**, and save it. On the edit page, copy the relay destination and signing secret. You can show, copy, edit, or generate a replacement secret there; replacements remain local until **Save Changes** succeeds.
2. From the repository root, run `npm ci` and set `FACTORIZE_TAIL_DESTINATION` as a Wrangler variable in `packages/tail-relay/wrangler.jsonc`.
3. Authenticate Wrangler to the producer Workers' Cloudflare account, then run `npm exec --workspace=factorize-tail-relay -- wrangler secret put FACTORIZE_TAIL_SECRET` and `npm run deploy:tail-relay`. Keep the relay name `factorize-tail-relay`; Factorize excludes its own relay traces to prevent loops.
4. Add the relay to every producer Worker. One relay can consume multiple producers and forwards each event with its `scriptName`:

```jsonc
{
  "tail_consumers": [{ "service": "factorize-tail-relay" }]
}
```

Deploy each producer after changing `tail_consumers`. In the flow activity page, use the owner-only **Test Cloudflare Tail delivery** action before enabling concurrency/automation. The synthetic exception traverses the same isolated handler and normal queue path.

MCP clients should call `list_exe_connections`, select a `connectionId`, then call `create_flow` with `source: { "kind": "cloudflareTail" }`. The response contains the relay destination but never the signing secret. Omit `handlerCode` for the default exception/`console.error` filter. Protected REST and MCP cannot read or replace the secret; authenticated owners rotate it on the edit page and must then update `FACTORIZE_TAIL_SECRET` in Wrangler and redeploy the relay.

The relay redacts sensitive key names (authorization, cookies, tokens, secrets, credentials, prompts, and bodies), truncates oversized structures, signs the exact body with HMAC-SHA256, and aborts delivery after three seconds. Factorize sanitizes again before activity or agent context, rejects deliveries older than 60 seconds, deduplicates delivery IDs, and rate-limits repeated event fingerprints.

For caught internal failures, log a structured event:

```js
console.error(JSON.stringify({ event: "factorize_unexpected_failure", component: "billing", message: error.message }));
```

Do not include request bodies, headers, credentials, or prompts in the structured log. Expected 4xx/domain failures remain ordinary Tail events unless the flow handler explicitly accepts them.
