import type { WebhookConditions } from "./webhook-conditions";
import { matchingIssue } from "./matcher";
import type { MatchRule } from "../../types";
import { matchingGitHubIssue } from "./github-issue-matcher";

export type WebhookProvider = "linear" | "clickup" | "github" | "cloudflareTail";
export type WebhookEventConfig = {
  provider: WebhookProvider;
  projectId?: string; listId?: string; matchRules?: MatchRule[]; installationId?: number; repositoryId?: number;
  event?: string; action?: string; integrationId?: string; signingSecret?: string; secret?: string; conditions?: WebhookConditions;
};
export interface WebhookMatch { deduplicationKey: string; payload: Record<string, unknown>; }

/** Pure provider adapter: matching, normalization, and delivery deduplication. */
export function adaptWebhook(config: WebhookEventConfig, provider: WebhookProvider, deliveryId: string, payload: Record<string, any>, eventName?: string): WebhookMatch | null {
  if (config.provider !== provider) return null;
  if (provider === "linear") {
    const data = payload.data ?? {}, projectId = data.project?.id ?? data.issue?.project?.id;
    if (!config.projectId || projectId !== config.projectId || !matchingIssue(payload, { projectId: config.projectId, matchRules: config.matchRules ?? [] })) return null;
  }
  if (provider === "clickup" && (!config.listId || payload.task?.list?.id !== config.listId || payload.matches !== true)) return null;
  if (provider === "github") {
    if (payload.installation?.id !== config.installationId || payload.repository?.id !== config.repositoryId) return null;
    if (config.matchRules?.length) {
      if (eventName !== "issues" || !matchingGitHubIssue(payload, config.matchRules)) return null;
    } else if ((eventName ?? "") !== (config.event ?? "pull_request") || payload.action !== (config.action ?? "dequeued")) return null;
  }
  const normalizedProvider = provider === "cloudflareTail" ? "cloudflare" : provider;
  const providerAliases = provider === "linear"
    ? { issue: payload.data?.issue ?? (payload.type === "Issue" ? payload.data : undefined) }
    : provider === "clickup" ? { task: payload.task } : {};
  return {
    deduplicationKey: `webhook:${normalizedProvider}:${deliveryId}`,
    payload: { ...payload, ...providerAliases, provider: normalizedProvider, event: eventName ?? payload.type ?? "webhook", delivery_id: deliveryId },
  };
}

export function publicWebhookConfig(config: WebhookEventConfig): Record<string, unknown> {
  const { signingSecret: _signingSecret, secret: _secret, ...safe } = config;
  return { ...safe, ...(config.signingSecret || config.secret ? { secretConfigured: true } : {}) };
}
