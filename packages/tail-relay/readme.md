# Factorize Tail Relay

This Cloudflare Tail Worker sanitizes trace events, signs them with HMAC-SHA256, and forwards them to a Factorize Cloudflare Tail flow.

## Usage

From the repository root, install dependencies with `npm ci`. Set `FACTORIZE_TAIL_DESTINATION` in `packages/tail-relay/wrangler.jsonc`, then store the signing secret with:

```sh
npm exec --workspace=factorize-tail-relay -- wrangler secret put FACTORIZE_TAIL_SECRET
```

Configure each producer Worker to use the relay:

```jsonc
"tail_consumers": [{ "service": "factorize-tail-relay" }]
```

## Deployment

Authenticate Wrangler to the producer Workers' Cloudflare account, then run `npm run deploy:tail-relay`. The relay must be deployed in the same Cloudflare account as its producer Workers.
