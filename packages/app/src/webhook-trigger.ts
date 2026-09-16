import { matchingIssue } from "./matcher";
import type { MatchRule } from "./types";
import { validateHandlerCode } from "./custom-handler";

export type WebhookProvider = "linear" | "github" | "cloudflareTail";
export type WebhookTriggerConfig = {
  provider: WebhookProvider;
  projectId?: string; matchRules?: MatchRule[]; installationId?: number; repositoryId?: number;
  event?: string; action?: string; integrationId?: string; signingSecret?: string; secret?: string; handlerCode?: string;
};
export interface WebhookInvocation {
  claimKey: string; payload: Record<string, unknown>;
  occurrence: { externalId: string; metadata: Record<string, unknown> };
}

/** Pure provider adapter: matching and normalization only; it never launches execution. */
export function adaptWebhook(config: WebhookTriggerConfig, provider: WebhookProvider, deliveryId: string, payload: Record<string, any>, eventName?: string): WebhookInvocation | null {
  if (config.provider !== provider) return null;
  if (provider === "linear") {
    const data = payload.data ?? {}, projectId = data.project?.id ?? data.issue?.project?.id;
    if (!config.projectId || projectId !== config.projectId || !matchingIssue(payload, { projectId: config.projectId, matchRules: config.matchRules ?? [] })) return null;
  }
  if (provider === "github") {
    if (payload.installation?.id !== config.installationId || payload.repository?.id !== config.repositoryId) return null;
    if ((eventName ?? "") !== (config.event ?? "pull_request") || payload.action !== (config.action ?? "dequeued")) return null;
  }
  const normalizedProvider = provider === "cloudflareTail" ? "cloudflare" : provider;
  const providerAliases = provider === "linear"
    ? { issue: payload.data?.issue ?? (payload.type === "Issue" ? payload.data : undefined) }
    : {};
  return {
    claimKey: `webhook:${normalizedProvider}:${deliveryId}`,
    payload: { ...payload, ...providerAliases, provider: normalizedProvider, event: eventName ?? payload.type ?? "webhook", delivery_id: deliveryId },
    occurrence: { externalId: deliveryId, metadata: { provider: normalizedProvider, event: eventName ?? payload.type ?? "webhook", action: payload.action ?? null } },
  };
}

export function publicWebhookConfig(config: WebhookTriggerConfig): Record<string, unknown> {
  const { signingSecret: _signingSecret, secret: _secret, ...safe } = config;
  return { ...safe, ...(config.signingSecret || config.secret ? { secretConfigured: true } : {}) };
}

export function validateWebhookHandler(config: WebhookTriggerConfig): void {
  if (config.handlerCode !== undefined) validateHandlerCode(config.handlerCode);
}
