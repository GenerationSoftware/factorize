export type FilterType = "owner" | "creator" | "status" | "label" | "assignee";
export interface MatchRule { type: FilterType; targetId: string; }
export type RunState = "queued" | "reserved" | "starting" | "running" | "done" | "blocked" | "failed" | "ignored" | "stopping" | "stopped" | "succeeded";

export interface Env {
  /** Explicit local test environment; never configured on deployed Workers. */
  TEST_DOCKER_EXECUTION?: { enabled: true; image: string };
  /** Infrastructure host boundary. Host process credentials stay outside Workers. */
  CREDENTIAL_PROXY_HOST?: { setup(tenantId: string, operationId: string): Promise<{ proxyIdentity: string; bootEpoch: string }> };
  SCHEDULER?: DurableObjectNamespace;
  ASSETS: Fetcher;
  APP_ORIGIN: string;
  MARKETING_ORIGIN?: string;
  LINEAR_CLIENT_ID: string;
  LINEAR_CLIENT_SECRET: string;
  LINEAR_OAUTH_SCOPES?: string;
  LINEAR_WEBHOOK_SIGNING_SECRET: string;
  CLICKUP_CLIENT_ID?: string;
  CLICKUP_CLIENT_SECRET?: string;
  CREDENTIAL_ENCRYPTION_KEY: string;
  SESSION_SIGNING_SECRET: string;
  /** PKCS#8 Ed25519 key used only for short-lived proxy browser capabilities. */
  MODEL_ACCOUNT_CAPABILITY_PRIVATE_KEY?: string;
  MODEL_ACCOUNT_CAPABILITY_PUBLIC_KEY?: string;
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
  RUN_ARTIFACTS?: R2Bucket;
  /** Pause automatic retention and artifact-history deletion while retaining maintenance visibility. */
  RUN_HISTORY_RETENTION_PAUSED?: string;
  TRACE_PRIMARY_MODE?: "execution_stream" | "native_session";
  TRACE_STREAM_TENANTS?: string;
  /** OpenAI-compatible Codex endpoint configured for the execution environment. */
  CODEX_MODEL_BASE_URL?: string;
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
  /** Set only by a verified, active execution credential. */
  runId?: string;
  runJobId?: string;
  runCredentialDigest?: string;
  /** Stable identifier for the OAuth authorization grant; never a bearer token. */
  oauthGrantId?: string;
  oauthClientId?: string;
  authMethod?: "session" | "oauth" | "access_token" | "run_token";
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
  tags?: string[];
  agentKind?: "codex" | "claude" | "pi";
}

export interface AmpConnectionInput { connectionId?: string; accessToken?: string; project?: string; apiBaseUrl?: string; }
export interface TailIntegrationInput { integrationId?: string; name: string; signingSecret?: string; generateSecret?: boolean; }
