import type { Env } from "./bindings";
// Keep the raw Worker binding names and missing-value behavior at this boundary.
// Each adapter reads only its own group. Secrets are never logged or included in a global config dump.

export const appConfig = (env: Pick<Env, "APP_ORIGIN" | "MARKETING_ORIGIN">) => ({
  origin: env.APP_ORIGIN,
  marketingOrigin: env.MARKETING_ORIGIN,
});

export const signingConfig = (env: Pick<Env, "SESSION_SIGNING_SECRET" | "CREDENTIAL_ENCRYPTION_KEY" | "TOTP_ENCRYPTION_KEY">) => ({
  sessionSecret: env.SESSION_SIGNING_SECRET,
  credentialKey: env.CREDENTIAL_ENCRYPTION_KEY,
  totpKey: env.TOTP_ENCRYPTION_KEY,
});

export const emailConfig = (env: Pick<Env, "POSTMARK_SERVER_TOKEN" | "POSTMARK_FROM_EMAIL" | "POSTMARK_MESSAGE_STREAM">) => ({
  serverToken: env.POSTMARK_SERVER_TOKEN,
  fromEmail: env.POSTMARK_FROM_EMAIL,
  messageStream: env.POSTMARK_MESSAGE_STREAM,
});

export const githubConfig = (env: Pick<Env, "GITHUB_APP_ID" | "GITHUB_APP_SLUG" | "GITHUB_APP_PRIVATE_KEY" | "GITHUB_WEBHOOK_SECRET">) => ({
  appId: env.GITHUB_APP_ID,
  appSlug: env.GITHUB_APP_SLUG,
  privateKey: env.GITHUB_APP_PRIVATE_KEY,
  webhookSecret: env.GITHUB_WEBHOOK_SECRET,
});

export const linearConfig = (env: Pick<Env, "LINEAR_CLIENT_ID" | "LINEAR_CLIENT_SECRET" | "LINEAR_OAUTH_SCOPES" | "LINEAR_WEBHOOK_SIGNING_SECRET">) => ({
  clientId: env.LINEAR_CLIENT_ID,
  clientSecret: env.LINEAR_CLIENT_SECRET,
  scopes: env.LINEAR_OAUTH_SCOPES,
  webhookSecret: env.LINEAR_WEBHOOK_SIGNING_SECRET,
});

export const clickupConfig = (env: Pick<Env, "CLICKUP_CLIENT_ID" | "CLICKUP_CLIENT_SECRET">) => ({
  clientId: env.CLICKUP_CLIENT_ID,
  clientSecret: env.CLICKUP_CLIENT_SECRET,
});

export const googleConfig = (env: Pick<Env, "GOOGLE_SIGN_IN_CLIENT_ID" | "GOOGLE_SIGN_IN_CLIENT_SECRET" | "GOOGLE_SIGN_IN_START_LIMIT">) => ({
  clientId: env.GOOGLE_SIGN_IN_CLIENT_ID,
  clientSecret: env.GOOGLE_SIGN_IN_CLIENT_SECRET,
  rateLimit: env.GOOGLE_SIGN_IN_START_LIMIT,
});

export const cloudflareOAuthConfig = (env: Pick<Env, "CLOUDFLARE_OAUTH_CLIENT_ID" | "CLOUDFLARE_OAUTH_CLIENT_SECRET" | "CLOUDFLARE_OAUTH_READ_SCOPES" | "CLOUDFLARE_OAUTH_DEFAULT_SCOPES">) => ({
  clientId: env.CLOUDFLARE_OAUTH_CLIENT_ID,
  clientSecret: env.CLOUDFLARE_OAUTH_CLIENT_SECRET,
  readScopes: env.CLOUDFLARE_OAUTH_READ_SCOPES,
  defaultScopes: env.CLOUDFLARE_OAUTH_DEFAULT_SCOPES,
});

export const awsWorkloadConfig = (env: Pick<Env, "APP_ORIGIN" | "AWS_WORKLOAD_SIGNING_KEYS">) => ({
  origin: env.APP_ORIGIN,
  keys: env.AWS_WORKLOAD_SIGNING_KEYS,
});
