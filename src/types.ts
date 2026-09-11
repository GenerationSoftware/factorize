export type FilterType = "owner" | "creator" | "status" | "label" | "assignee";
export interface MatchRule { type: FilterType; targetId: string; }
export type RunState = "queued" | "starting" | "running" | "done" | "blocked" | "failed" | "ignored";

export interface Env {
  TENANTS: DurableObjectNamespace;
  ASSETS: Fetcher;
  APP_ORIGIN: string;
  LINEAR_CLIENT_ID: string;
  LINEAR_CLIENT_SECRET: string;
  LINEAR_OAUTH_SCOPES?: string;
  LINEAR_WEBHOOK_SIGNING_SECRET: string;
  CREDENTIAL_ENCRYPTION_KEY: string;
  SESSION_SIGNING_SECRET: string;
}

export interface PipeInput {
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
