import { withLockedDelivery, type DeliverySubscription } from "../storage/delivery-transaction";
import { appConfig, signingConfig } from "../../config/runtime";
import { decrypt } from "../../crypto";
import { deliveryEventName } from "../api/mcp-event-contracts";
import { callbackAccepted, sendMcpWebhook, type WebhookOutcome } from "../delivery/mcp-webhook";

import { databaseFor } from "../../postgres/database";

import type { Env } from "../../types";

import { activeGrantScopes } from "./subscription-access";

import { deliveryOutcome, maxAttempts, maxRecoveryAttempts } from "./delivery-policy";
import { type Claim, claimDelivery, nextDeliveryDue } from "../storage/delivery-leases";

export async function nextMcpDeliveryDelay(env: Env) {
  const dueAt = await nextDeliveryDue(databaseFor(env).pool);
  return dueAt ? Math.max(100, dueAt.getTime() - Date.now()) : 60_000;
}

function subscriptionActive(subscription: DeliverySubscription, claim: Claim) {
  return subscription.status === "active" && subscription.generation === claim.generation && subscription.expires_at.getTime() > Date.now();
}

async function dispatchClaim(env: Env, claim: Claim, now: () => number) {
  await withLockedDelivery(databaseFor(env), claim, async ({
    subscription, record, optIn, finishOriginal, finishRecovery, clearClaim, deferForCooldown, deferAuthorization,
    currentInstallation, authorize,
  }) => {
    async function cancel(reason: string) {
      if (claim.recovery) {
        await finishRecovery("cancelled");
      } else {
        await finishOriginal("cancelled", claim.attempts - 1, reason);
      }
    }
    if (record.ack_state === "processed") {
      await clearClaim();
      return;
    }
    if (record.source_identity.startsWith("cloudflareTail:")) {
      await cancel("source_retired");
      return;
    }
    if (!subscriptionActive(subscription, claim)) {
      await cancel("subscription_inactive");
      return;
    }
    if (claim.recovery && (!optIn || record.ack_state !== "awaiting_ack")) {
      await finishRecovery("cancelled");
      return;
    }
    if (subscription.cooldown_until && subscription.cooldown_until.getTime() > Date.now()) {
      await deferForCooldown();
      return;
    }
    // A replaceable credential can be absent, temporarily unverifiable, or
    // lack the selected scope. Pause without burning the claim or its ACK.
    const installation = await currentInstallation();
    const principal = installation
      ? installation.active_grant_id && installation.active_session_version != null &&
        { ...subscription, credential_id: installation.active_grant_id, session_version: installation.active_session_version }
      : subscription;
    let scopes: string[] | null = null;
    if (principal && !installation?.revoked_at) {
      try {
        scopes = await activeGrantScopes(env, principal);
      } catch {
        // A provider read failure is not proof of revocation.
      }
    }
    if (!principal || !scopes || !await authorize(principal, scopes) || !subscriptionActive(subscription, claim)) {
      await deferAuthorization();
      return;
    }
    if (claim.recovery && claim.recovery_attempts > maxRecoveryAttempts) {
      await finishRecovery("exhausted");
      return;
    }
    if (!claim.recovery && claim.attempts > maxAttempts) {
      await finishOriginal("failed", maxAttempts, "claim_interrupted");
      return;
    }
    const name = deliveryEventName(subscription.definition_id, subscription.arguments);
    if (record.definition_id !== subscription.definition_id || !name) {
      await cancel("event_mismatch");
      return;
    }
    const eventId = claim.recovery ? claim.recovery_event_id! : claim.occurrence_id;
    let result: WebhookOutcome;
    try {
      const secrets = [await decrypt(subscription.encrypted_secret, signingConfig(env).credentialKey)];
      if (subscription.previous_encrypted_secret && (subscription.rotated_at?.getTime() ?? 0) > Date.now() - 5 * 60_000) {
        secrets.push(await decrypt(subscription.previous_encrypted_secret, signingConfig(env).credentialKey));
      }
      result = await sendMcpWebhook(appConfig(env).origin, {
        url: subscription.callback_url,
        subscriptionId: claim.subscription_id,
        id: eventId,
        payload: {
          eventId, name, timestamp: record.occurred_at.toISOString(),
          data: { occurrenceId: claim.occurrence_id, definitionId: record.definition_id }, cursor: null,
        },
        secrets,
        now: now(),
      });
    } catch {
      result = { reason: "connection_failed" };
    }
    if (claim.recovery) {
      const delivered = callbackAccepted(result);
      const retryable = deliveryOutcome(result, claim.recovery_attempts).status === "pending";
      if (delivered) {
        const delay = subscription.ack_timeout_seconds +
          Math.min(3600, subscription.ack_timeout_seconds * (2 ** (claim.recovery_attempts - 1) - 1));
        await finishRecovery("awaiting_ack", delay);
      } else if (retryable && claim.recovery_attempts < maxRecoveryAttempts) {
        await finishRecovery("awaiting_ack", 15 * 2 ** (claim.recovery_attempts - 1), true);
      } else {
        await finishRecovery("exhausted");
      }
    } else {
      const outcome = deliveryOutcome(result, claim.attempts);
      await finishOriginal(outcome.status, claim.attempts, outcome.reason, result.status);
    }
  });
}

const dispatchConcurrency = 4;
const claimsPerWorker = 5;
export const mcpEventDispatchBatchSize = dispatchConcurrency * claimsPerWorker;

export async function dispatchMcpEvents(env: Env, now = Date.now) {
  const db = databaseFor(env), dispatchEnv = { ...env, DATABASE: db };
  let handled = 0;
  // Bound alarm work and connection count. A claimed row remains recoverable
  // after its lease, and the send transaction fences a concurrent reclaimer.
  await Promise.all(Array.from({ length: dispatchConcurrency }, async () => {
    for (let i = 0; i < claimsPerWorker; i++) {
      const claim = await claimDelivery(db.pool);
      if (!claim) break;
      handled++;
      try { await dispatchClaim(dispatchEnv, claim, now); }
      catch { throw new Error("Could not persist MCP event delivery outcome"); }
    }
  }));
  return handled;
}
