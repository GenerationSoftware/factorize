import { ProtocolError, ProtocolErrorCode } from "@modelcontextprotocol/server";
import type { z } from "zod";

import { type setProcessingAcknowledgmentsInput, type acknowledgeEventsInput } from "../api/mcp-event-contracts";

import { databaseFor, type DatabaseClient } from "../../postgres/database";
import { wakeMcpDeliveries } from "./wake-delivery";
import { lockEventOutbox, lockMcpEventGrant } from "../storage/mcp-event-outbox";
import type { Env, OAuthProps } from "../../types";

import { type Principal, activeGrantScopes, authorized } from "./subscription-access";
import { requestPrincipal, forbidden } from "./subscription-lifecycle";

export type ProcessingSubscription = Principal & {
  id: string; definition_id: string; generation: string;
  status: string; expires_at: Date;
  ack_epoch: string | null; ack_timeout_seconds: number; cooldown_until: Date | null;
};

async function withProcessingSubscription<T>(env: Env, auth: OAuthProps, id: string,
  action: (sql: DatabaseClient, subscription: ProcessingSubscription) => Promise<T>) {
  const principal = requestPrincipal(auth);
  const scoped = [auth.tenantId, id, auth.userId, principal.grant_id, principal.client_id];
  const owns = "tenant_id=$1 AND id=$2 AND user_id=$3 AND grant_id=$4 AND client_id=$5";
  return databaseFor(env).transaction(async sql => {
    await lockMcpEventGrant(sql, auth.tenantId, principal.grant_id, true);
    const { rows: [current] } = await sql.query<{ definition_id: string }>(
      `SELECT definition_id FROM app.mcp_event_subscriptions WHERE ${owns}`, scoped,
    );
    if (!current) throw forbidden();
    await lockEventOutbox(sql, auth.tenantId, current.definition_id);
    const { rows: [row] } = await sql.query<ProcessingSubscription>(
      `SELECT * FROM app.mcp_event_subscriptions WHERE ${owns} AND status='active'
        AND expires_at>clock_timestamp() FOR NO KEY UPDATE`, scoped,
    );
    const scopes = row && (auth.oauthInstallationId || row.session_version === auth.sessionVersion) &&
      await activeGrantScopes(env, principal);
    if (!scopes || !await authorized(sql, principal, scopes)) throw forbidden();
    return action(sql, row);
  });
}

function processingSettings(row: ProcessingSubscription) {
  return {
    subscriptionId: row.id, enabled: row.ack_epoch !== null,
    ackTimeoutSeconds: row.ack_timeout_seconds, cooldownUntil: row.cooldown_until?.toISOString() ?? null,
  };
}

export async function getProcessingAcknowledgments(env: Env, auth: OAuthProps, subscriptionId: string) {
  return withProcessingSubscription(env, auth, subscriptionId, async (_sql, row) => processingSettings(row));
}

export async function setProcessingAcknowledgments(env: Env, auth: OAuthProps, input: z.infer<typeof setProcessingAcknowledgmentsInput>) {
  if (!input.enabled && input.ack_timeout_seconds !== undefined) {
    throw new ProtocolError(ProtocolErrorCode.InvalidParams, "Set an acknowledgment timeout only when enabling acknowledgments.");
  }
  const result = await withProcessingSubscription(env, auth, input.subscription_id, async (sql, row) => {
    if (!input.enabled && row.ack_epoch) {
      await sql.query(`UPDATE app.mcp_event_deliveries SET ack_state='waived',ack_due_at=NULL,
        ack_updated_at=clock_timestamp(),recovery_event_id=NULL,
        claim_id=CASE WHEN status='accepted' THEN NULL ELSE claim_id END
        WHERE tenant_id=$1 AND subscription_id=$2 AND generation=$3 AND ack_epoch=$4
          AND ack_state IN ('pending','awaiting_ack','exhausted')`, [row.tenant_id, row.id, row.generation, row.ack_epoch]);
    }
    const { rows: [updated] } = await sql.query<ProcessingSubscription>(
      `UPDATE app.mcp_event_subscriptions SET
         ack_epoch=CASE WHEN $3 THEN COALESCE(ack_epoch,gen_random_uuid()) ELSE NULL END,
         ack_timeout_seconds=COALESCE($4,ack_timeout_seconds),
         cooldown_until=CASE WHEN $3 THEN cooldown_until END
       WHERE tenant_id=$1 AND id=$2 RETURNING *`,
      [row.tenant_id, row.id, input.enabled, input.ack_timeout_seconds ?? null],
    );
    return processingSettings(updated);
  });
  await wakeMcpDeliveries(env).catch(() => {});
  return result;
}

export async function acknowledgeEvents(env: Env, auth: OAuthProps, input: z.infer<typeof acknowledgeEventsInput>) {
  const result = await withProcessingSubscription(env, auth, input.subscription_id, async (sql, row) => {
    const { rows } = await sql.query<{ occurrence_id: string }>(
      `UPDATE app.mcp_event_deliveries SET ack_state='processed',ack_due_at=NULL,ack_updated_at=clock_timestamp(),
        recovery_event_id=NULL,claim_id=CASE WHEN status='accepted' THEN NULL ELSE claim_id END
       WHERE tenant_id=$1 AND subscription_id=$2 AND generation=$3 AND ack_epoch=$4
         AND occurrence_id=ANY($5::uuid[]) AND ack_state IN ('pending','awaiting_ack','exhausted')
         AND (last_outcome IS NOT NULL OR status='accepted') RETURNING occurrence_id`,
      [row.tenant_id, row.id, row.generation, row.ack_epoch, input.event_ids],
    );
    const changed = new Set(rows.map(item => item.occurrence_id));
    const { rows: processed } = await sql.query<{ occurrence_id: string }>(
      `SELECT occurrence_id FROM app.mcp_event_deliveries
       WHERE tenant_id=$1 AND subscription_id=$2 AND generation=$3 AND occurrence_id=ANY($4::uuid[])
         AND ack_state='processed'`, [row.tenant_id, row.id, row.generation, input.event_ids],
    );
    let cooldownUntil = row.cooldown_until;
    if (changed.size && input.cooldown_seconds) {
      const { rows: [updated] } = await sql.query<{ cooldown_until: Date }>(
        `WITH cooldown AS (SELECT clock_timestamp() AS starts_at),
         candidate AS (SELECT starts_at,starts_at+make_interval(secs=>$3) AS ends_at FROM cooldown)
         UPDATE app.mcp_event_subscriptions AS s
         SET cooldown_until=GREATEST(s.cooldown_until,c.ends_at),
             last_cooldown_started_at=CASE WHEN s.cooldown_until IS NULL OR c.ends_at>s.cooldown_until
               THEN c.starts_at ELSE s.last_cooldown_started_at END,
             last_cooldown_ends_at=CASE WHEN s.cooldown_until IS NULL OR c.ends_at>s.cooldown_until
               THEN c.ends_at ELSE s.last_cooldown_ends_at END
         FROM candidate c WHERE s.tenant_id=$1 AND s.id=$2 RETURNING s.cooldown_until`,
        [row.tenant_id, row.id, input.cooldown_seconds],
      );
      cooldownUntil = updated.cooldown_until;
    }
    const done = new Set(processed.map(item => item.occurrence_id));
    return {
      subscriptionId: row.id, acknowledged: input.event_ids.filter(id => changed.has(id)),
      alreadyAcknowledged: input.event_ids.filter(id => done.has(id) && !changed.has(id)),
      notAcknowledged: input.event_ids.filter(id => !done.has(id)),
      cooldownUntil: cooldownUntil?.toISOString() ?? null,
    };
  });
  await wakeMcpDeliveries(env).catch(() => {});
  return result;
}

export async function replayUnacknowledgedEvents(env: Env, auth: OAuthProps, subscriptionId: string, eventIds: string[]) {
  const result = await withProcessingSubscription(env, auth, subscriptionId, async (sql, row) => {
    const { rows } = await sql.query<{ occurrence_id: string }>(
      `UPDATE app.mcp_event_deliveries SET
        next_attempt_at=CASE WHEN status='failed' THEN clock_timestamp() ELSE next_attempt_at END,
        attempts=CASE WHEN status='failed' THEN 0 ELSE attempts END,
        status=CASE WHEN status='failed' THEN 'pending' ELSE status END,
        ack_due_at=CASE WHEN status='accepted' THEN clock_timestamp() END,ack_updated_at=clock_timestamp(),
        recovery_attempts=CASE WHEN ack_state='exhausted' THEN 0 ELSE recovery_attempts END,
        ack_state=CASE WHEN status='accepted' THEN 'awaiting_ack' ELSE 'pending' END
       WHERE tenant_id=$1 AND subscription_id=$2 AND generation=$3 AND ack_epoch=$4
         AND occurrence_id=ANY($5::uuid[]) AND claim_id IS NULL AND (
           (status='accepted' AND (ack_state='exhausted' OR (ack_state='awaiting_ack' AND ack_due_at>clock_timestamp())))
           OR (status='failed' AND ack_state='pending')
         )
       RETURNING occurrence_id`, [row.tenant_id, row.id, row.generation, row.ack_epoch, eventIds],
    );
    const replay = new Set(rows.map(item => item.occurrence_id));
    return { subscriptionId, queued: eventIds.filter(id => replay.has(id)), notQueued: eventIds.filter(id => !replay.has(id)) };
  });
  await wakeMcpDeliveries(env).catch(() => {});
  return result;
}

