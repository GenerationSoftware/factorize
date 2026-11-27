import { ProtocolError, ProtocolErrorCode } from "@modelcontextprotocol/server";
import type { z } from "zod";
import { normalizeScopes } from "./access-tokens";
import { decrypt, encrypt } from "./crypto";
import { eventDefinitionId, deliveryEventName, type subscribeEventInput, type unsubscribeEventInput, type setProcessingAcknowledgmentsInput, type acknowledgeEventsInput } from "./mcp-event-contracts";
import { callbackAccepted, canonicalCallbackURL, canonicalWebhookSecret, sendMcpWebhook, validChallenge, type WebhookOutcome } from "./mcp-webhook";
import { getOAuthInstallation, installationScopes } from "./oauth-installations";
import { applyConnectionScopes, type ConnectionScopePolicy } from "./oauth-connection-settings";
import { databaseFor, type DatabaseClient } from "./postgres/database";
import { wakeMcpDeliveries } from "./events/storage/event-match-repository";
import { installationCanReceiveMcpEvents, joinMcpInstallation, lockEventOutbox, lockMcpEventGrant } from "./postgres/mcp-event-outbox";
import type { Env, OAuthProps } from "./types";

const defaultLifetime = 24 * 60 * 60 * 1000;
const maxLifetime = 7 * defaultLifetime;
const maxAttempts = 5;
const maxRecoveryAttempts = 4;
const retryInterval = 15_000;

type Principal = {
  tenant_id: string;
  user_id: string;
  grant_id: string; // Stable OAuth installation, or the original grant for legacy registrations.
  credential_id?: string;
  client_id: string;
  session_version: number;
};

async function activeGrantScopes(env: Env, principal: Principal): Promise<string[] | null> {
  if (!env.OAUTH_PROVIDER) throw new Error("OAuth management unavailable");
  let cursor: string | undefined;
  do {
    const page = await env.OAUTH_PROVIDER.listUserGrants(principal.user_id, { limit: 100, cursor });
    const grant = page.items.find(item => item.id === (principal.credential_id ?? principal.grant_id));
    if (grant) {
      if (grant.clientId !== principal.client_id || grant.metadata?.tenantId !== principal.tenant_id ||
          (grant.expiresAt != null && grant.expiresAt <= Date.now() / 1000)) return null;
      return normalizeScopes(grant.scope);
    }
    cursor = page.cursor;
  } while (cursor);
  return null;
}

async function authorized(sql: DatabaseClient, principal: Principal, scopes: string[]) {
  const member = await sql.query(`SELECT 1 FROM app.members m JOIN app.auth_users u ON u.id=m.user_id
    WHERE m.tenant_id=$1 AND m.user_id=$2 AND m.role='owner' AND m.session_version=$3 AND u.email_verified
    FOR SHARE OF m,u`, [principal.tenant_id, principal.user_id, principal.session_version]);
  if (!member.rowCount) return false;
  const installation = await getOAuthInstallation(sql, principal.tenant_id, principal.user_id, principal.grant_id);
  if (installation) return !installation.revoked_at && installation.client_id === principal.client_id &&
    installation.active_grant_id === (principal.credential_id ?? principal.grant_id) &&
    installation.active_session_version === principal.session_version && scopes.includes("triggers:read") &&
    installationScopes(installation).includes("triggers:read");
  if (principal.credential_id && principal.credential_id !== principal.grant_id) return false;
  const { rows: [policy] } = await sql.query<ConnectionScopePolicy & { revoked_at: Date | null }>(
    `SELECT revoked_at,disabled_scopes,scope_overrides FROM app.agent_identities
     WHERE tenant_id=$1 AND kind='oauth' AND subject=$2 AND user_id=$3 FOR SHARE`,
    [principal.tenant_id, principal.grant_id, principal.user_id],
  );
  return !policy?.revoked_at && applyConnectionScopes(scopes, policy).includes("triggers:read");
}

async function digest(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

function forbidden() {
  return new ProtocolError(-32024, "The OAuth grant is not authorized for this event.");
}

function requestPrincipal(auth: OAuthProps): Principal {
  if (auth.authMethod !== "oauth" || !auth.oauthGrantId || !auth.oauthClientId ||
      !auth.scopes.includes("triggers:read")) throw forbidden();
  return {
    tenant_id: auth.tenantId, user_id: auth.userId, grant_id: auth.oauthInstallationId ?? auth.oauthGrantId,
    credential_id: auth.oauthGrantId, client_id: auth.oauthClientId, session_version: auth.sessionVersion,
  };
}

async function subscriptionKey(auth: OAuthProps, input: z.infer<typeof unsubscribeEventInput>) {
  const principal = requestPrincipal(auth);
  const url = canonicalCallbackURL(input.delivery.url);
  if (!url) throw new ProtocolError(ProtocolErrorCode.InvalidParams, "Expected an HTTPS callback URL without credentials or a fragment.");
  // Validated arguments have one canonical representation per event and protocol.
  const args = JSON.stringify(input.arguments);
  const id = "sub_" + await digest(JSON.stringify([auth.tenantId, auth.userId, principal.grant_id, url, input.name, args]));
  return { id, url, args, principal, definitionId: eventDefinitionId(input) };
}

export async function subscribeMcpEvent(env: Env, auth: OAuthProps, input: z.infer<typeof subscribeEventInput>) {
  const { id, url, args, principal, definitionId } = await subscriptionKey(auth, input);
  const secret = canonicalWebhookSecret(input.delivery.secret);
  if (!secret) throw new ProtocolError(ProtocolErrorCode.InvalidParams, "Expected a whsec_ signing key containing 24 to 64 decoded bytes.");

  const db = databaseFor(env), fingerprint = await digest(secret);
  const scopes = await activeGrantScopes(env, principal);
  if (!scopes) throw forbidden();
  const exists = await db.transaction(async sql => {
    if (!await authorized(sql, principal, scopes)) throw forbidden();
    return sql.query("SELECT 1 FROM app.event_definitions WHERE tenant_id=$1 AND id=$2", [auth.tenantId, definitionId]);
  });
  if (!exists.rowCount) throw new ProtocolError(-32023, "Event not found.", { kind: "event" });

  const cached = (await db.pool.query<{ verified_at: Date }>(
    `SELECT verified_at FROM app.mcp_event_subscriptions
     WHERE tenant_id=$1 AND user_id=$2 AND grant_id=$3 AND callback_url=$4 AND secret_fingerprint=$5
       AND verified_at>now()-interval '10 minutes' ORDER BY verified_at DESC LIMIT 1`,
    [auth.tenantId, auth.userId, principal.grant_id, url, fingerprint],
  )).rows[0];
  let verifiedAt = cached?.verified_at;
  if (!verifiedAt) {
    const challenge = crypto.randomUUID();
    const result = await sendMcpWebhook(env.APP_ORIGIN, {
      url, subscriptionId: id, id: `msg_verification_${crypto.randomUUID()}`,
      payload: { type: "verification", challenge }, secrets: [secret], verify: true,
    });
    if (!callbackAccepted(result) || !validChallenge(result.challenge, challenge)) {
      throw new ProtocolError(-32015, "Callback endpoint verification failed.", {
        reason: result.reason ?? (callbackAccepted(result) ? "challenge_failed" : result.status && result.status >= 500 ? "http_5xx" : "challenge_failed"),
      });
    }
    verifiedAt = new Date();
  }

  const ttl = Math.min(input.ttlMs ?? defaultLifetime, maxLifetime);
  const encrypted = await encrypt(secret, env.CREDENTIAL_ENCRYPTION_KEY);
  const currentScopes = cached ? scopes : await activeGrantScopes(env, principal);
  if (!currentScopes) throw forbidden();
  const expiresAt = await db.transaction(async sql => {
    await lockMcpEventGrant(sql, principal.tenant_id, principal.grant_id, true);
    const definition = await sql.query("SELECT 1 FROM app.event_definitions WHERE tenant_id=$1 AND id=$2 FOR SHARE", [auth.tenantId, definitionId]);
    if (!definition.rowCount) throw new ProtocolError(-32023, "Event not found.", { kind: "event" });
    await lockEventOutbox(sql, auth.tenantId, definitionId);
    // Take the same subscription lock as dispatch before locking membership
    // and policy, so dispatch and refresh acquire those locks in order.
    await sql.query("SELECT 1 FROM app.mcp_event_subscriptions WHERE tenant_id=$1 AND id=$2 FOR NO KEY UPDATE", [auth.tenantId, id]);
    if (!await authorized(sql, principal, currentScopes)) throw forbidden();
    const { rows: [row] } = await sql.query<{ expires_at: Date }>(
      `INSERT INTO app.mcp_event_subscriptions AS s
         (tenant_id,id,user_id,session_version,grant_id,client_id,definition_id,arguments,callback_url,
          encrypted_secret,secret_fingerprint,verified_at,generation,status,expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,gen_random_uuid(),'active',clock_timestamp()+$13*interval '1 millisecond')
       ON CONFLICT (tenant_id,id) DO UPDATE SET
         session_version=excluded.session_version,
         previous_encrypted_secret=CASE WHEN s.status<>'active' OR s.expires_at<=clock_timestamp() THEN NULL
           WHEN s.secret_fingerprint<>excluded.secret_fingerprint THEN s.encrypted_secret ELSE s.previous_encrypted_secret END,
         rotated_at=CASE WHEN s.status<>'active' OR s.expires_at<=clock_timestamp() THEN NULL
           WHEN s.secret_fingerprint<>excluded.secret_fingerprint THEN clock_timestamp() ELSE s.rotated_at END,
         encrypted_secret=excluded.encrypted_secret, secret_fingerprint=excluded.secret_fingerprint, verified_at=excluded.verified_at,
         ack_epoch=CASE WHEN s.status='active' AND s.expires_at>clock_timestamp() THEN s.ack_epoch END,
         cooldown_until=CASE WHEN s.status='active' AND s.expires_at>clock_timestamp() THEN s.cooldown_until END,
         generation=CASE WHEN s.status='active' AND s.expires_at>clock_timestamp() THEN s.generation ELSE excluded.generation END,
         status='active', expires_at=clock_timestamp()+$13*interval '1 millisecond'
       RETURNING expires_at`,
      [auth.tenantId, id, auth.userId, auth.sessionVersion, principal.grant_id, principal.client_id, definitionId, args, url, encrypted, fingerprint, verifiedAt, ttl],
    );
    return row.expires_at;
  });
  return { id, refreshBefore: expiresAt.toISOString(), cursor: null, truncated: false };
}

export async function unsubscribeMcpEvent(env: Env, auth: OAuthProps, input: z.infer<typeof unsubscribeEventInput>) {
  const { id, principal } = await subscriptionKey(auth, input);
  const db = databaseFor(env);
  await db.transaction(async sql => {
    await lockMcpEventGrant(sql, principal.tenant_id, principal.grant_id, true);
    const row = await sql.query(`SELECT id FROM app.mcp_event_subscriptions
       WHERE tenant_id=$1 AND id=$2 AND user_id=$3 AND grant_id=$4 AND client_id=$5 FOR NO KEY UPDATE`,
      [auth.tenantId, id, principal.user_id, principal.grant_id, principal.client_id]);
    if (!row.rowCount) return;
    const scopes = await activeGrantScopes(env, principal);
    if (!scopes || !await authorized(sql, principal, scopes)) throw forbidden();
    await sql.query(`UPDATE app.mcp_event_subscriptions SET status='stopped', previous_encrypted_secret=NULL,
       rotated_at=NULL,cooldown_until=NULL WHERE tenant_id=$1 AND id=$2 AND status='active'`, [auth.tenantId, id]);
  });
  return {};
}

type ProcessingSubscription = Principal & {
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

type Claim = {
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
type Subscription = ProcessingSubscription & {
  arguments: unknown;
  callback_url: string;
  encrypted_secret: string;
  previous_encrypted_secret: string | null;
  rotated_at: Date | null;
};

const deliveryReady = `(
  (d.status IN ('pending','sending') AND d.ack_state IS DISTINCT FROM 'processed')
  OR (d.status='accepted' AND d.ack_state='awaiting_ack')
)`;
const deliveryDue = `CASE WHEN d.status='accepted' THEN d.ack_due_at ELSE d.next_attempt_at END`;
const pacedDue = `CASE WHEN s.generation=d.generation AND s.status='active' AND s.expires_at>statement_timestamp()
  THEN GREATEST(${deliveryDue},s.cooldown_until) ELSE ${deliveryDue} END`;

async function claimDelivery(sql: DatabaseClient) {
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

export async function nextMcpDeliveryDelay(env: Env) {
  const { rows: [row] } = await databaseFor(env).pool.query<{ due_at: Date | null }>(
    `SELECT min(${pacedDue}) AS due_at FROM app.mcp_event_deliveries d JOIN app.mcp_event_subscriptions s
       ON (s.tenant_id,s.id)=(d.tenant_id,d.subscription_id)
     ${joinMcpInstallation}
     WHERE ${deliveryReady} AND ${installationCanReceiveMcpEvents} AND (d.ack_epoch IS NOT NULL OR s.cooldown_until IS NOT NULL)`,
  );
  return row?.due_at ? Math.max(100, row.due_at.getTime() - Date.now()) : 60_000;
}

function subscriptionActive(subscription: Subscription, claim: Claim) {
  return subscription.status === "active" && subscription.generation === claim.generation && subscription.expires_at.getTime() > Date.now();
}

function deliveryOutcome(outcome: WebhookOutcome, attempts: number) {
  if (callbackAccepted(outcome)) return { status: "accepted", reason: "accepted" };
  const status = outcome.status;
  const transient = outcome.reason !== "forbidden_destination" &&
    (status === undefined || status === 408 || status === 425 || status === 429 || status >= 500);
  return { status: transient && attempts < maxAttempts ? "pending" : "failed", reason: outcome.reason ?? (status ? "http_error" : "connection_failed") };
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
