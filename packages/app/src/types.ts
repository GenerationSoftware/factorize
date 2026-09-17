export type FilterType = "owner" | "creator" | "status" | "label" | "assignee";
export interface MatchRule { type: FilterType; targetId: string; }
export type RunState = "queued" | "starting" | "running" | "recovering" | "done" | "blocked" | "failed" | "ignored" | "stopping" | "stopped" | "succeeded";

export interface Env {
  TENANTS: DurableObjectNamespace;
  GITHUB_INSTALLATIONS?: DurableObjectNamespace;
  ASSETS: Fetcher;
  APP_ORIGIN: string;
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
}

export type OAuthProps = {
  tenantId: string;
  userId: string;
  sessionVersion: number;
  scopes: string[];
  accessTokenId?: string;
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
  vmName: string;
  apiToken: string;
  agentKind: "claude" | "codex" | "pi" | string;
  cwd: string;
  herdrCommand?: string;
  /** Arguments passed to Herdr's canonical executable for the selected kind. */
  agentCommand?: string;
  models?: string[];
  modelsRefreshedAt?: string;
  efforts?: string[];
}

export interface AmpConnectionInput { connectionId?: string; accessToken: string; project: string; apiBaseUrl?: string; }
export interface TailIntegrationInput { integrationId?: string; name: string; signingSecret?: string; generateSecret?: boolean; }
