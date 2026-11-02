# Marketing site and app

Factorize is deployed as a Cloudflare Pages site and an app Worker:

- `packages/marketing` owns the public landing page at `https://factorize.sh`. It is a static Cloudflare Pages project named `factorize-marketing`; its production branch is `main` and its output directory is `packages/marketing/public`. It contains no authenticated APIs or tenant data. Login and Create a Job links cross to `https://app.factorize.sh`.
- `packages/api` owns the authenticated dashboard, OAuth callbacks, API/MCP endpoints, provider webhooks, and job deep links at `https://app.factorize.sh`. Its `/` route is the signed-out login entry point and redirects signed-in users to `/jobs`.

The Pages project is connected to `GenerationSoftware/factorize` for pull request previews, but Cloudflare's automatic production deployments are disabled. Production deploys from `main` run through `.github/workflows/deploy.yml`, where failures are visible in GitHub Actions. For a manual deployment, authenticate Wrangler and run `npm run deploy:marketing`; this uploads `packages/marketing/public` to the `factorize-marketing` project.

Run the app Worker locally with `npm run dev`. To preview the marketing package's Worker fallback locally, use `npm run dev:marketing`.

The Pages custom domain is `factorize.sh`. Cloudflare manages HTTPS and redirects HTTP to HTTPS. The apex DNS record is proxied to Pages; the existing proxied `app.factorize.sh` record is retained unchanged.

Cloudflare Browser Integrity Check is disabled for `app.factorize.sh` so API and MCP clients can access the application without browser header checks. The zone-wide default remains enabled. This is a live Cloudflare configuration rule, managed separately from Worker deployments:

- Phase: `http_config_settings`; action: `set_config`.
- Expression: `(http.host eq "app.factorize.sh")`.
- Action parameters: `{ "bic": false }`.
- Rule reference: `factorize_app_disable_bic`.
- Ruleset ID: `fd04dea88688456d94a5fdea17caac8a`; rule ID: `b416dcd4bf1f48f2990d893c75c919b0`.

Only Browser Integrity Check is overridden; application authentication and other security settings remain in effect. To roll back, disable this configuration rule to inherit the zone default. See [Cloudflare's Browser Integrity Check documentation](https://developers.cloudflare.com/waf/tools/browser-integrity-check/).

Configure the Linear OAuth callback and provider webhooks against the app origin, never the marketing origin. Existing `/jobs/*`, `/api/*`, `/mcp`, `/authorize`, and webhook URLs remain app routes.
