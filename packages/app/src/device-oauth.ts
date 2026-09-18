import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import { hmac } from "./crypto";
import type { Env, OAuthProps } from "./types";
import { and, eq, gt } from "drizzle-orm";
import { databaseFor } from "./postgres/database";
import { oauthDeviceAuthorizations } from "./postgres/schema";

export const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const DEVICE_TTL = 600;
const DEFAULT_INTERVAL = 5;
const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

type OAuthClient = { clientId: string; clientName?: string; redirectUris: string[]; tokenEndpointAuthMethod?: string };
type OAuthHelpers = {
  lookupClient(clientId: string): Promise<OAuthClient | null>;
  completeAuthorization(options: { request: AuthRequest; userId: string; metadata: unknown; scope: string[]; props: OAuthProps; revokeExistingGrants?: boolean }): Promise<{ redirectTo: string }>;
};
type DeviceStatus = "pending" | "approved" | "denied";
type DeviceRecord = {
  clientId: string;
  clientName: string;
  tokenEndpointAuthMethod: string;
  scope: string[];
  resource: string;
  redirectUri: string;
  codeChallenge: string;
  createdAt: number;
  expiresAt: number;
  interval: number;
  lastPolledAt?: number;
  status: DeviceStatus;
  authorizationCode?: string;
};

const noStoreHeaders = { "Content-Type": "application/json", "Cache-Control": "no-store", Pragma: "no-cache" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: noStoreHeaders });
const oauthError = (error: string, description: string, status = 400) => json({ error, error_description: description }, status);
export function deviceLoginRedirect(appOrigin: string, returnTo: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      "Cache-Control": "no-store",
      Location: `${appOrigin}/auth/linear`,
      "Set-Cookie": `factorize_oauth_return=${encodeURIComponent(returnTo)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`,
    },
  });
}
const random = (bytes = 32) => {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};
const normalizeUserCode = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
const displayUserCode = (value: string) => `${value.slice(0, 4)}-${value.slice(4)}`;
const deviceKey = (code: string) => `device:${code}`;
const userKey = (code: string) => `device-user:${normalizeUserCode(code)}`;
const verifier = (deviceCode: string, secret: string) => hmac(`device-code:${deviceCode}`, secret);
async function challenge(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return btoa(String.fromCharCode(...digest)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
async function sha256Hex(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, "0")).join("");
}
function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}
function basicCredentials(request: Request): { clientId: string; clientSecret: string } | null {
  const header = request.headers.get("Authorization");
  if (!header?.toLowerCase().startsWith("basic ")) return null;
  try {
    const decoded = atob(header.slice(6).trim());
    const separator = decoded.indexOf(":");
    if (separator < 0) return null;
    return { clientId: decodeURIComponent(decoded.slice(0, separator)), clientSecret: decodeURIComponent(decoded.slice(separator + 1)) };
  } catch { return null; }
}
async function authenticateDeviceClient(request: Request, env: Env, form: FormData, client: OAuthClient): Promise<boolean> {
  if ((client.tokenEndpointAuthMethod ?? "none") === "none") return true;
  const basic = basicCredentials(request);
  const clientId = basic?.clientId ?? String(form.get("client_id") ?? "");
  const clientSecret = basic?.clientSecret ?? String(form.get("client_secret") ?? "");
  if (clientId !== client.clientId || !clientSecret || !env.OAUTH_KV) return false;
  const stored = await env.OAUTH_KV.get<{ clientSecret?: string }>(`client:${client.clientId}`, "json");
  return Boolean(stored?.clientSecret && safeEqual(await sha256Hex(clientSecret), stored.clientSecret));
}
async function readDevice(env: Env, code: string): Promise<DeviceRecord | null> {
  if (!env.DATABASE && !env.HYPERDRIVE) return env.OAUTH_KV?.get<DeviceRecord>(deviceKey(code), "json") ?? null;
  const [row] = await databaseFor(env).orm.select({ record: oauthDeviceAuthorizations.record }).from(oauthDeviceAuthorizations).where(and(eq(oauthDeviceAuthorizations.deviceCode, code), gt(oauthDeviceAuthorizations.expiresAt, new Date()))).limit(1);
  return row?.record as DeviceRecord | undefined ?? null;
}
async function deviceCodeForUser(env: Env, userCode: string): Promise<string | null> {
  if (!env.DATABASE && !env.HYPERDRIVE) return env.OAUTH_KV?.get(userKey(userCode)) ?? null;
  const [row] = await databaseFor(env).orm.select({ deviceCode: oauthDeviceAuthorizations.deviceCode }).from(oauthDeviceAuthorizations).where(and(eq(oauthDeviceAuthorizations.userCode, normalizeUserCode(userCode)), gt(oauthDeviceAuthorizations.expiresAt, new Date()))).limit(1);
  return row?.deviceCode ?? null;
}
async function writeDevice(env: Env, deviceCode: string, userCode: string, record: DeviceRecord): Promise<void> {
  if (!env.DATABASE && !env.HYPERDRIVE) {
    await Promise.all([env.OAUTH_KV!.put(deviceKey(deviceCode), JSON.stringify(record), { expirationTtl: Math.max(1, record.expiresAt - Math.floor(Date.now() / 1000)) }), env.OAUTH_KV!.put(userKey(userCode), deviceCode, { expirationTtl: Math.max(1, record.expiresAt - Math.floor(Date.now() / 1000)) })]);
    return;
  }
  await databaseFor(env).orm.insert(oauthDeviceAuthorizations).values({ deviceCode, userCode: normalizeUserCode(userCode), record, expiresAt: new Date(record.expiresAt * 1000) }).onConflictDoUpdate({ target: oauthDeviceAuthorizations.deviceCode, set: { record, expiresAt: new Date(record.expiresAt * 1000), updatedAt: new Date() } });
}
async function deleteDevice(env: Env, deviceCode: string, userCode?: string): Promise<void> {
  if (!env.DATABASE && !env.HYPERDRIVE) { await Promise.all([env.OAUTH_KV!.delete(deviceKey(deviceCode)), ...(userCode ? [env.OAUTH_KV!.delete(userKey(userCode))] : [])]); return; }
  await databaseFor(env).orm.delete(oauthDeviceAuthorizations).where(eq(oauthDeviceAuthorizations.deviceCode, deviceCode));
}

export async function deviceAuthorization(request: Request, env: Env, oauth: OAuthHelpers, supportedScopes: string[]): Promise<Response> {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
  if (!env.OAUTH_KV && !env.DATABASE && !env.HYPERDRIVE) return oauthError("server_error", "OAuth storage is unavailable.", 500);
  const form = await request.formData();
  const basic = basicCredentials(request);
  const clientId = basic?.clientId ?? String(form.get("client_id") ?? "");
  if (!clientId) return oauthError("invalid_request", "client_id is required.");
  const client = await oauth.lookupClient(clientId);
  if (!client) return oauthError("invalid_client", "The OAuth client is unknown.", 401);
  if (!await authenticateDeviceClient(request, env, form, client)) return oauthError("invalid_client", "Client authentication failed.", 401);
  if (!client.redirectUris.length) return oauthError("unauthorized_client", "The client must have a registered redirect URI.");
  const requested = String(form.get("scope") ?? "").split(/\s+/).filter(Boolean);
  const invalidScope = requested.find(value => !supportedScopes.includes(value));
  if (invalidScope) return oauthError("invalid_scope", `Unsupported scope: ${invalidScope}`);
  const resource = String(form.get("resource") ?? `${env.APP_ORIGIN}/mcp`);
  if (resource !== `${env.APP_ORIGIN}/mcp`) return oauthError("invalid_target", "The resource must be the Factorize MCP endpoint.");

  const deviceCode = random();
  const codeVerifier = await verifier(deviceCode, env.SESSION_SIGNING_SECRET);
  let compactUserCode = "";
  for (let attempt = 0; attempt < 8; attempt++) {
    compactUserCode = Array.from(crypto.getRandomValues(new Uint8Array(8)), value => alphabet[value % alphabet.length]).join("");
    if (!await deviceCodeForUser(env, compactUserCode)) break;
    compactUserCode = "";
  }
  if (!compactUserCode) return oauthError("server_error", "Could not allocate a user code.", 500);
  const now = Math.floor(Date.now() / 1000);
  const record: DeviceRecord = {
    clientId, clientName: client.clientName ?? "this client", tokenEndpointAuthMethod: client.tokenEndpointAuthMethod ?? "none", scope: requested, resource,
    redirectUri: client.redirectUris[0], codeChallenge: await challenge(codeVerifier),
    createdAt: now, expiresAt: now + DEVICE_TTL, interval: DEFAULT_INTERVAL, status: "pending",
  };
  await writeDevice(env, deviceCode, compactUserCode, record);
  const verificationUri = `${env.APP_ORIGIN}/device`;
  const userCode = displayUserCode(compactUserCode);
  return json({
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: verificationUri,
    verification_uri_complete: `${verificationUri}?user_code=${encodeURIComponent(userCode)}`,
    expires_in: DEVICE_TTL,
    interval: DEFAULT_INTERVAL,
  });
}

export async function deviceToken(request: Request, env: Env, oauthProvider: { fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> }, ctx: ExecutionContext): Promise<Response> {
  if (!env.OAUTH_KV && !env.DATABASE && !env.HYPERDRIVE) return oauthError("server_error", "OAuth storage is unavailable.", 500);
  const form = await request.formData();
  const deviceCode = String(form.get("device_code") ?? "");
  const basic = basicCredentials(request);
  const clientId = basic?.clientId ?? String(form.get("client_id") ?? "");
  if (!deviceCode || !clientId) return oauthError("invalid_request", "device_code and client_id are required.");
  const record = await readDevice(env, deviceCode);
  const now = Math.floor(Date.now() / 1000);
  if (!record || record.expiresAt <= now) return oauthError("expired_token", "The device code has expired.");
  if (record.clientId !== clientId) return oauthError("invalid_grant", "The device code was not issued to this client.");
  if (!await authenticateDeviceClient(request, env, form, { clientId: record.clientId, redirectUris: [record.redirectUri], tokenEndpointAuthMethod: record.tokenEndpointAuthMethod })) return oauthError("invalid_client", "Client authentication failed.", 401);
  if (record.status === "denied") return oauthError("access_denied", "The resource owner denied the request.");
  if (record.status === "pending") {
    return oauthError("authorization_pending", "The resource owner has not completed authorization.");
  }
  if (!record.authorizationCode) return oauthError("server_error", "The approved device grant is incomplete.", 500);

  const exchange = new URLSearchParams();
  form.forEach((value, key) => { if (key === "client_id" || key === "client_secret") exchange.append(key, String(value)); });
  exchange.set("grant_type", "authorization_code");
  exchange.set("code", record.authorizationCode);
  exchange.set("redirect_uri", record.redirectUri);
  exchange.set("code_verifier", await verifier(deviceCode, env.SESSION_SIGNING_SECRET));
  exchange.set("resource", record.resource);
  const headers = new Headers({ "Content-Type": "application/x-www-form-urlencoded" });
  const authorization = request.headers.get("Authorization");
  if (authorization) headers.set("Authorization", authorization);
  const response = await oauthProvider.fetch(new Request(`${env.APP_ORIGIN}/oauth/token`, { method: "POST", headers, body: exchange }), env, ctx);
  if (response.ok) await deleteDevice(env, deviceCode);
  return response;
}

export async function deviceVerification(request: Request, env: Env, oauth: OAuthHelpers, session: { tenantId: string; userId: string; email: string; sessionVersion: number }): Promise<Response> {
  if (!env.OAUTH_KV && !env.DATABASE && !env.HYPERDRIVE) return new Response("OAuth storage is unavailable", { status: 500 });
  const url = new URL(request.url);
  const form = request.method === "POST" ? await request.formData() : null;
  const suppliedCode = String(form?.get("user_code") ?? url.searchParams.get("user_code") ?? "");
  const normalized = normalizeUserCode(suppliedCode);
  const deviceCode = normalized.length === 8 ? await deviceCodeForUser(env, normalized) : null;
  const record = deviceCode ? await readDevice(env, deviceCode) : null;
  const valid = record && record.status === "pending" && record.expiresAt > Math.floor(Date.now() / 1000);
  if (request.method === "GET") {
    const detail = valid ? `<h1>Authorize ${escapeHtml(record.clientName)}</h1><p>Signed in as ${escapeHtml(session.email)}.</p><p>This client is requesting: ${record.scope.length ? record.scope.map(escapeHtml).join(", ") : "basic access"}.</p>` : `<h1>Connect a device</h1><p>Enter the code shown by your application.</p>`;
    return new Response(`<!doctype html><html><head><meta charset="utf-8"><title>Connect a device — Factorize</title><link rel="stylesheet" href="/styles.css"></head><body><main>${detail}<form method="post"><label>Device code <input name="user_code" value="${escapeHtml(suppliedCode)}" required autocomplete="one-time-code"></label><p>${valid ? `<button name="decision" value="allow">Allow</button> <button name="decision" value="deny">Deny</button>` : `<button>Continue</button>`}</p></form></main></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  }
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, POST" } });
  if (!valid || !deviceCode || !record) return new Response("Invalid or expired device code", { status: 400 });
  if (form?.get("decision") === "deny") {
    record.status = "denied";
    await writeDevice(env, deviceCode, normalized, record);
    return confirmation("Authorization denied", "You can close this window.");
  }
  if (form?.get("decision") !== "allow") return Response.redirect(`${env.APP_ORIGIN}/device?user_code=${encodeURIComponent(displayUserCode(normalized))}`, 303);
  const props: OAuthProps = { tenantId: session.tenantId, userId: session.userId, sessionVersion: session.sessionVersion, scopes: record.scope };
  const authRequest: AuthRequest = { responseType: "code", clientId: record.clientId, redirectUri: record.redirectUri, scope: record.scope, state: "", codeChallenge: record.codeChallenge, codeChallengeMethod: "S256", resource: record.resource, issuer: env.APP_ORIGIN };
  const result = await oauth.completeAuthorization({ request: authRequest, userId: session.userId, metadata: { tenantId: session.tenantId }, scope: record.scope, props, revokeExistingGrants: false });
  record.status = "approved";
  record.authorizationCode = new URL(result.redirectTo).searchParams.get("code") ?? undefined;
  if (!record.authorizationCode) return new Response("Could not complete device authorization", { status: 500 });
  await writeDevice(env, deviceCode, normalized, record);
  return confirmation("Device connected", "Authorization is complete. You can close this window.");
}

export async function addDeviceMetadata(response: Response, appOrigin: string): Promise<Response> {
  if (!response.ok) return response;
  const metadata = await response.json() as Record<string, unknown>;
  metadata.device_authorization_endpoint = `${appOrigin}/oauth/device_authorization`;
  const grants = Array.isArray(metadata.grant_types_supported) ? metadata.grant_types_supported as string[] : [];
  metadata.grant_types_supported = [...new Set([...grants, DEVICE_GRANT])];
  return json(metadata);
}

export async function deviceClientRegistration(request: Request, env: Env, oauthProvider: { fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> }, ctx: ExecutionContext): Promise<Response> {
  if (request.method !== "POST" || !request.headers.get("Content-Type")?.toLowerCase().includes("application/json")) return oauthProvider.fetch(request, env, ctx);
  let registration: Record<string, unknown>;
  try { registration = await request.clone().json() as Record<string, unknown>; }
  catch { return oauthProvider.fetch(request, env, ctx); }
  const grants = Array.isArray(registration.grant_types) ? registration.grant_types.map(String) : [];
  if (!grants.includes(DEVICE_GRANT)) return oauthProvider.fetch(request, env, ctx);
  const originallyHadAuthorizationCode = grants.includes("authorization_code");
  const originalRedirectUris = Array.isArray(registration.redirect_uris) ? registration.redirect_uris.map(String) : [];
  const translated = {
    ...registration,
    grant_types: [...new Set([...grants.filter(value => value !== DEVICE_GRANT), "authorization_code"])],
    response_types: [...new Set([...(Array.isArray(registration.response_types) ? registration.response_types.map(String) : []), "code"])],
    redirect_uris: originalRedirectUris.length ? originalRedirectUris : [`${env.APP_ORIGIN}/oauth/device/callback`],
  };
  const headers = new Headers(request.headers);
  headers.set("Content-Type", "application/json");
  const response = await oauthProvider.fetch(new Request(request.url, { method: "POST", headers, body: JSON.stringify(translated) }), env, ctx);
  if (!response.ok) return response;
  const result = await response.json() as Record<string, unknown>;
  const returnedGrants = Array.isArray(result.grant_types) ? result.grant_types.map(String) : [];
  result.grant_types = [...new Set([...returnedGrants.filter(value => originallyHadAuthorizationCode || value !== "authorization_code"), DEVICE_GRANT])];
  if (!originallyHadAuthorizationCode) result.response_types = [];
  result.redirect_uris = originalRedirectUris;
  return json(result, response.status);
}

function escapeHtml(value: string): string { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }
function confirmation(title: string, message: string): Response {
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)} — Factorize</title><link rel="stylesheet" href="/styles.css"></head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
