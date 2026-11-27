import { teamPermissionPreferences } from "../../access-control/storage/team-permission-preferences";
import { appConfig, signingConfig } from "../../config/runtime";
import { lockIntegrationTopology } from "../../integrations/storage/integration-removal-topology";
import { selectedTeamDefaults } from "../../access-control/domain/team-permission-defaults";
import { integrationConsentLabels, listAgentPolicies } from "../../proxy/application/agent-api";
import { isIntegrationScope } from "../../access-control/domain/scopes";
import { databaseFor } from "../../postgres/database";
import { connectionFor, matchesRegisteredRedirect, originalBrowser } from "./oauth-continuation";
import { z } from "zod";
import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import { hmac } from "../../crypto";
import type { Env, OAuthProps } from "../../types";
import type { Session } from "./session";
import { lockOAuthPolicy } from "../../access-control/application/oauth-reconnect";
import { getLegacyOAuthChoices, getOAuthInstallation, listOAuthInstallations, materializeLegacyOAuthInstallation, prepareOAuthIssuance } from "../../access-control/application/oauth-installations";
import { AGENT_SCOPES, normalizeScopes } from "../../access-control/domain/scopes";
const consentTarget = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("installation"), id: z.string().min(1).max(256) }),
  z.strictObject({ kind: z.literal("legacy"), id: z.string().min(1).max(256) }),
]);
type ConsentTarget = z.infer<typeof consentTarget>;
const consentChoice = z.object({ kind: z.enum(["installation", "legacy"]), id: z.string(), name: z.string(), createdAt: z.string() });
export const consentPreviewInput = z.object({ authorizationQuery: z.string().min(1).max(8192), target: consentTarget.optional() }).strict();
export const consentDecisionInput = z.object({ request: z.string().min(1).max(16384), signature: z.string().min(1).max(256), decision: z.enum(["allow", "deny"]), scopes: z.array(z.string()) }).strict();
export const consentPreviewResponse = z.object({ clientName: z.string(), scopes: z.array(z.string()), selectedScopes: z.array(z.string()), newScopes: z.array(z.string()).default([]), savedOutsideRequestedScopes: z.array(z.string()).default([]), grantedScopes: z.array(z.string()).default([]), blockedScopes: z.array(z.string()).default([]), unavailableSavedScopes: z.array(z.string()), reconnect: z.boolean(), targets: z.array(consentChoice), request: z.string(), signature: z.string(), expiresAt: z.string(), integrationLabels: z.array(z.object({ scope: z.string(), name: z.string(), description: z.string().nullable() })).optional() });
export const consentDecisionResponse = z.object({ redirectTo: z.string() });
const supported: readonly string[] = AGENT_SCOPES;
export class ConsentPreviewError extends Error {}
type ConsentEnvelope = {
  parsed: AuthRequest;
  expiresAt: number;
  nonce: string;
  connection?: string;
  allowedScopes: string[];
  target: ConsentTarget | null;
  policyRevision: number | null;
};
const encode = (value: unknown) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))));
const decode = (value: string) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value), char => char.charCodeAt(0))));
const binding = (payload: string, session: Session) => `${payload}.${session.tenantId}.${session.userId}.${session.sessionVersion}`;
const equal = (a: string, b: string) => { let diff = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return diff === 0; };
export async function consentPreview(env: Env, session: Session, input: z.infer<typeof consentPreviewInput>, browserRequest?: Request) {
  if (!env.OAUTH_PROVIDER) throw new Error("OAuth provider unavailable");
  const url = new URL(`${appConfig(env).origin}/authorize?${input.authorizationQuery.replace(/^\?/, "")}`);
  const connectionId = url.searchParams.get("connection");
  const connection = connectionId ? await connectionFor(env, connectionId) : null;
  const target = input.target ?? null;
  if (target && !connection) throw new ConsentPreviewError("Start Reconnect from your MCP client before choosing an existing connection.");
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
  // New connections never exceed an explicit request. An owner can expressly
  // approve their saved scopes for a fresh credential on a chosen existing connection.
  const { integrations } = await listAgentPolicies(env, session.tenantId);
  const available = integrations.filter(row => row.available && row.policy !== "disabled").map(row => row.requiredScope);
  const isAvailable = (scope: string) => supported.includes(scope) || available.includes(scope);
  const requested = normalizeScopes(scopedRequest ? requestedScopes : [...supported, ...available]).filter(isAvailable);
  const installations = (await listOAuthInstallations(databaseFor(env).pool, session.tenantId, session.userId)).filter(row =>
    !row.revoked_at && row.client_id === parsed.clientId && row.redirect_uri === parsed.redirectUri);
  const legacy = await getLegacyOAuthChoices(env, session, parsed);
  const targets = [
    ...installations.map(row => ({ kind: "installation" as const, id: row.id, name: row.display_name ?? client.clientName ?? "Existing connection", createdAt: new Date(row.created_at).toISOString() })),
    ...legacy.map(row => ({ kind: "legacy" as const, id: row.grantId, name: row.displayName ?? client.clientName ?? "Existing connection", createdAt: new Date(row.createdAt * 1000).toISOString() })),
  ];
  const existing = target?.kind === "installation" ? installations.find(row => row.id === target.id) : undefined;
  const old = target?.kind === "legacy" ? legacy.find(row => row.grantId === target.id) : undefined;
  if (target && !existing && !old) throw new ConsentPreviewError("This connection is not available for this client. Start a new connection or choose another compatible connection.");
  const preferences = existing?.selected_scopes ?? old?.selectedScopes;
  const active = existing?.active_scopes ?? old?.activeScopes ?? [];
  const savedOutsideRequestedScopes = target && scopedRequest ? normalizeScopes(preferences ?? [])
    .filter(scope => isAvailable(scope) && !requested.includes(scope)) : [];
  const scopes = [...requested, ...savedOutsideRequestedScopes];
  const integrationLabels = await integrationConsentLabels(env, session.tenantId, scopes);
  const preferredScopes = preferences ?? selectedTeamDefaults(scopes,
    await teamPermissionPreferences(databaseFor(env).pool, session.tenantId));
  const selectedScopes = scopes.filter(scope => preferredScopes.includes(scope));
  const grantedScopes = scopes.filter(scope => active.includes(scope) && preferredScopes.includes(scope));
  const newScopes = scopedRequest && target ? requested.filter(scope => !grantedScopes.includes(scope)) : [];
  const blockedScopes = preferences ? scopes.filter(scope => isIntegrationScope(scope) && !preferences.includes(scope)) : [];
  const unavailableSavedScopes = preferences?.filter(scope => !scopes.includes(scope)) ?? [];
  const policyRevision = existing?.policy_revision ?? old?.policyRevision ?? null;
  const expiresAt = Math.min(session.exp, Math.floor(Date.now() / 1000) + 600, connection ? Math.floor(connection.expires_at.getTime() / 1000) : Infinity);
  await databaseFor(env).pool.query("DELETE FROM app.oauth_consent_previews WHERE expires_at<now()-interval '1 day'");
  const nonce = crypto.randomUUID();
  await databaseFor(env).pool.query("INSERT INTO app.oauth_consent_previews(id,expires_at) VALUES ($1,$2)", [nonce, new Date(expiresAt * 1000)]);
  const request = encode({ parsed, expiresAt, nonce, connection: connectionId ?? undefined, allowedScopes: scopes, target, policyRevision } satisfies ConsentEnvelope);
  return { integrationLabels, clientName: client.clientName ?? "this client", scopes, selectedScopes, newScopes, savedOutsideRequestedScopes, grantedScopes, blockedScopes, unavailableSavedScopes, targets,
    reconnect: !!target, request, signature: await hmac(binding(request, session), signingConfig(env).sessionSecret), expiresAt: new Date(expiresAt * 1000).toISOString() };
}
export async function consentDecision(env: Env, session: Session, input: z.infer<typeof consentDecisionInput>, browserRequest?: Request) {
  if (!env.OAUTH_PROVIDER || !equal(input.signature, await hmac(binding(input.request, session), signingConfig(env).sessionSecret))) return null;
  let envelope: ConsentEnvelope;
  try { envelope = decode(input.request); } catch { return null; }
  if (!Number.isFinite(envelope.expiresAt) || envelope.expiresAt <= Math.floor(Date.now() / 1000) || !Array.isArray(envelope.allowedScopes) || envelope.target === undefined || (envelope.target && !envelope.connection)) return null;
  if (envelope.connection) {
    const connection = await connectionFor(env, envelope.connection);
    if (!connection || connection.kind !== "callback" || connection.user_id !== session.userId || !browserRequest || !await originalBrowser(browserRequest, env, connection)) return null;
  }
  const parsed = envelope.parsed;
  const client = await env.OAUTH_PROVIDER.lookupClient(parsed.clientId);
  if (!client || !matchesRegisteredRedirect(parsed.redirectUri, client.redirectUris) || parsed.responseType !== "code" || !parsed.codeChallenge || parsed.codeChallengeMethod !== "S256") return null;
  const allowed = new Set(normalizeScopes(envelope.allowedScopes));
  const issuedScopes = normalizeScopes(input.scopes);
  if (input.scopes.some(scope => !allowed.has(scope) && !allowed.has(normalizeScopes([scope])[0] ?? "")) || issuedScopes.some(scope => !(AGENT_SCOPES as readonly string[]).includes(scope) && !isIntegrationScope(scope))) return null;
  return databaseFor(env).transaction(async transaction => {
    let installationId: string | null = null;
    let policyRevision: number | null = null;
    let savedScopes: string[] = [];
    if (input.decision === "allow") {
      await lockIntegrationTopology(transaction,session.tenantId);
      await lockOAuthPolicy(transaction, session);
      const target = envelope.target;
      if (target) {
        const existing = target.kind === "installation"
          ? await getOAuthInstallation(transaction, session.tenantId, session.userId, target.id)
          : null;
        const legacy = target.kind === "legacy"
          ? (await getLegacyOAuthChoices(env, session, parsed)).find(row => row.grantId === target.id)
          : null;
        if (target.kind === "legacy" && (!legacy || legacy.policyRevision !== envelope.policyRevision)) return null;
        const current = existing ?? (legacy && await materializeLegacyOAuthInstallation(env, transaction, session, legacy.grantId, parsed.clientId, parsed.redirectUri));
        if (!current || current.revoked_at || current.client_id !== parsed.clientId || current.redirect_uri !== parsed.redirectUri ||
            (target.kind === "installation" && current.policy_revision !== envelope.policyRevision)) return null;
        installationId = current.id;
        policyRevision = current.policy_revision;
        savedScopes = current.selected_scopes;
      }
    }
    const preview = await transaction.query("UPDATE app.oauth_consent_previews SET used_at=now() WHERE id=$1 AND used_at IS NULL AND expires_at>clock_timestamp() RETURNING id", [envelope.nonce]);
    if (!preview.rows.length) return null;
    if (envelope.connection) {
      const consumed = await transaction.query("UPDATE app.oauth_connections SET used_at=now(),ready=false WHERE id=$1 AND user_id=$2 AND expires_at>clock_timestamp() AND used_at IS NULL RETURNING id", [envelope.connection, session.userId]);
      if (!consumed.rows.length) return null;
    }
    if (input.decision === "deny") { const redirect = new URL(parsed.redirectUri); redirect.searchParams.set("error", "access_denied"); redirect.searchParams.set("state", parsed.state); if (parsed.issuer) redirect.searchParams.set("iss", parsed.issuer); return { redirectTo: redirect.toString() }; }
    await integrationConsentLabels(env, session.tenantId, issuedScopes);
    // An unoffered scope was not editable here. Preserve that part of the owner
    // policy without conferring it on the new credential.
    const selectedScopes = normalizeScopes([...savedScopes.filter(scope => !allowed.has(scope)), ...issuedScopes]);
    const pending = await prepareOAuthIssuance(transaction, { session, installationId, clientId: parsed.clientId, redirectUri: parsed.redirectUri,
      policyRevision, selectedScopes, credentialScopes: issuedScopes, expiresAt: envelope.expiresAt });
    const props: OAuthProps = { tenantId: session.tenantId, userId: session.userId, sessionVersion: session.sessionVersion, scopes: issuedScopes, authMethod: "oauth",
      explicitIntegrationScopes: true, oauthInstallationId: pending.installationId, oauthIssuanceId: pending.issuanceId };
    const { redirectTo } = await env.OAUTH_PROVIDER!.completeAuthorization({ request: parsed, userId: session.userId,
      metadata: { tenantId: session.tenantId, explicitIntegrationScopes: true, oauthInstallationId: pending.installationId }, scope: issuedScopes, props, revokeExistingGrants: false });
    return { redirectTo };
  });
}
