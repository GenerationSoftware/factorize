export interface Env {
  SCHEDULER?: DurableObjectNamespace;
  ASSETS: Fetcher;
  APP_ORIGIN: string;
  CLOUDFLARE_OAUTH_CLIENT_ID?: string;
  CLOUDFLARE_OAUTH_CLIENT_SECRET?: string;
  CLOUDFLARE_OAUTH_READ_SCOPES?: string;
  CLOUDFLARE_OAUTH_DEFAULT_SCOPES?: string;
  MARKETING_ORIGIN?: string;
  TOTP_ENCRYPTION_KEY?: string;
  GOOGLE_SIGN_IN_START_LIMIT?: RateLimit;
  GOOGLE_SIGN_IN_CLIENT_ID?: string;
  GOOGLE_SIGN_IN_CLIENT_SECRET?: string;
  LINEAR_CLIENT_ID: string;
  LINEAR_CLIENT_SECRET: string;
  LINEAR_OAUTH_SCOPES?: string;
  LINEAR_WEBHOOK_SIGNING_SECRET: string;
  CLICKUP_CLIENT_ID?: string;
  CLICKUP_CLIENT_SECRET?: string;
  CREDENTIAL_ENCRYPTION_KEY: string;
  SESSION_SIGNING_SECRET: string;
  GITHUB_APP_ID?: string;
  GITHUB_APP_SLUG?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  GITHUB_WEBHOOK_SECRET?: string;
  RECOVERY_TIMEOUT_MS?: string;
  RECOVERY_MAX_ATTEMPTS?: string;
  OAUTH_KV?: KVNamespace;
  OAUTH_PROVIDER?: import("@cloudflare/workers-oauth-provider").OAuthHelpers;
  POSTMARK_SERVER_TOKEN?: string;
  POSTMARK_FROM_EMAIL?: string;
  POSTMARK_MESSAGE_STREAM?: string;
  PROXY_ARTIFACTS?: R2Bucket;
  HYPERDRIVE?: Hyperdrive;
  /** Test-only injection point; production uses HYPERDRIVE. */
  DATABASE?: import("../postgres/database").Database;
}
