export type FilterType = "owner" | "creator" | "status" | "label" | "assignee";
export interface MatchRule { type: FilterType; targetId: string; }
export interface Env {
  FLY_VM_GRANTS_ENABLED?: string;
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
  DATABASE?: import("./postgres/database").Database;
}

export type OAuthProps = {
  tenantId: string;
  userId: string;
  sessionVersion: number;
  scopes: string[];
  accessTokenId?: string;
  /** Stable identifier for the OAuth authorization grant; never a bearer token. */
  oauthGrantId?: string;
  oauthClientId?: string;
  /** Explicit integration denials carried to this grant at browser consent. */
  initialIntegrationDenials?: string[];
  /** Expiry of the presented, verified OAuth access token. */
  oauthExpiresAt?: number;
  vmGrantId?: string;
  vmTokenExpiresAt?: number;
  authMethod?: "session" | "oauth" | "access_token" | "vm";
};

export interface WorkItem {
  provider: "linear" | "clickup" | "github" | "cloudflare";
  claimKey: string;
  identifier: string;
  title: string;
  description: string;
  url: string;
  event: Record<string, unknown>;
  repository?: Record<string, unknown>;
  pullRequest?: Record<string, unknown>;
}

export interface ExeConnectionInput {
  connectionId?: string;
  apiToken?: string;
}

export interface AmpConnectionInput { connectionId?: string; accessToken?: string; project?: string; apiBaseUrl?: string; }
export interface TailIntegrationInput { integrationId?: string; name: string; signingSecret?: string; generateSecret?: boolean; }
