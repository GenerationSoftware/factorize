export type FilterType = "owner" | "creator" | "status" | "label" | "assignee";
export interface MatchRule { type: FilterType; targetId: string; }
export type RunState = "queued" | "starting" | "running" | "recovering" | "done" | "blocked" | "failed" | "ignored";

export interface Env {
  TENANTS: DurableObjectNamespace;
  GITHUB_INSTALLATIONS?: DurableObjectNamespace;
  ASSETS: Fetcher;
  APP_ORIGIN: string;
  LINEAR_CLIENT_ID: string;
  LINEAR_CLIENT_SECRET: string;
  LINEAR_OAUTH_SCOPES?: string;
  LINEAR_WEBHOOK_SIGNING_SECRET: string;
  CREDENTIAL_ENCRYPTION_KEY: string;
  SESSION_SIGNING_SECRET: string;
  GITHUB_APP_ID?: string;
  GITHUB_APP_SLUG?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  GITHUB_WEBHOOK_SECRET?: string;
  GITHUB_INTEGRATION_ENABLED?: string;
  CUSTOM_SOURCES_ENABLED?: string;
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
};

export type CustomOrigin = "linear" | "github";
export type CustomSource = { kind: "custom"; origin: CustomOrigin; handlerName: string; handlerCode: string; handlerDeployment: { scriptName: string; codeDigest: string; state: "deploying" | "ready" | "failed"; lastError?: string } };

export type FlowSource =
  | { kind: "linear"; projectId: string; matchRules: MatchRule[] }
  | { kind: "github"; installationId: number; repositoryId: number; repositoryOwner?: string; repositoryName?: string; repositoryFullName?: string; baseRef: "main"; trigger: "merge_queue_conflict" }
  | CustomSource;

export interface WorkItem {
  provider: "linear" | "github";
  claimKey: string;
  identifier: string;
  title: string;
  description: string;
  url: string;
  event: Record<string, unknown>;
  repository?: Record<string, unknown>;
  pullRequest?: Record<string, unknown>;
}

export interface PipeInput {
  /** Edge-generated immutable identifier; never accepted from browser callers. */
  pipeId?: string;
  name: string;
  /** Optional stable, machine-friendly identifier; defaults from the name. */
  flowId?: string;
  projectId: string;
  /** At least one rule is required. All rules must match the issue. */
  matchRules?: MatchRule[];
  /** Legacy single-rule input, retained so existing API clients keep working. */
  filterType?: FilterType;
  filterTargetId?: string;
  maxConcurrency: number;
  workspaceName?: string;
  /** Mustache template rendered with the Linear webhook payload for each run. */
  contextTemplate?: string;
  /** Saved exe.dev connection selected for this flow. */
  exeConnectionId?: string;
  /** Mustache template for the working directory; receives `flowId`. */
  cwd?: string;
  source?: FlowSource;
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
}
