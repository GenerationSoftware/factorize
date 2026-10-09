import { z } from "zod";
import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import { hmac } from "./crypto";
import type { Env, OAuthProps } from "./types";
import type { Session } from "./session";
export const consentPreviewInput = z.object({ authorizationQuery: z.string().min(1).max(8192) }).strict();
export const consentDecisionInput = z.object({ request: z.string().min(1).max(16384), signature: z.string().min(1).max(256), decision: z.enum(["allow", "deny"]), scopes: z.array(z.enum(["flows:read", "flows:write", "runs:read", "runs:write"])) }).strict();
export const consentPreviewResponse = z.object({ clientName: z.string(), scopes: z.array(z.string()), request: z.string(), signature: z.string(), expiresAt: z.string() });
export const consentDecisionResponse = z.object({ redirectTo: z.string() });
const supported = ["flows:read", "flows:write", "runs:read", "runs:write"];
const encode = (value: unknown) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))));
const decode = (value: string) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value), char => char.charCodeAt(0))));
const binding = (payload: string, session: Session) => `${payload}.${session.tenantId}.${session.userId}.${session.sessionVersion}`;
const equal = (a: string, b: string) => { let diff = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return diff === 0; };
export async function consentPreview(env: Env, session: Session, input: z.infer<typeof consentPreviewInput>) {
  if (!env.OAUTH_PROVIDER) throw new Error("OAuth provider unavailable");
  const parsed = await env.OAUTH_PROVIDER.parseAuthRequest(new Request(`${env.APP_ORIGIN}/authorize?${input.authorizationQuery.replace(/^\?/, "")}`));
  const client = await env.OAUTH_PROVIDER.lookupClient(parsed.clientId);
  if (!client) return null;
  const expiresAt = Math.min(session.exp, Math.floor(Date.now() / 1000) + 600);
  const request = encode({ parsed, expiresAt });
  return { clientName: client.clientName ?? "this client", scopes: parsed.scope.filter(scope => supported.includes(scope)), request, signature: await hmac(binding(request, session), env.SESSION_SIGNING_SECRET), expiresAt: new Date(expiresAt * 1000).toISOString() };
}
export async function consentDecision(env: Env, session: Session, input: z.infer<typeof consentDecisionInput>) {
  if (!env.OAUTH_PROVIDER || !equal(input.signature, await hmac(binding(input.request, session), env.SESSION_SIGNING_SECRET))) return null;
  let envelope: { parsed: AuthRequest; expiresAt: number };
  try { envelope = decode(input.request); } catch { return null; }
  if (!Number.isFinite(envelope.expiresAt) || envelope.expiresAt <= Math.floor(Date.now() / 1000)) return null;
  const parsed = envelope.parsed;
  // Revalidate client registration and redirect URI before grant issuance.
  const client = await env.OAUTH_PROVIDER.lookupClient(parsed.clientId);
  if (!client || !client.redirectUris.includes(parsed.redirectUri)) return null;
  if (input.scopes.some(scope => !parsed.scope.includes(scope) || !supported.includes(scope))) return null;
  if (input.decision === "deny") { const redirect = new URL(parsed.redirectUri); redirect.searchParams.set("error", "access_denied"); redirect.searchParams.set("state", parsed.state); if (parsed.issuer) redirect.searchParams.set("iss", parsed.issuer); return { redirectTo: redirect.toString() }; }
  const props: OAuthProps = { tenantId: session.tenantId, userId: session.userId, sessionVersion: session.sessionVersion, scopes: input.scopes, authMethod: "oauth" };
  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({ request: parsed, userId: session.userId, metadata: { tenantId: session.tenantId }, scope: input.scopes, props });
  return { redirectTo };
}
