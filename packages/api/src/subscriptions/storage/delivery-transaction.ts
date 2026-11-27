import { getOAuthInstallation } from "../../oauth-installations";
import type { Database } from "../../postgres/database";
import { authorized, type Principal } from "../application/subscription-access";
import type { ProcessingSubscription } from "../application/subscription-processing";
import { retryInterval } from "../application/delivery-policy";
import type { Claim } from "./delivery-leases";
import { lockMcpEventGrant } from "./mcp-event-outbox";

export type DeliverySubscription = ProcessingSubscription & {
  arguments: unknown;
  callback_url: string;
  encrypted_secret: string;
  previous_encrypted_secret: string | null;
  rotated_at: Date | null;
};

type Occurrence = {
  occurred_at: Date; definition_id: string; source_identity: string;
  ack_epoch: string | null; ack_state: string | null;
};

type LockedDelivery = {
  subscription: DeliverySubscription;
  record: Occurrence;
  optIn: boolean;
  finishOriginal: (status: string, attempts: number, reason: string, httpStatus?: number) => Promise<unknown>;
  finishRecovery: (state: "awaiting_ack" | "cancelled" | "exhausted", delaySeconds?: number, retainId?: boolean) => Promise<unknown>;
  clearClaim: () => Promise<unknown>;
  deferForCooldown: () => Promise<unknown>;
  deferAuthorization: () => Promise<unknown>;
  currentInstallation: () => ReturnType<typeof getOAuthInstallation>;
  authorize: (principal: Principal, scopes: string[]) => Promise<boolean>;
};

/** Keep the grant, subscription and delivery locks alive across the service's
 * send decision and final write, in the same order as before. */
export async function withLockedDelivery(db: Database, claim: Claim, run: (delivery: LockedDelivery) => Promise<void>) {
  const key = [claim.tenant_id, claim.subscription_id, claim.occurrence_id, claim.claim_id];
  await db.transaction(async sql => {
    const { rows: [identity] } = await sql.query<{ grant_id: string }>(
      "SELECT grant_id FROM app.mcp_event_subscriptions WHERE tenant_id=$1 AND id=$2", key.slice(0, 2),
    );
    if (!identity) return;
    await lockMcpEventGrant(sql, claim.tenant_id, identity.grant_id, true);
    const { rows: [subscription] } = await sql.query<DeliverySubscription>(
      `SELECT * FROM app.mcp_event_subscriptions WHERE tenant_id=$1 AND id=$2 FOR NO KEY UPDATE`, key.slice(0, 2),
    );
    if (!subscription || subscription.grant_id !== identity.grant_id) return;
    const { rows: [record] } = await sql.query<Occurrence>(
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
    const clearClaim = () => sql.query(`UPDATE app.mcp_event_deliveries SET claim_id=NULL
        WHERE tenant_id=$1 AND subscription_id=$2 AND occurrence_id=$3 AND claim_id=$4`, key);
    const deferForCooldown = () => sql.query(`UPDATE app.mcp_event_deliveries SET claim_id=NULL,
         status=CASE WHEN $5 THEN status ELSE 'pending' END,
         attempts=CASE WHEN $5 THEN attempts ELSE greatest(attempts-1,0) END,
         recovery_attempts=CASE WHEN $5 THEN greatest(recovery_attempts-1,0) ELSE recovery_attempts END,
         ack_due_at=CASE WHEN $5 THEN clock_timestamp() ELSE ack_due_at END,
         next_attempt_at=CASE WHEN $5 THEN next_attempt_at ELSE clock_timestamp() END
        WHERE tenant_id=$1 AND subscription_id=$2 AND occurrence_id=$3 AND claim_id=$4`, [...key, claim.recovery]);
    const deferAuthorization = () => sql.query(`UPDATE app.mcp_event_deliveries SET claim_id=NULL,
      status=CASE WHEN $5 THEN status ELSE 'pending' END,
      attempts=CASE WHEN $5 THEN attempts ELSE greatest(attempts-1,0) END,
      recovery_attempts=CASE WHEN $5 THEN greatest(recovery_attempts-1,0) ELSE recovery_attempts END,
      ack_due_at=CASE WHEN $5 THEN clock_timestamp()+interval '60 seconds' ELSE ack_due_at END,
      next_attempt_at=CASE WHEN $5 THEN next_attempt_at ELSE clock_timestamp()+interval '60 seconds' END,
      last_outcome='authorization_inactive'
      WHERE tenant_id=$1 AND subscription_id=$2 AND occurrence_id=$3 AND claim_id=$4`, [...key, claim.recovery]);

    await run({
      subscription, record, optIn, finishOriginal, finishRecovery, clearClaim, deferForCooldown, deferAuthorization,
      currentInstallation: () => getOAuthInstallation(sql, subscription.tenant_id, subscription.user_id, subscription.grant_id),
      authorize: (principal, scopes) => authorized(sql, principal, scopes),
    });
  });
}
