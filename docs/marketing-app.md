# Marketing site and app

Factorize is deployed as two Cloudflare Workers:

- `packages/marketing` owns the public landing page at `https://factorize.sh`. It contains no authenticated APIs or tenant data. Set `APP_ORIGIN` to the app origin so login and Create a Job links always cross to the app.
- `packages/app` owns the authenticated dashboard, OAuth callbacks, API/MCP endpoints, provider webhooks, and job deep links at `https://app.factorize.sh`. Its `/` route is the signed-out login entry point and redirects signed-in users to `/jobs`.

Run the two Workers independently with `npm run dev` and `npm run dev:marketing`. Deploy the complete setup with `npm run deploy`; deploy only the public site with `npm run deploy:marketing`.

Configure the Linear OAuth callback and provider webhooks against the app origin, never the marketing origin. Existing `/jobs/*`, `/api/*`, `/mcp`, `/authorize`, and webhook URLs remain app routes.
