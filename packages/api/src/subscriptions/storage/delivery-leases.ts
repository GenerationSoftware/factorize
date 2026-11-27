import { type DatabaseClient } from "../../postgres/database";

import { installationCanReceiveMcpEvents, joinMcpInstallation } from "./mcp-event-outbox";

import { maxAttempts, maxRecoveryAttempts } from "../application/delivery-policy";

export type Claim = {
  tenant_id: string;
  subscription_id: string;
  occurrence_id: string;
  claim_id: string;
  generation: string;
  attempts: number;
  recovery: boolean;
  recovery_event_id: string | null;
  recovery_attempts: number;
};
const deliveryReady = `(
  (d.status IN ('pending','sending') AND d.ack_state IS DISTINCT FROM 'processed')
  OR (d.status='accepted' AND d.ack_state='awaiting_ack')
)`;
const deliveryDue = `CASE WHEN d.status='accepted' THEN d.ack_due_at ELSE d.next_attempt_at END`;
const pacedDue = `CASE WHEN s.generation=d.generation AND s.status='active' AND s.expires_at>statement_timestamp()
  THEN GREATEST(${deliveryDue},s.cooldown_until) ELSE ${deliveryDue} END`;

export async function claimDelivery(sql: DatabaseClient) {
  const { rows: [claim] } = await sql.query<Claim>(
    `WITH due AS (
       SELECT d.tenant_id,d.subscription_id,d.occurrence_id,(d.status='accepted') AS recovery
       FROM app.mcp_event_deliveries d JOIN app.mcp_event_subscriptions s
         ON (s.tenant_id,s.id)=(d.tenant_id,d.subscription_id)
       ${joinMcpInstallation}
       WHERE ${deliveryReady} AND ${installationCanReceiveMcpEvents} AND ${pacedDue}<=statement_timestamp()
       ORDER BY ${pacedDue},d.tenant_id,d.subscription_id,d.occurrence_id LIMIT 1 FOR UPDATE OF d SKIP LOCKED
     )
     UPDATE app.mcp_event_deliveries d SET
       status=CASE WHEN due.recovery THEN d.status ELSE 'sending' END,
       attempts=CASE WHEN due.recovery THEN d.attempts ELSE least(d.attempts+1,${maxAttempts + 1}) END,
       recovery_attempts=CASE WHEN due.recovery THEN least(d.recovery_attempts+1,${maxRecoveryAttempts + 1}) ELSE d.recovery_attempts END,
       recovery_event_id=CASE WHEN due.recovery THEN COALESCE(d.recovery_event_id,gen_random_uuid()) ELSE NULL END,
       ack_due_at=CASE WHEN due.recovery THEN clock_timestamp()+interval '60 seconds' ELSE d.ack_due_at END,
       claim_id=gen_random_uuid(),
       next_attempt_at=CASE WHEN due.recovery THEN d.next_attempt_at ELSE clock_timestamp()+interval '60 seconds' END,
       updated_at=CASE WHEN due.recovery THEN d.updated_at ELSE clock_timestamp() END
     FROM due WHERE (d.tenant_id,d.subscription_id,d.occurrence_id)=(due.tenant_id,due.subscription_id,due.occurrence_id)
     RETURNING d.tenant_id,d.subscription_id,d.occurrence_id,d.claim_id,d.generation,d.attempts,
       due.recovery,d.recovery_event_id,d.recovery_attempts`,
  );
  return claim;
}

export async function nextDeliveryDue(sql: DatabaseClient) {
  const { rows: [row] } = await sql.query<{ due_at: Date | null }>(
    `SELECT min(${pacedDue}) AS due_at FROM app.mcp_event_deliveries d JOIN app.mcp_event_subscriptions s
       ON (s.tenant_id,s.id)=(d.tenant_id,d.subscription_id)
     ${joinMcpInstallation}
     WHERE ${deliveryReady} AND ${installationCanReceiveMcpEvents} AND (d.ack_epoch IS NOT NULL OR s.cooldown_until IS NOT NULL)`,
  );
  return row?.due_at;
}
