import { selectedTeamDefaults, teamPermissionPreferences } from "./team-permission-defaults";
import { integrationConsentLabels, listAgentPolicies } from "./agent-api";
import { isIntegrationScope } from "./agent-api-contracts";
import { databaseFor } from "./postgres/database";
import { connectionFor, matchesRegisteredRedirect, originalBrowser } from "./oauth-continuation";
import { z } from "zod";
import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import { hmac } from "./crypto";
import type { Env, OAuthProps } from "./types";
import type { Session } from "./session";
import { integrationForScope, lockOAuthPolicy, reconnectPreferences, type ReconnectRevision } from "./oauth-reconnect";
import { AGENT_SCOPES, normalizeScopes } from "./access-tokens";
export const consentPreviewInput = z.object({ authorizationQuery: z.string().min(1).max(8192) }).strict();
export const consentDecisionInput = z.object({ request: z.string().min(1).max(16384), signature: z.string().min(1).max(256), decision: z.enum(["allow", "deny"]), scopes: z.array(z.string()) }).strict();
export const consentPreviewResponse = z.object({ clientName: z.string(), scopes: z.array(z.string()), selectedScopes: z.array(z.string()), newScopes: z.array(z.string()).default([]), grantedScopes: z.array(z.string()).default([]), blockedScopes: z.array(z.string()).default([]), unavailableSavedScopes: z.array(z.string()), reconnect: z.boolean(), request: z.string(), signature: z.string(), expiresAt: z.string(), integrationLabels: z.array(z.object({ scope: z.string(), name: z.string(), description: z.string().nullable() })).optional() });
export const consentDecisionResponse = z.object({ redirectTo: z.string() });
const supported: readonly string[] = AGENT_SCOPES;
export class ConsentPreviewError extends Error {}
type ConsentEnvelope = {
  parsed: AuthRequest;
  expiresAt: number;
  nonce: string;
  connection?: string;
  allowedScopes?: string[];
  preselectedScopes?: string[];
  policyVersion: ReconnectRevision | null;
};
const encode = (value: unknown) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))));
const decode = (value: string) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value), char => char.charCodeAt(0))));
const binding = (payload: string, session: Session) => `${payload}.${session.tenantId}.${session.userId}.${session.sessionVersion}`;
const equal = (a: string, b: string) => { let diff = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return diff === 0; };
export async function consentPreview(env: Env, session: Session, input: z.infer<typeof consentPreviewInput>, browserRequest?: Request) {
  if (!env.OAUTH_PROVIDER) throw new Error("OAuth provider unavailable");
  const url = new URL(`${env.APP_ORIGIN}/authorize?${input.authorizationQuery.replace(/^\?/, "")}`);
  const connectionId = url.searchParams.get("connection");
  const connection = connectionId ? await connectionFor(env, connectionId) : null;
  if (connectionId) {
    if (!connection || connection.kind !== "callback") {
      throw new ConsentPreviewError("This connection link expired or was already used. Start Reconnect in your MCP client and open its new authorization link.");
    }
    if (!browserRequest || !await originalBrowser(browserRequest, env, connection) || connection.user_id && connection.user_id !== session.userId) {
      throw new ConsentPreviewError("Open the new authorization link in the browser and Factorize account where you started connecting. If that browser is unavailable, start Reconnect again in your MCP client.");
    }
    url.searchParams.delete("connection");
    if (url.pathname + url.search !== connection.destination) throw new ConsentPreviewError("This link does not match the pending connection. Start Reconnect again in your MCP client.");
    await databaseFor(env).pool.query("UPDATE app.oauth_connections SET user_id=$2 WHERE id=$1 AND (user_id IS NULL OR user_id=$2)", [connection.id, session.userId]);
  }
  const parsed = await env.OAUTH_PROVIDER.parseAuthRequest(new Request(url));
  const client = await env.OAUTH_PROVIDER.lookupClient(parsed.clientId);
  if (!client || !matchesRegisteredRedirect(parsed.redirectUri, client.redirectUris) || parsed.responseType !== "code" || !parsed.codeChallenge || parsed.codeChallengeMethod !== "S256") {
    throw new ConsentPreviewError("The client registration or callback could not be verified. Start Reconnect again from your MCP client.");
  }
  const scopedRequest = url.searchParams.has("scope");
  const requestedScopes = scopedRequest && !url.searchParams.get("scope")?.trim() ? [] : parsed.scope;
  if (scopedRequest && requestedScopes.some(scope => !supported.includes(scope) && !isIntegrationScope(scope))) {
    throw new ConsentPreviewError("The client requested an unsupported Factorize permission. Update the scope request in your MCP client, then reconnect.");
  }
  // Omitted scope means Factorize can offer its ordinary owner-selectable
  // scopes. An explicit scope parameter is always an upper bound, even if empty.
  const { integrations } = await listAgentPolicies(env, session.tenantId);
  const available = integrations.filter(row => row.available && row.policy !== "disabled").map(row => row.requiredScope);
  const scopes = normalizeScopes(scopedRequest ? requestedScopes : [...supported, ...available])
    .filter(scope => !isIntegrationScope(scope) || available.includes(scope));
  const integrationLabels = await integrationConsentLabels(env, session.tenantId, scopes);
  const preferences = await reconnectPreferences(env, session, parsed);
  const preferredScopes = preferences?.preferredScopes ?? selectedTeamDefaults(scopes,
    await teamPermissionPreferences(databaseFor(env).pool, session.tenantId));
  const selectedScopes = scopes.filter(scope => preferredScopes.includes(scope));
  const grantedScopes = scopes.filter(scope => preferences?.grantedScopes.includes(scope));
  const newScopes = scopedRequest && preferences ? scopes.filter(scope => !grantedScopes.includes(scope)) : [];
  const blockedScopes = scopes.filter(scope => preferences?.deniedIntegrations.includes(integrationForScope(scope) ?? ""));
  const unavailableSavedScopes = preferences?.preferredScopes.filter(scope => !scopes.includes(scope)) ?? [];
  const expiresAt = Math.min(session.exp, Math.floor(Date.now() / 1000) + 600, connection ? Math.floor(connection.expires_at.getTime() / 1000) : Infinity);
  await databaseFor(env).pool.query("DELETE FROM app.oauth_consent_previews WHERE expires_at<now()-interval '1 day'");
  const nonce = crypto.randomUUID();
  await databaseFor(env).pool.query("INSERT INTO app.oauth_consent_previews(id,expires_at) VALUES ($1,$2)", [nonce, new Date(expiresAt * 1000)]);
  const request = encode({ parsed, expiresAt, nonce, connection: connectionId ?? undefined, allowedScopes: scopes, preselectedScopes: selectedScopes, policyVersion: preferences?.version ?? null } satisfies ConsentEnvelope);
  return { integrationLabels, clientName: client.clientName ?? "this client", scopes, selectedScopes, newScopes, grantedScopes, blockedScopes, unavailableSavedScopes,
    reconnect: !!preferences, request, signature: await hmac(binding(request, session), env.SESSION_SIGNING_SECRET), expiresAt: new Date(expiresAt * 1000).toISOString() };
}
export async function consentDecision(env: Env, session: Session, input: z.infer<typeof consentDecisionInput>) {
  if (!env.OAUTH_PROVIDER || !equal(input.signature, await hmac(binding(input.request, session), env.SESSION_SIGNING_SECRET))) return null;
  let envelope: ConsentEnvelope;
  try { envelope = decode(input.request); } catch { return null; }
  if (!Number.isFinite(envelope.expiresAt) || envelope.expiresAt <= Math.floor(Date.now() / 1000)) return null;
  const parsed = envelope.parsed;
  // Revalidate client registration and redirect URI before grant issuance.
  const client = await env.OAUTH_PROVIDER.lookupClient(parsed.clientId);
  if (!client || !matchesRegisteredRedirect(parsed.redirectUri, client.redirectUris)) return null;
  const allowed = new Set(normalizeScopes(envelope.allowedScopes ?? parsed.scope));
  const selected = normalizeScopes(input.scopes);
  const issuedScopes = selected;
  if (input.scopes.some(scope => !allowed.has(scope) && !allowed.has(normalizeScopes([scope])[0] ?? "") ) || selected.some(scope => !(AGENT_SCOPES as readonly string[]).includes(scope) && !isIntegrationScope(scope))) return null;
  return databaseFor(env).transaction(async transaction => {
    const initialIntegrationDenials = new Set<string>();
    if (input.decision === "allow") {
      await lockOAuthPolicy(transaction, session);
      const current = await reconnectPreferences(env, session, parsed, transaction);
      // Refuse stale approvals without consuming the preview or connection. A
      // new review must display the latest settings before consent can proceed.
      if (envelope.policyVersion === undefined ||
          envelope.policyVersion?.grantId !== current?.version.grantId ||
          envelope.policyVersion?.revision !== current?.version.revision ||
          envelope.policyVersion?.ambiguous !== current?.version.ambiguous) return null;
      const selectedIntegrations = new Set(issuedScopes.map(integrationForScope));
      for (const id of current?.deniedIntegrations ?? []) initialIntegrationDenials.add(id);
      // Leaving a new, initially unchecked option off is not a block. Removing
      // a preselected integration is a deliberate denial.
      for (const scope of envelope.preselectedScopes ?? []) {
        const id = integrationForScope(scope);
        if (id && !selectedIntegrations.has(id)) initialIntegrationDenials.add(id);
      }
      for (const id of selectedIntegrations) if (id) initialIntegrationDenials.delete(id);
    }
    const preview = await transaction.query("UPDATE app.oauth_consent_previews SET used_at=now() WHERE id=$1 AND used_at IS NULL AND expires_at>clock_timestamp() RETURNING id", [envelope.nonce]);
    if (!preview.rows.length) return null;
    if (envelope.connection) {
      const consumed = await transaction.query("UPDATE app.oauth_connections SET used_at=now(),ready=false WHERE id=$1 AND user_id=$2 AND expires_at>clock_timestamp() AND used_at IS NULL RETURNING id", [envelope.connection, session.userId]);
      if (!consumed.rows.length) return null;
    }
    if (input.decision === "deny") { const redirect = new URL(parsed.redirectUri); redirect.searchParams.set("error", "access_denied"); redirect.searchParams.set("state", parsed.state); if (parsed.issuer) redirect.searchParams.set("iss", parsed.issuer); return { redirectTo: redirect.toString() }; }
    await integrationConsentLabels(env, session.tenantId, issuedScopes);
    const denied = initialIntegrationDenials.size ? { initialIntegrationDenials: [...initialIntegrationDenials] } : {};
    const props: OAuthProps = { tenantId: session.tenantId, userId: session.userId, sessionVersion: session.sessionVersion, scopes: issuedScopes, authMethod: "oauth", explicitIntegrationScopes: true, ...denied };
    const { redirectTo } = await env.OAUTH_PROVIDER!.completeAuthorization({ request: parsed, userId: session.userId, metadata: { tenantId: session.tenantId, explicitIntegrationScopes: true, ...denied }, scope: issuedScopes, props, revokeExistingGrants: false });
    return { redirectTo };
  });
}
