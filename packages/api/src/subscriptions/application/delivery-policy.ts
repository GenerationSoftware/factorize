import { callbackAccepted, type WebhookOutcome } from "../delivery/mcp-webhook";

export const defaultLifetime = 24 * 60 * 60 * 1000;
export const maxLifetime = 7 * defaultLifetime;
export const maxAttempts = 5;
export const maxRecoveryAttempts = 4;
export const retryInterval = 15_000;

export function deliveryOutcome(outcome: WebhookOutcome, attempts: number) {
  if (callbackAccepted(outcome)) return { status: "accepted", reason: "accepted" };
  const status = outcome.status;
  const transient = outcome.reason !== "forbidden_destination" &&
    (status === undefined || status === 408 || status === 425 || status === 429 || status >= 500);
  return { status: transient && attempts < maxAttempts ? "pending" : "failed", reason: outcome.reason ?? (status ? "http_error" : "connection_failed") };
}

