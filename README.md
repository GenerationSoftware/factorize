# Factorize

[![CI](https://github.com/asselstine/factorize/actions/workflows/ci.yml/badge.svg)](https://github.com/asselstine/factorize/actions/workflows/ci.yml)
[![Deploy to Cloudflare](https://img.shields.io/badge/Deploy_to-Cloudflare-F38020?style=flat&logo=cloudflare&logoColor=white)](https://deploy.workers.cloudflare.com/?url=https://github.com/asselstine/factorize)

**A no-code software factory for Linear teams.** Factorize turns selected Linear issue changes into coding-agent jobs on your own exe.dev VM, using Herdr to run the agent you choose.

```text
Linear webhook → Cloudflare Worker → Durable Object → exe.dev /exec → Herdr
                                         ↑ polls status              ↓
                                      concurrency control      Linear comments
```

## Why Factorize?

- Keep control: agents run on your own exe.dev VM, not a shared runner.
- Automate deliberately: match Linear issues by owner, creator, status, label, or assignee.
- Work together: use Herdr to observe, guide, or take over a running agent session.
- Stay isolated: each Linear workspace has its own Cloudflare Durable Object.
- Avoid duplicate work: a claimed issue stays claimed until its agent job completes.

## Deploy to Cloudflare

Click the **Deploy to Cloudflare** button above to create a copy of this Worker in your own Cloudflare account. Cloudflare provisions the Durable Object binding and configures Workers Builds for the copied repository.

> The Deploy to Cloudflare button works for public GitHub or GitLab repositories. If you are using a private fork, deploy with Wrangler instead.

### Deploy with Wrangler

1. Clone the repository and install dependencies.
2. Set `APP_ORIGIN` in `wrangler.jsonc` to your final HTTPS Worker URL or custom domain.
3. Configure the Linear OAuth callback as `https://your-domain.example/auth/linear/callback`.
4. Build assets, add secrets, and deploy:

```bash
npm ci
npm run build:css

npx wrangler secret put LINEAR_CLIENT_ID
npx wrangler secret put LINEAR_CLIENT_SECRET
npx wrangler secret put LINEAR_WEBHOOK_SIGNING_SECRET
npx wrangler secret put CREDENTIAL_ENCRYPTION_KEY
npx wrangler secret put SESSION_SIGNING_SECRET

npm run deploy
```

For a headless machine, authenticate first with `npx wrangler login --device --browser=false`, then open the displayed URL and approve the device code from your browser.

## Quick start

### Prerequisites

- A Cloudflare account with Workers enabled.
- A Linear OAuth application with webhooks enabled.
- An exe.dev VM with Herdr and your coding agent (such as Codex or Claude) installed.
- An exe.dev HTTPS API token restricted to the exact SSH destination Factorize will use, for example `ssh exedev@my-vm`.

### Develop locally

```bash
npm install
cp .dev.vars.example .dev.vars
npm run dev
```

Set the Linear OAuth callback URL to:

```text
http://localhost:8787/auth/linear/callback
```

Fill `.dev.vars` with the Linear OAuth credentials, webhook signing secret, and two independent application secrets. Generate the encryption key with:

```bash
openssl rand -base64 32
```

## Configure Linear

Use authorization-code OAuth and enable **Webhooks** on the OAuth application. Configure:

| Setting | Value |
| --- | --- |
| Callback URL | `https://your-domain.example/auth/linear/callback` |
| Webhook URL | `https://your-domain.example/webhooks/linear` |
| Webhook events | **Issues** and **Issue labels** |
| Webhook secret | Store as `LINEAR_WEBHOOK_SIGNING_SECRET` |

After changing the webhook settings, re-authorize existing workspaces so Linear creates a fresh workspace subscription.

## Create a flow

1. Sign in with Linear.
2. Connect your exe.dev VM using its restricted HTTPS API token. Use the same user-qualified SSH destination you use interactively so Factorize and your terminal join the same Herdr session.
3. Create a flow, select a Linear project, and add matching rules. Every rule must match.

Matching issue updates queue work up to the flow’s configured concurrency. When a run finishes, Factorize fills its slot from the queue and posts a link to the Herdr session in Linear.

## Configuration reference

| Variable | Purpose |
| --- | --- |
| `LINEAR_CLIENT_ID` | Linear OAuth client ID |
| `LINEAR_CLIENT_SECRET` | Linear OAuth client secret |
| `LINEAR_WEBHOOK_SIGNING_SECRET` | Verifies Linear webhook signatures |
| `CREDENTIAL_ENCRYPTION_KEY` | Base64-encoded 32-byte key for encrypted credentials |
| `SESSION_SIGNING_SECRET` | Independent secret for signed browser sessions |
| `APP_ORIGIN` | Public Worker origin, configured in `wrangler.jsonc` |

Never commit `.dev.vars` or production secret values. The included `.dev.vars.example` is a safe template.

## Development commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Build CSS and start local Wrangler development |
| `npm run build:css` | Compile Tailwind into `public/styles.css` |
| `npm test` | Run the unit test suite |
| `npm run check` | Type-check, test, and validate a Wrangler dry-run deploy |
| `npm run deploy` | Deploy the Worker with Wrangler |

GitHub Actions runs `npm run check` on every push and pull request.

## Security

- Linear and exe.dev credentials, issue prompts, and agent results are AES-GCM encrypted at rest in the Durable Object.
- Linear webhooks require a valid HMAC-SHA256 signature and fresh timestamp before workspace routing.
- Session cookies are signed, expire after seven days, and are checked against workspace membership.
- Agent output is not copied into Linear; completion comments point back to the Herdr session on your VM.
- The dashboard uses a restrictive content-security policy and locally built Tailwind CSS.

## License

[Apache License 2.0](LICENSE)
