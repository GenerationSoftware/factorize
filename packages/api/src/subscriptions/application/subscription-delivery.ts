import { decrypt } from "../../crypto";
import { deliveryEventName } from "../api/mcp-event-contracts";
import { callbackAccepted, sendMcpWebhook, type WebhookOutcome } from "../delivery/mcp-webhook";
import { getOAuthInstallation } from "../../oauth-installations";

import { databaseFor } from "../../postgres/database";

import { lockMcpEventGrant } from "../storage/mcp-event-outbox";
import type { Env } from "../../types";

import { activeGrantScopes, authorized } from "./subscription-access";
import { type ProcessingSubscription } from "./subscription-processing";
import { deliveryOutcome, maxAttempts, maxRecoveryAttempts, retryInterval } from "./delivery-policy";
import { type Claim, claimDelivery, nextDeliveryDue } from "../storage/delivery-leases";

type Subscription = ProcessingSubscription & {
  arguments: unknown;
  callback_url: string;
  encrypted_secret: string;
  previous_encrypted_secret: string | null;
  rotated_at: Date | null;
};

export async function nextMcpDeliveryDelay(env: Env) {
  const dueAt = await nextDeliveryDue(databaseFor(env).pool);
  return dueAt ? Math.max(100, dueAt.getTime() - Date.now()) : 60_000;
}

function subscriptionActive(subscription: Subscription, claim: Claim) {
  return subscription.status === "active" && subscription.generation === claim.generation && subscription.expires_at.getTime() > Date.now();
}

async function dispatchClaim(env: Env, claim: Claim, now: () => number) {
  const db = databaseFor(env);
  const key = [claim.tenant_id, claim.subscription_id, claim.occurrence_id, claim.claim_id];
  await db.transaction(async sql => {
    const { rows: [identity] } = await sql.query<{ grant_id: string }>(
      "SELECT grant_id FROM app.mcp_event_subscriptions WHERE tenant_id=$1 AND id=$2", key.slice(0, 2),
    );
    if (!identity) return;
    await lockMcpEventGrant(sql, claim.tenant_id, identity.grant_id, true);
    const { rows: [subscription] } = await sql.query<Subscription>(
      `SELECT * FROM app.mcp_event_subscriptions WHERE tenant_id=$1 AND id=$2 FOR NO KEY UPDATE`, key.slice(0, 2),
    );
    if (!subscription || subscription.grant_id !== identity.grant_id) return;
    const { rows: [record] } = await sql.query<{ occurred_at: Date; definition_id: string; source_identity: string; ack_epoch: string | null; ack_state: string | null }>(
      `SELECT o.occurred_at,o.definition_id,o.source_identity,d.ack_epoch,d.ack_state FROM app.mcp_event_deliveries d
       JOIN app.event_occurrences o ON o.tenant_id=d.tenant_id AND o.id=d.occurrence_id
       WHERE d.tenant_id=$1 AND d.subscription_id=$2 AND d.occurrence_id=$3 AND d.claim_id=$4 FOR UPDATE OF d`, key,
    );
    if (!record) return;
    const optIn = record.ack_epoch !== null && subscription.ack_epoch === record.ack_epoch;
    const finishOriginal = (status: string, attempts: number, reason: string, httpStatus?: number) => sql.query(
      `UPDATE app.mcp_event_deliveries SET status=$5,claim_id=NULL,attempts=$6,last_outcome=$7,http_status=$8,
         next_attempt_at=clock_timestamp()+$9*interval '1 millisecond',updated_at=clock_timestamp(),
         ack_state=CASE WHEN ack_state='pending' AND $5='cancelled' THEN 'cancelled'
           WHEN ack_state='pending' AND $5='accepted' AND $10 THEN 'awaiting_ack' ELSE ack_state END,
         ack_due_at=CASE WHEN ack_state='pending' AND $5='accepted' AND $10
           THEN clock_timestamp()+make_interval(secs=>$11) ELSE ack_due_at END,
         ack_updated_at=CASE WHEN ack_state='pending' AND ($5='cancelled' OR ($5='accepted' AND $10))
           THEN clock_timestamp() ELSE ack_updated_at END
       WHERE tenant_id=$1 AND subscription_id=$2 AND occurrence_id=$3 AND claim_id=$4`,
      [...key, status, attempts, reason, httpStatus ?? null, retryInterval * 2 ** Math.max(attempts - 1, 0),
        optIn, subscription.ack_timeout_seconds],
    );
    const finishRecovery = (state: "awaiting_ack" | "cancelled" | "exhausted", delaySeconds = 0, retainId = false) =>
      sql.query(`UPDATE app.mcp_event_deliveries SET claim_id=NULL,ack_state=$5,ack_updated_at=clock_timestamp(),
        ack_due_at=CASE WHEN $5='awaiting_ack' THEN clock_timestamp()+make_interval(secs=>$6) END,
        recovery_event_id=CASE WHEN $7 THEN recovery_event_id END
        WHERE tenant_id=$1 AND subscription_id=$2 AND occurrence_id=$3 AND claim_id=$4 AND ack_state='awaiting_ack'`,
      [...key, state, delaySeconds, retainId]);
    async function cancel(reason: string) {
      if (claim.recovery) {
        await finishRecovery("cancelled");
      } else {
        await finishOriginal("cancelled", claim.attempts - 1, reason);
      }
    }
    if (record.ack_state === "processed") {
      await sql.query(`UPDATE app.mcp_event_deliveries SET claim_id=NULL
        WHERE tenant_id=$1 AND subscription_id=$2 AND occurrence_id=$3 AND claim_id=$4`, key);
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
      await sql.query(`UPDATE app.mcp_event_deliveries SET claim_id=NULL,
         status=CASE WHEN $5 THEN status ELSE 'pending' END,
         attempts=CASE WHEN $5 THEN attempts ELSE greatest(attempts-1,0) END,
         recovery_attempts=CASE WHEN $5 THEN greatest(recovery_attempts-1,0) ELSE recovery_attempts END,
         ack_due_at=CASE WHEN $5 THEN clock_timestamp() ELSE ack_due_at END,
         next_attempt_at=CASE WHEN $5 THEN next_attempt_at ELSE clock_timestamp() END
        WHERE tenant_id=$1 AND subscription_id=$2 AND occurrence_id=$3 AND claim_id=$4`, [...key, claim.recovery]);
      return;
    }
    // A replaceable credential can be absent, temporarily unverifiable, or
    // lack the selected scope. Pause without burning the claim or its ACK.
    const deferAuthorization = () => sql.query(`UPDATE app.mcp_event_deliveries SET claim_id=NULL,
      status=CASE WHEN $5 THEN status ELSE 'pending' END,
      attempts=CASE WHEN $5 THEN attempts ELSE greatest(attempts-1,0) END,
      recovery_attempts=CASE WHEN $5 THEN greatest(recovery_attempts-1,0) ELSE recovery_attempts END,
      ack_due_at=CASE WHEN $5 THEN clock_timestamp()+interval '60 seconds' ELSE ack_due_at END,
      next_attempt_at=CASE WHEN $5 THEN next_attempt_at ELSE clock_timestamp()+interval '60 seconds' END,
      last_outcome='authorization_inactive'
      WHERE tenant_id=$1 AND subscription_id=$2 AND occurrence_id=$3 AND claim_id=$4`, [...key, claim.recovery]);
    const installation = await getOAuthInstallation(sql, subscription.tenant_id, subscription.user_id, subscription.grant_id);
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
    if (!principal || !scopes || !await authorized(sql, principal, scopes) || !subscriptionActive(subscription, claim)) {
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
      const secrets = [await decrypt(subscription.encrypted_secret, env.CREDENTIAL_ENCRYPTION_KEY)];
      if (subscription.previous_encrypted_secret && (subscription.rotated_at?.getTime() ?? 0) > Date.now() - 5 * 60_000) {
        secrets.push(await decrypt(subscription.previous_encrypted_secret, env.CREDENTIAL_ENCRYPTION_KEY));
      }
      result = await sendMcpWebhook(env.APP_ORIGIN, {
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
