# Marketing site and app

Factorize is deployed as a Cloudflare Pages site and an app Worker:

- `packages/marketing` owns the public landing page at `https://factorize.sh`. It is a static Cloudflare Pages project named `factorize-marketing`; its production branch is `main` and its output directory is `packages/marketing/public`. It contains no authenticated APIs or tenant data. Login and Create a Job links cross to `https://app.factorize.sh`.
- `packages/app` owns the authenticated dashboard, OAuth callbacks, API/MCP endpoints, provider webhooks, and job deep links at `https://app.factorize.sh`. Its `/` route is the signed-out login entry point and redirects signed-in users to `/jobs`.

The Pages project is connected to `GenerationSoftware/factorize` and automatically deploys production from `main`. Preview deployments are created for pull requests. For a manual deployment, authenticate Wrangler and run `npm run deploy:marketing`; this uploads `packages/marketing/public` to the `factorize-marketing` project.

Run the app Worker locally with `npm run dev`. To preview the marketing package's Worker fallback locally, use `npm run dev:marketing`.

The Pages custom domain is `factorize.sh`. Cloudflare manages HTTPS and redirects HTTP to HTTPS. The apex DNS record is proxied to Pages; the existing proxied `app.factorize.sh` record is retained unchanged.

Configure the Linear OAuth callback and provider webhooks against the app origin, never the marketing origin. Existing `/jobs/*`, `/api/*`, `/mcp`, `/authorize`, and webhook URLs remain app routes.
