# Factorize

Factorize turns selected Linear issue changes into coding-agent jobs on the customer's own exe.dev VM. It uses Herdr on that VM to run their chosen agent (for example, Codex or Claude) and reports job state back to Linear.

```text
Linear webhook → Cloudflare Worker → Durable Object → exe.dev /exec → Herdr
                                         ↑ polls status              ↓
                                      concurrency control      Linear comments
```

Each Linear workspace is isolated in its own Durable Object. The first person to connect a workspace is its Factorize owner; only that owner can manage pipes and the exe.dev connection.

## Prerequisites

- A Linear OAuth application.
- A customer-owned exe.dev VM with Herdr and the desired coding agent installed.
- An exe.dev HTTPS API token limited to the exact SSH destination Factorize will use, such as `ssh exedev@<vm-name>`. Use the same user-qualified destination you use interactively so Factorize and your terminal share one Herdr session.
- A Cloudflare account with Workers enabled.

The VM needs no public proxy, Nginx configuration, SSH access from Factorize, or Factorize service. Factorize invokes Herdr through exe.dev's HTTPS execution API.

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars
npm run dev
```

Fill in `.dev.vars` with the Linear OAuth credentials, the OAuth app webhook signing secret, and two independent application secrets. Generate the encryption key with:

```bash
openssl rand -base64 32
```

For local development, configure the Linear OAuth callback as:

```text
http://localhost:8787/auth/linear/callback
```

## Usage

1. Sign in with Linear.
2. Connect the customer’s exe.dev VM using its restricted HTTPS API token. Enter the exact SSH destination you use yourself (for example, `exedev@my-vm`), including the user.
3. Create a flow: choose a Linear project, then add one or more issue matching rules (owner, creator, status, label, or assignee). All rules must match. The first available project is selected by default.

Configure one signed webhook on the Linear OAuth app at `https://your-domain.example/webhooks/linear`, subscribing to **Issues** and **Issue labels**. Linear creates the workspace-specific subscription when a workspace authorizes the app. Matching changes queue jobs; each flow runs no more than its configured concurrency. A job remains claimed until Herdr reports it complete, so repeated matching webhooks for the same issue are ignored while it is queued or running. When an agent finishes, its slot is filled from the queue in the same polling alarm.

## Deploy to Cloudflare

Set `APP_ORIGIN` in `wrangler.jsonc` to the final HTTPS Worker URL or custom domain. Configure the same production callback URL in Linear:

```text
https://your-domain.example/auth/linear/callback
```

Build the stylesheet, then set production secrets:

```bash
npm run build:css
npx wrangler secret put LINEAR_CLIENT_ID
npx wrangler secret put LINEAR_CLIENT_SECRET
npx wrangler secret put LINEAR_WEBHOOK_SIGNING_SECRET
npx wrangler secret put CREDENTIAL_ENCRYPTION_KEY
npx wrangler secret put SESSION_SIGNING_SECRET
```

When deploying from a VPS, authenticate without a VPS browser:

```bash
npx wrangler login --device --browser=false
```

Open the displayed URL and approve the code from your local browser. Then deploy:

```bash
npx wrangler whoami
npm run deploy
```

## Security

- Linear and exe.dev credentials, issue prompts, and agent results are AES-GCM encrypted at rest in the Durable Object.
- Linear webhook requests require the OAuth app's valid HMAC-SHA256 signature and fresh timestamps before they are routed by organization.
- Session cookies are signed, expire after seven days, and are checked against the workspace membership record.
- Agent output is not copied to Linear; completion comments point users to the Herdr session on their VM.
- The dashboard is served with a restrictive content-security policy and local Tailwind CSS.

## Linear OAuth app settings

Use authorization-code OAuth; client credentials are not needed. Enable **Webhooks**, set its URL to `https://your-domain.example/webhooks/linear`, select **Issues** and **Issue labels**, and copy the generated webhook signing secret into `LINEAR_WEBHOOK_SIGNING_SECRET`. After enabling or changing the OAuth app webhook configuration, re-authorize each existing workspace so Linear creates its subscription.
