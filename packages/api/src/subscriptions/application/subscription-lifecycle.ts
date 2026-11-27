import { appConfig, signingConfig } from "../../config/runtime";
import { ProtocolError, ProtocolErrorCode } from "@modelcontextprotocol/server";
import type { z } from "zod";

import { encrypt } from "../../crypto";
import { eventDefinitionId, type subscribeEventInput, type unsubscribeEventInput } from "../api/mcp-event-contracts";
import { callbackAccepted, canonicalCallbackURL, canonicalWebhookSecret, sendMcpWebhook, validChallenge } from "../delivery/mcp-webhook";

import { databaseFor } from "../../postgres/database";

import { lockEventOutbox, lockMcpEventGrant } from "../storage/mcp-event-outbox";
import type { Env, OAuthProps } from "../../types";

import { type Principal, activeGrantScopes, authorized } from "./subscription-access";
import { defaultLifetime, maxLifetime } from "./delivery-policy";

async function digest(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function forbidden() {
  return new ProtocolError(-32024, "The OAuth grant is not authorized for this event.");
}

export function requestPrincipal(auth: OAuthProps): Principal {
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
    const result = await sendMcpWebhook(appConfig(env).origin, {
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
  const encrypted = await encrypt(secret, signingConfig(env).credentialKey);
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
