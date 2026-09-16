import { matchingIssue } from "./matcher";
import type { MatchRule } from "./types";

export type WebhookProvider = "linear" | "github" | "cloudflareTail" | "custom";
export type WebhookTriggerConfig = {
  provider: WebhookProvider; context?: string; parameters?: Record<string, string>;
  projectId?: string; matchRules?: MatchRule[]; installationId?: number; repositoryId?: number;
  event?: string; action?: string; signingSecret?: string; secret?: string; handlerCode?: string;
};
export interface WebhookInvocation {
  claimKey: string; context: string; parameters: Record<string, string>;
  occurrence: { externalId: string; metadata: Record<string, unknown> };
}

const strings = (value: unknown): Record<string, string> => value && typeof value === "object" && !Array.isArray(value)
  ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string")) : {};

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
  return {
    claimKey: `webhook:${normalizedProvider}:${deliveryId}`,
    context: config.context ?? JSON.stringify(payload),
    parameters: { ...strings(config.parameters), provider: normalizedProvider, event: eventName ?? String(payload.type ?? "webhook"), deliveryId },
    occurrence: { externalId: deliveryId, metadata: { provider: normalizedProvider, event: eventName ?? payload.type ?? "webhook", action: payload.action ?? null } },
  };
}

export function publicWebhookConfig(config: WebhookTriggerConfig): Record<string, unknown> {
  const { signingSecret: _signingSecret, secret: _secret, ...safe } = config;
  return { ...safe, ...(config.signingSecret || config.secret ? { secretConfigured: true } : {}) };
}
