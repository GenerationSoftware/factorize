import { z } from "zod";
import { readBrowserSession } from "./browser-session";
import { requestCookie } from "./session";
import { IdentityRepository } from "./postgres/identity-repository";
import { databaseFor, type DatabaseClient } from "./postgres/database";
import { decrypt, encrypt } from "./crypto";
import { AgentApiError } from "./agent-api-error";
import type { OutboundCredential } from "./outbound-forwarder";
import type { Env, OAuthProps } from "./types";

export const cloudflareCallback = "/oauth/cloudflare/callback";
const cookieName = "__Host-factorize_cloudflare_oauth";
const origin = "https://api.cloudflare.com";
const apiBase = "/client/v4";
const oauthOrigin = "https://dash.cloudflare.com";
const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const unavailable = () => new AgentApiError(503, "unavailable", "Cloudflare OAuth is not configured.");
const reconnect = () => new AgentApiError(401, "reconnect_required", "Reconnect Cloudflare in Integrations.");
type TokenFailureCode = "token_unreachable" | "token_rejected" | "token_client_rejected" | "token_grant_rejected" | "token_invalid_response";
type CallbackFailureCode = "configuration" | "attempt" | "storage" | TokenFailureCode;

class TokenFailure extends AgentApiError {
  constructor(readonly diagnostic: TokenFailureCode) {
    super(502, "cloudflare_unavailable", "Cloudflare did not complete the request. Try again if safe.");
  }
}
const invalidPath = () => new AgentApiError(400, "invalid_request", "Supply a path relative to the Cloudflare v4 API without credentials.");

export const cloudflareStartResult = z.object({ authorizationUrl: z.url() });
const metadata = z.object({ id: z.uuid(), name: z.string(), connected: z.boolean(), reconnectRequired: z.boolean() });
export const cloudflareStatus = z.object({ configured: z.boolean(), connections: z.array(metadata) });
const credentialsSchema = z.object({ access: z.string().min(1).max(8192), refresh: z.string().min(1).max(8192).optional(), expiration: z.number() });
type Credentials = z.infer<typeof credentialsSchema>;
type Owner = Pick<OAuthProps, "tenantId" | "userId" | "sessionVersion">;

export function cloudflareSettings(env: Env) {
  const defaults = env.CLOUDFLARE_OAUTH_DEFAULT_SCOPES ?? env.CLOUDFLARE_OAUTH_READ_SCOPES;
  const scopes = [...new Set(defaults?.trim().split(/\s+/).filter(Boolean) ?? [])];
  const configured = !!(env.CLOUDFLARE_OAUTH_CLIENT_ID?.trim() && env.CLOUDFLARE_OAUTH_CLIENT_SECRET
    && scopes.length > 0 && scopes.length <= 40 && scopes.every(scope => /^[a-z0-9][a-z0-9_.-]{0,127}$/.test(scope)));
  return { configured, scopes: [...new Set([...scopes, "offline_access"])] };
}

const cookie = (state: string) =>
  `${cookieName}=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${state ? 600 : 0}`;
const lock = (sql: DatabaseClient, tenant: string) =>
  sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["cloudflare:" + tenant]);
const seal = (value: Credentials, env: Env) => encrypt(JSON.stringify(value), env.CREDENTIAL_ENCRYPTION_KEY);

export async function startCloudflare(env: Env, owner: Owner) {
  const { configured, scopes } = cloudflareSettings(env);
  if (!configured) throw unavailable();
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const state = crypto.randomUUID();
  await databaseFor(env).transaction(async sql => {
    await lock(sql, owner.tenantId);
    await sql.query(`INSERT INTO app.cloudflare_oauth_attempts
      (tenant_id,user_id,session_version,state,verifier,expires_at)
      VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '10 minutes')
      ON CONFLICT(tenant_id) DO UPDATE SET user_id=excluded.user_id,session_version=excluded.session_version,state=excluded.state,
        verifier=excluded.verifier,expires_at=excluded.expires_at`,
      [owner.tenantId, owner.userId, owner.sessionVersion, state, await encrypt(verifier, env.CREDENTIAL_ENCRYPTION_KEY)]);
  });
  const target = new URL(oauthOrigin + "/oauth2/auth");
  target.search = new URLSearchParams({ client_id: env.CLOUDFLARE_OAUTH_CLIENT_ID!, redirect_uri: env.APP_ORIGIN + cloudflareCallback,
    response_type: "code", state, scope: scopes.join(" "), code_challenge: challenge, code_challenge_method: "S256" }).toString();
  return { authorizationUrl: target.href, cookie: cookie(state) };
}

const tokenResult = z.object({ access_token: z.string().min(1).max(8192), refresh_token: z.string().min(1).max(8192).optional(),
  expires_in: z.number().finite().positive(), token_type: z.string().refine(value => value.toLowerCase() === "bearer") });
async function exchange(env: Env, payload: Record<string, string>, previous?: Credentials): Promise<Credentials> {
  let response: Response;
  try {
    response = await fetch(oauthOrigin + "/oauth2/token", {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
      headers: { Accept: "application/json" }, body: new URLSearchParams({ ...payload,
        client_id: env.CLOUDFLARE_OAUTH_CLIENT_ID!, client_secret: env.CLOUDFLARE_OAUTH_CLIENT_SECRET! }),
    });
  } catch {
    throw new TokenFailure("token_unreachable");
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const result = z.object({ error: z.string() }).safeParse(body);
    const code = result.success ? result.data.error : undefined;
    if (code === "invalid_grant" || code === "invalid_token") {
      if (previous) throw reconnect();
      throw new TokenFailure("token_grant_rejected");
    }
    if (code === "invalid_client" || code === "unauthorized_client") throw new TokenFailure("token_client_rejected");
    throw new TokenFailure("token_rejected");
  }
  const result = tokenResult.safeParse(body);
  if (!result.success) throw new TokenFailure("token_invalid_response");
  // Cloudflare owns grant scope. Refresh the existing grant without requesting
  // any additional scope, and never synthesize or store local permissions.
  return { access: result.data.access_token, refresh: result.data.refresh_token ?? previous?.refresh,
    expiration: Date.now() + result.data.expires_in * 1000 };
}

export async function cloudflareOAuthCallback(request: Request, env: Env) {
  const result = (status: "connected" | "expired" | "denied" | "failed", keepCookie = false, failure?: CallbackFailureCode) => new Response(null, { status: 303, headers: {
    Location: env.APP_ORIGIN + "/integrations?" + new URLSearchParams({ cloudflare: status, ...(failure ? { cloudflare_error: failure } : {}) }).toString(), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
    ...(keepCookie ? {} : { "Set-Cookie": cookie("") }),
  } });
  if (request.method !== "GET") return new Response(null, { status: 405, headers: { Allow: "GET" } });
  let stage: CallbackFailureCode = "configuration";
  try {
    if (request.headers.has("Authorization")) return result("failed");
    if (!cloudflareSettings(env).configured) return result("failed", false, stage);
    stage = "attempt";
    const url = new URL(request.url), state = url.searchParams.get("state"), code = url.searchParams.get("code");
    const owner = await readBrowserSession(request, env);
    if (!owner || !z.uuid().safeParse(state).success || requestCookie(request, cookieName) !== state) return result("expired", true);
    const db = databaseFor(env);
    const member = await new IdentityRepository(db, owner.tenantId).member(owner.userId);
    if (member?.role !== "owner" || member.sessionVersion !== owner.sessionVersion) return result("expired");
    const attempt = await db.transaction(async sql => {
      await lock(sql, owner.tenantId);
      const row = (await sql.query<{ verifier: string }>(`SELECT verifier FROM app.cloudflare_oauth_attempts
        WHERE tenant_id=$1 AND user_id=$2 AND session_version=$3 AND state=$4 AND verifier IS NOT NULL AND expires_at>clock_timestamp()`,
      [owner.tenantId, owner.userId, owner.sessionVersion, state])).rows[0];
      if (row) await sql.query("UPDATE app.cloudflare_oauth_attempts SET verifier=NULL WHERE tenant_id=$1 AND state=$2", [owner.tenantId, state]);
      return row;
    });
    if (!attempt) return result("expired", true);
    if (!code || code.length > 4096 || url.searchParams.has("error")) return result("denied");
    const credentials = await exchange(env, { grant_type: "authorization_code", code,
      redirect_uri: env.APP_ORIGIN + cloudflareCallback, code_verifier: await decrypt(attempt.verifier, env.CREDENTIAL_ENCRYPTION_KEY) });
    stage = "storage";
    const encrypted = await seal(credentials, env);
    if (!await readBrowserSession(request, env)) return result("expired");
    const saved = await db.transaction(async sql => {
      await lock(sql, owner.tenantId);
      const finish = await sql.query(`DELETE FROM app.cloudflare_oauth_attempts a
        WHERE tenant_id=$1 AND user_id=$2 AND session_version=$3 AND state=$4 AND verifier IS NULL AND expires_at>clock_timestamp()
          AND EXISTS (SELECT 1 FROM app.members m JOIN app.auth_users u ON u.id=m.user_id
             WHERE m.tenant_id=a.tenant_id AND m.user_id=a.user_id AND m.role='owner'
               AND m.session_version=a.session_version AND u.email_verified FOR SHARE OF m,u)
        RETURNING state`, [owner.tenantId, owner.userId, owner.sessionVersion, state]);
      if (!finish.rowCount) return false;
      const { rows: [connection] } = await sql.query<{ id: string }>(`INSERT INTO app.cloudflare_connections
        (tenant_id,id,account_id,account_name,encrypted_credentials) VALUES($1,$2,NULL,'Cloudflare',$3)
        ON CONFLICT (tenant_id) WHERE account_id IS NULL
        DO UPDATE SET encrypted_credentials=excluded.encrypted_credentials RETURNING id`,
      [owner.tenantId, crypto.randomUUID(), encrypted]);
      await sql.query(`INSERT INTO app.agent_integrations AS i(tenant_id,kind,credential_id,name,description,available,policy)
        VALUES($1,'cloudflare',$2,'Cloudflare','Cloudflare REST API',true,'requestable')
        ON CONFLICT(tenant_id,kind,credential_id) DO UPDATE SET available=true,epoch=i.epoch+1,revision=i.revision+1`,
      [owner.tenantId, connection.id]);
      return true;
    });
    return saved ? result("connected") : result("expired", true);
  } catch (error) {
    // Return fixed codes only. Neither provider data nor exception text belongs in the redirect.
    return result("failed", false, error instanceof TokenFailure ? error.diagnostic : stage);
  }
}

export async function cloudflareState(env: Env, owner: Owner) {
  const rows = (await databaseFor(env).pool.query<{ id: string; name: string; legacy: boolean }>(
    `SELECT id,account_name AS name,account_id IS NOT NULL AS legacy FROM app.cloudflare_connections
     WHERE tenant_id=$1 AND encrypted_credentials IS NOT NULL ORDER BY account_id NULLS FIRST,id`, [owner.tenantId])).rows;
  return cloudflareStatus.parse({ configured: cloudflareSettings(env).configured,
    connections: rows.map(row => ({ id: row.id, name: row.name, connected: !row.legacy, reconnectRequired: row.legacy })) });
}

export async function disconnectCloudflare(env: Env, owner: Owner, id: string) {
  await databaseFor(env).transaction(async sql => {
    await lock(sql, owner.tenantId);
    const result = await sql.query(`UPDATE app.cloudflare_connections SET encrypted_credentials=NULL
      WHERE tenant_id=$1 AND id=$2 RETURNING id`, [owner.tenantId, id]);
    if (!result.rowCount) throw new AgentApiError(404, "not_found", "Cloudflare connection not found.");
    await sql.query("UPDATE app.agent_integrations SET available=false,epoch=epoch+1,revision=revision+1 WHERE tenant_id=$1 AND kind='cloudflare' AND credential_id=$2", [owner.tenantId, id]);
    await sql.query("DELETE FROM app.cloudflare_oauth_attempts WHERE tenant_id=$1", [owner.tenantId]);
  });
  return { ok: true } as const;
}

export function cloudflarePath(relative: string) {
  if (!relative.startsWith("/") || relative.startsWith("//") || /[\\\r\n\0#]/.test(relative)) throw invalidPath();
  const [path] = relative.split("?", 1);
  // Validate the transport boundary, not Cloudflare's resource families.
  if (/%(?:2f|5c|25|00)/i.test(path!)) throw invalidPath();
  const target = new URL(origin + apiBase + relative);
  if (!target.pathname.startsWith(apiBase + "/") ||
      [...target.searchParams.keys()].some(key => /^(access[-_]?token|api[-_]?key|x[-_]auth[-_](?:key|email|user[-_]service))$/i.test(key))) throw invalidPath();
  return target.pathname + target.search;
}

export async function cloudflareCredential(env: Env, tenant: string, id: string, relative: string): Promise<OutboundCredential> {
  const path = cloudflarePath(relative);
  if (!cloudflareSettings(env).configured) throw unavailable();
  const credentials = await databaseFor(env).transaction(async sql => {
    await lock(sql, tenant);
    const row = (await sql.query<{ encrypted_credentials: string | null }>(
      "SELECT encrypted_credentials FROM app.cloudflare_connections WHERE tenant_id=$1 AND id=$2 AND account_id IS NULL",
      [tenant, id])).rows[0];
    // Legacy tokens were deliberately restricted in Factorize. Only fresh
    // consent uses the new broker, even if this function is called directly.
    if (!row?.encrypted_credentials) throw reconnect();
    let current = credentialsSchema.parse(JSON.parse(await decrypt(row.encrypted_credentials, env.CREDENTIAL_ENCRYPTION_KEY)));
    if (current.expiration <= Date.now() + 30_000) {
      if (!current.refresh) throw reconnect();
      current = await exchange(env, { grant_type: "refresh_token", refresh_token: current.refresh }, current);
      await sql.query("UPDATE app.cloudflare_connections SET encrypted_credentials=$3 WHERE tenant_id=$1 AND id=$2",
        [tenant, id, await seal(current, env)]);
    }
    return current;
  });
  return { origin, path, credential: credentials.access, requestHeaders: ["accept", "content-type", "if-match", "if-none-match"] };
}

export async function pruneCloudflareOAuth(sql: DatabaseClient) {
  await sql.query(`DELETE FROM app.cloudflare_oauth_attempts WHERE tenant_id IN (
    SELECT tenant_id FROM app.cloudflare_oauth_attempts WHERE expires_at<clock_timestamp() ORDER BY expires_at LIMIT 250)`);
}
