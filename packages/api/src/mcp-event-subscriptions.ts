import { ProtocolError, ProtocolErrorCode } from "@modelcontextprotocol/server";
import type { z } from "zod";
import { normalizeScopes } from "./access-tokens";
import { decrypt, encrypt } from "./crypto";
import { eventDefinitionId, eventProtocolName, type subscribeEventInput, type unsubscribeEventInput } from "./mcp-event-contracts";
import { callbackAccepted, canonicalCallbackURL, canonicalWebhookSecret, sendMcpWebhook, validChallenge, type WebhookOutcome } from "./mcp-webhook";
import { applyConnectionScopes, type ConnectionScopePolicy } from "./oauth-connection-settings";
import { databaseFor, type DatabaseClient } from "./postgres/database";
import { lockEventOutbox, lockMcpEventGrant } from "./postgres/mcp-event-outbox";
import type { Env, OAuthProps } from "./types";

const defaultLifetime = 24 * 60 * 60 * 1000;
const maxLifetime = 7 * defaultLifetime;
const maxAttempts = 5;
const retryInterval = 15_000;

type Principal = {
  tenant_id: string;
  user_id: string;
  grant_id: string;
  client_id: string;
  session_version: number;
};

async function activeGrantScopes(env: Env, principal: Principal): Promise<string[] | null> {
  if (!env.OAUTH_PROVIDER) throw new Error("OAuth management unavailable");
  let cursor: string | undefined;
  do {
    const page = await env.OAUTH_PROVIDER.listUserGrants(principal.user_id, { limit: 100, cursor });
    const grant = page.items.find(item => item.id === principal.grant_id);
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

async function subscriptionKey(auth: OAuthProps, input: z.infer<typeof unsubscribeEventInput>) {
  if (auth.authMethod !== "oauth" || !auth.oauthGrantId || !auth.oauthClientId) throw forbidden();
  const url = canonicalCallbackURL(input.delivery.url);
  if (!url) throw new ProtocolError(ProtocolErrorCode.InvalidParams, "Expected an HTTPS callback URL without credentials or a fragment.");
  const principal: Principal = {
    tenant_id: auth.tenantId, user_id: auth.userId, grant_id: auth.oauthGrantId, client_id: auth.oauthClientId,
    session_version: auth.sessionVersion,
  };
  // The strict empty arguments schema has one canonical representation.
  const args = JSON.stringify(input.arguments);
  const id = "sub_" + await digest(JSON.stringify([auth.tenantId, auth.userId, auth.oauthGrantId, url, input.name, args]));
  return { id, url, args, principal, definitionId: eventDefinitionId(input.name) };
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
    [auth.tenantId, auth.userId, auth.oauthGrantId, url, fingerprint],
  )).rows[0];
  let verifiedAt = cached?.verified_at;
  if (!verifiedAt) {
    const challenge = crypto.randomUUID();
    const result = await sendMcpWebhook(env, {
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
    await lockMcpEventGrant(sql, principal.tenant_id, principal.grant_id);
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
         generation=CASE WHEN s.status='active' AND s.expires_at>clock_timestamp() THEN s.generation ELSE excluded.generation END,
         status='active', expires_at=clock_timestamp()+$13*interval '1 millisecond'
       RETURNING expires_at`,
      [auth.tenantId, id, auth.userId, auth.sessionVersion, auth.oauthGrantId, auth.oauthClientId, definitionId, args, url, encrypted, fingerprint, verifiedAt, ttl],
    );
    return row.expires_at;
  });
  return { id, refreshBefore: expiresAt.toISOString(), cursor: null, truncated: false };
}

export async function unsubscribeMcpEvent(env: Env, auth: OAuthProps, input: z.infer<typeof unsubscribeEventInput>) {
  const { id } = await subscriptionKey(auth, input);
  await databaseFor(env).pool.query(
    `UPDATE app.mcp_event_subscriptions SET status='stopped', previous_encrypted_secret=NULL, rotated_at=NULL
     WHERE tenant_id=$1 AND id=$2 AND status='active'`, [auth.tenantId, id],
  );
  return {};
}

type Claim = {
  tenant_id: string;
  subscription_id: string;
  occurrence_id: string;
  claim_id: string;
  generation: string;
  attempts: number;
};
type Subscription = Principal & {
  generation: string;
  status: string;
  expires_at: Date;
  callback_url: string;
  encrypted_secret: string;
  previous_encrypted_secret: string | null;
  rotated_at: Date | null;
};

async function claimDelivery(sql: DatabaseClient) {
  const { rows: [claim] } = await sql.query<Claim>(
    `WITH due AS (
       SELECT tenant_id,subscription_id,occurrence_id FROM app.mcp_event_deliveries
       WHERE status IN ('pending','sending') AND next_attempt_at<=statement_timestamp()
       ORDER BY next_attempt_at,tenant_id,subscription_id,occurrence_id LIMIT 1 FOR UPDATE SKIP LOCKED
     )
     UPDATE app.mcp_event_deliveries d SET status='sending',attempts=least(attempts+1,${maxAttempts + 1}),claim_id=gen_random_uuid(),next_attempt_at=clock_timestamp()+interval '60 seconds',updated_at=clock_timestamp()
     FROM due WHERE (d.tenant_id,d.subscription_id,d.occurrence_id)=(due.tenant_id,due.subscription_id,due.occurrence_id)
     RETURNING d.tenant_id,d.subscription_id,d.occurrence_id,d.claim_id,d.generation,d.attempts`,
  );
  return claim;
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
  const finish = (sql: DatabaseClient, status: string, attempts: number, reason: string, httpStatus?: number) => sql.query(
    `UPDATE app.mcp_event_deliveries SET status=$5,claim_id=NULL,attempts=$6,last_outcome=$7,http_status=$8,
       next_attempt_at=clock_timestamp()+$9*interval '1 millisecond',updated_at=clock_timestamp()
     WHERE tenant_id=$1 AND subscription_id=$2 AND occurrence_id=$3 AND claim_id=$4`,
    [...key, status, attempts, reason, httpStatus ?? null, retryInterval * 2 ** Math.max(attempts - 1, 0)],
  );
  await db.transaction(async sql => {
    const { rows: [subscription] } = await sql.query<Subscription>(
      `SELECT * FROM app.mcp_event_subscriptions WHERE tenant_id=$1 AND id=$2 FOR NO KEY UPDATE`, key.slice(0, 2),
    );
    if (!subscription) return;
    const { rows: [record] } = await sql.query<{ occurred_at: Date; definition_id: string }>(
      `SELECT o.occurred_at,o.definition_id FROM app.mcp_event_deliveries d
       JOIN app.event_occurrences o ON o.tenant_id=d.tenant_id AND o.id=d.occurrence_id
       WHERE d.tenant_id=$1 AND d.subscription_id=$2 AND d.occurrence_id=$3 AND d.claim_id=$4 FOR UPDATE OF d`, key,
    );
    if (!record) return;
    if (!subscriptionActive(subscription, claim)) {
      await finish(sql, "cancelled", claim.attempts - 1, "subscription_inactive");
      return;
    }
    if (claim.attempts > maxAttempts) {
      await finish(sql, "failed", maxAttempts, "claim_interrupted");
      return;
    }
    const attempts = claim.attempts;
    let result: WebhookOutcome;
    try {
      const secrets = [await decrypt(subscription.encrypted_secret, env.CREDENTIAL_ENCRYPTION_KEY)];
      if (subscription.previous_encrypted_secret && (subscription.rotated_at?.getTime() ?? 0) > Date.now() - 5 * 60_000) {
        secrets.push(await decrypt(subscription.previous_encrypted_secret, env.CREDENTIAL_ENCRYPTION_KEY));
      }
      const scopes = await activeGrantScopes(env, subscription);
      if (!scopes || !await authorized(sql, subscription, scopes) || !subscriptionActive(subscription, claim)) {
        await finish(sql, "cancelled", claim.attempts - 1, "authorization_inactive");
        return;
      }
      result = await sendMcpWebhook(env, {
        url: subscription.callback_url,
        subscriptionId: claim.subscription_id,
        id: claim.occurrence_id,
        payload: {
          eventId: claim.occurrence_id, name: eventProtocolName(record.definition_id), timestamp: record.occurred_at.toISOString(),
          data: { occurrenceId: claim.occurrence_id, definitionId: record.definition_id }, cursor: null,
        },
        secrets,
        now: now(),
      });
    } catch {
      result = { reason: "connection_failed" };
    }
    const outcome = deliveryOutcome(result, attempts);
    await finish(sql, outcome.status, attempts, outcome.reason, result.status);
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
