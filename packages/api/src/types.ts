export type FilterType = "owner" | "creator" | "status" | "label" | "assignee";
export interface MatchRule { type: FilterType; targetId: string; }
export type { Env } from "./config/bindings";

export type OAuthProps = {
  tenantId: string;
  userId: string;
  sessionVersion: number;
  scopes: string[];
  accessTokenId?: string;
  /** Current provider grant, changed when an installation is reauthorized. */
  oauthGrantId?: string;
  /** Server-issued stable connection anchor; never used as a credential. */
  oauthInstallationId?: string;
  oauthIssuanceId?: string;
  oauthClientId?: string;
  /** Explicit integration denials carried to this grant at browser consent. */
  initialIntegrationDenials?: string[];
  explicitIntegrationScopes?: boolean;
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
