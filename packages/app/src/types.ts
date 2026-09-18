export type FilterType = "owner" | "creator" | "status" | "label" | "assignee";
export interface MatchRule { type: FilterType; targetId: string; }
export type RunState = "queued" | "starting" | "running" | "done" | "blocked" | "failed" | "ignored" | "stopping" | "stopped" | "succeeded";

export interface Env {
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
  GITHUB_APP_ID?: string;
  GITHUB_APP_SLUG?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  GITHUB_WEBHOOK_SECRET?: string;
  CUSTOM_HANDLER_LOADER?: WorkerLoader;
  RECOVERY_TIMEOUT_MS?: string;
  RECOVERY_MAX_ATTEMPTS?: string;
  OAUTH_KV?: KVNamespace;
  OAUTH_PROVIDER?: import("@cloudflare/workers-oauth-provider").OAuthHelpers;
  AUTH_RESET_RETURN_TOKEN?: string;
  RUN_ARTIFACTS?: R2Bucket;
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
  authMethod?: "session" | "oauth" | "access_token";
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
  apiToken: string;
  tags?: string[];
  agentKind: "codex" | "claude" | "pi";
}

export interface AmpConnectionInput { connectionId?: string; accessToken: string; project: string; apiBaseUrl?: string; }
export interface TailIntegrationInput { integrationId?: string; name: string; signingSecret?: string; generateSecret?: boolean; }
