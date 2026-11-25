import { z } from "zod";
import { readBrowserSession } from "./browser-session";
import { requestCookie } from "./session";
import { IdentityRepository } from "./postgres/identity-repository";
import { databaseFor, type DatabaseClient } from "./postgres/database";
import { decrypt, encrypt } from "./crypto";
import { AgentApiError } from "./agent-api-error";
import type { Env, OAuthProps } from "./types";

export const cloudflareCallback = "/oauth/cloudflare/callback";
export const cloudflareOrigin = "https://api.cloudflare.com";
export const cloudflareCookie = "__Host-factorize_cloudflare_oauth";
const offlineAccess = "offline_access";
const tokenEndpoint = "https://dash.cloudflare.com/oauth2/token";
const idPattern = /^[0-9a-f]{32}$/;
const encoder = new TextEncoder();
const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const unavailable = () => new AgentApiError(503, "unavailable", "Cloudflare OAuth is not configured.");
const canWriteDns = (scope: string | undefined, credentials?: Credentials | null) =>
  !!(scope && credentials?.dnsWriteScope === scope && credentials.scopes.includes(scope));
const reconnect = () => new AgentApiError(401, "reconnect_required", "Cloudflare authorization expired or was revoked. Reconnect in Integrations.");
const forbidden = () => new AgentApiError(403, "forbidden", "This operation is outside the Cloudflare connection's account or permission boundaries.");
const upstream = () => new AgentApiError(502, "cloudflare_unavailable", "Cloudflare did not complete the request. Try again if safe.");

const accountSchema = z.object({ id: z.string().regex(idPattern), name: z.string().min(1).max(250) });
type Account = z.infer<typeof accountSchema>;
export const cloudflareStartInput = z.object({ enableWrites: z.boolean().default(false) }).strict();
export const cloudflareStartResult = z.object({ authorizationUrl: z.url() });
export const cloudflareSelectInput = z.object({ accountId: z.string().regex(idPattern) }).strict();
const metadata = z.object({ id: z.uuid(), accountId: z.string().regex(idPattern), name: z.string(), writeEnabled: z.boolean(), connected: z.boolean() });
export const cloudflareStatus = z.object({ configured: z.boolean(), writeAvailable: z.boolean(), accounts: z.array(accountSchema), connections: z.array(metadata) });
const credsSchema = z.object({ access: z.string().min(1).max(8192), refresh: z.string().min(1).max(8192).optional(), expiration: z.number(), scopes: z.array(z.string()), dnsWriteScope: z.string().optional() });
type Credentials = z.infer<typeof credsSchema>;
type Pending = { accounts: Account[]; credentials: Credentials };
type Connection = { id: string; account_id: string; account_name: string; write_enabled: boolean; encrypted_credentials: string | null };
type Attempt = { state: string; verifier: string | null; scopes: string[]; write_requested: boolean; encrypted_pending: string | null };
type Owner = Pick<OAuthProps, "tenantId" | "userId" | "sessionVersion">;

const split = (value?: string) => [...new Set(value?.trim().split(/\s+/).filter(Boolean) ?? [])];
export function cloudflareSettings(env: Env) {
  const read = split(env.CLOUDFLARE_OAUTH_READ_SCOPES), write = split(env.CLOUDFLARE_OAUTH_WRITE_SCOPES);
  const valid = (scope: string, suffix: string) => scope.length <= 128
    && /^[a-z0-9][a-z0-9_.-]*$/.test(scope) && scope.endsWith(suffix);
  const configured = !!(env.CLOUDFLARE_OAUTH_CLIENT_ID?.trim() && env.CLOUDFLARE_OAUTH_CLIENT_SECRET
    && read.length > 0 && read.length <= 40 && write.length <= 40
    && read.every(scope => valid(scope, ".read")) && write.every(scope => valid(scope, ".write")));
  const mapped = env.CLOUDFLARE_OAUTH_DNS_WRITE_SCOPE?.trim();
  const dnsWriteScope = configured && mapped && write.includes(mapped) ? mapped : undefined;
  return { configured, read, dnsWriteScope };
}
export const cloudflareCookieValue = (state: string) =>
  `${cloudflareCookie}=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${state ? 600 : 0}`;
const lock = (sql: DatabaseClient, tenant: string) => sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["cloudflare:" + tenant]);
const open = async <T>(input: string, env: Env) => JSON.parse(await decrypt(input, env.CREDENTIAL_ENCRYPTION_KEY)) as T;
const sealed = (value: unknown, env: Env) => encrypt(JSON.stringify(value), env.CREDENTIAL_ENCRYPTION_KEY);

export async function startCloudflare(env: Env, owner: Owner, writes: boolean) {
  const { configured, read, dnsWriteScope } = cloudflareSettings(env);
  if (!configured) throw unavailable();
  if (writes && !dnsWriteScope) throw forbidden();
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(verifier))));
  const state = crypto.randomUUID(), scopes = writes && dnsWriteScope ? [...read, dnsWriteScope] : read;
  await databaseFor(env).transaction(async sql => {
    await lock(sql, owner.tenantId);
    await sql.query(`INSERT INTO app.cloudflare_oauth_attempts
      (tenant_id,user_id,session_version,state,verifier,scopes,write_requested,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp()+interval '10 minutes')
      ON CONFLICT(tenant_id) DO UPDATE SET user_id=excluded.user_id,session_version=excluded.session_version,state=excluded.state,
      verifier=excluded.verifier,scopes=excluded.scopes,write_requested=excluded.write_requested,expires_at=excluded.expires_at,encrypted_pending=NULL`,
      [owner.tenantId, owner.userId, owner.sessionVersion, state, await encrypt(verifier, env.CREDENTIAL_ENCRYPTION_KEY), scopes, writes]);
  });
  const target = new URL("https://dash.cloudflare.com/oauth2/auth");
  target.search = new URLSearchParams({ client_id: env.CLOUDFLARE_OAUTH_CLIENT_ID!, redirect_uri: env.APP_ORIGIN + cloudflareCallback,
    response_type: "code", state, scope: [...scopes, offlineAccess].join(" "), code_challenge: challenge, code_challenge_method: "S256" }).toString();
  return { authorizationUrl: target.href, cookie: cloudflareCookieValue(state) };
}

const tokenResult = z.object({ access_token: z.string().min(1).max(8192), refresh_token: z.string().min(1).max(8192).optional(),
  expires_in: z.number().finite().positive(), token_type: z.string().refine(value => value.toLowerCase() === "bearer"), scope: z.string().optional() });
async function exchange(env: Env, payload: Record<string, string>, ceiling: string[], previous?: Credentials) {
  const response = await fetch(tokenEndpoint, { method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
    headers: { Accept: "application/json" }, body: new URLSearchParams({ ...payload,
      client_id: env.CLOUDFLARE_OAUTH_CLIENT_ID!, client_secret: env.CLOUDFLARE_OAUTH_CLIENT_SECRET! }) });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(body);
    if (previous && error.success && ["invalid_grant", "invalid_token"].includes(error.data.error)) throw reconnect();
    throw upstream();
  }
  const result = tokenResult.parse(body);
  // Optional writes are never assumed granted on first exchange. Omitted
  // refresh scopes may only retain the already confirmed credential ceiling.
  const resultScopes = result.scope === undefined ? previous?.scopes ?? ceiling.filter(scope => scope.endsWith(".read")) : split(result.scope);
  return { access: result.access_token, refresh: result.refresh_token ?? previous?.refresh,
    expiration: Date.now() + result.expires_in * 1000, scopes: resultScopes.filter(scope => ceiling.includes(scope)), dnsWriteScope: previous?.dnsWriteScope };
}

async function apiJson(access: string, path: string) {
  const response = await fetch(cloudflareOrigin + "/client/v4" + path, {
    headers: { Authorization: "Bearer " + access, Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(10_000) });
  if (response.status === 401) throw reconnect();
  if (response.status === 403 || response.status === 404) throw forbidden();
  if (!response.ok) throw upstream();
  const body = await response.json() as { success?: boolean; result?: unknown; result_info?: { total_pages?: number } };
  if (body.success !== true) throw upstream();
  return body;
}

async function listAccounts(access: string) {
  const accounts: Account[] = [];
  for (let page = 1; page <= 10; page++) {
    const result = await apiJson(access, "/accounts?per_page=50&page=" + page);
    accounts.push(...z.array(accountSchema).max(50).parse(result.result));
    if (page >= (result.result_info?.total_pages ?? page)) break;
  }
  if (!accounts.length) throw forbidden();
  return accounts;
}

export async function cloudflareOAuthCallback(request: Request, env: Env) {
  const result = (status: string, keepCookie = false) => new Response(null, { status: 303, headers: {
    Location: env.APP_ORIGIN + "/integrations?cloudflare=" + status, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
    ...(keepCookie ? {} : { "Set-Cookie": cloudflareCookieValue("") }),
  } });
  if (request.method !== "GET") return new Response(null, { status: 405, headers: { Allow: "GET" } });
  try {
    const settings = cloudflareSettings(env);
    if (request.headers.has("Authorization") || !settings.configured) return result("failed");
    const url = new URL(request.url), state = url.searchParams.get("state"), code = url.searchParams.get("code");
    const owner = await readBrowserSession(request, env);
    if (!owner || !z.uuid().safeParse(state).success || requestCookie(request, cloudflareCookie) !== state) return result("expired", true);
    const db = databaseFor(env);
    const member = await new IdentityRepository(db, owner.tenantId).member(owner.userId);
    if (member?.role !== "owner" || member.sessionVersion !== owner.sessionVersion) return result("expired");
    const attempt = await db.transaction(async sql => {
      await lock(sql, owner.tenantId);
      const row = (await sql.query<Attempt>(`SELECT * FROM app.cloudflare_oauth_attempts
        WHERE tenant_id=$1 AND user_id=$2 AND session_version=$3 AND state=$4 AND verifier IS NOT NULL AND expires_at>clock_timestamp()`,
        [owner.tenantId, owner.userId, owner.sessionVersion, state])).rows[0];
      if (row) await sql.query("UPDATE app.cloudflare_oauth_attempts SET verifier=NULL WHERE tenant_id=$1 AND state=$2", [owner.tenantId, state]);
      return row;
    });
    if (!attempt) return result("expired", true);
    if (!code || code.length > 4096 || url.searchParams.has("error")) return result("denied");
    const dnsWriteScope = attempt.write_requested ? settings.dnsWriteScope : undefined;
    const ceiling = attempt.scopes.filter(scope => settings.read.includes(scope) || scope === dnsWriteScope);
    if (!ceiling.some(scope => settings.read.includes(scope))) return result("failed");
    const credentials = await exchange(env, { grant_type: "authorization_code", code, redirect_uri: env.APP_ORIGIN + cloudflareCallback,
      code_verifier: await decrypt(attempt.verifier!, env.CREDENTIAL_ENCRYPTION_KEY) }, ceiling);
    if (dnsWriteScope && credentials.scopes.includes(dnsWriteScope)) credentials.dnsWriteScope = dnsWriteScope;
    const accounts = await listAccounts(credentials.access);
    const pending = await sealed({ credentials, accounts }, env);
    const stored = await db.pool.query(`UPDATE app.cloudflare_oauth_attempts SET encrypted_pending=$3
      WHERE tenant_id=$1 AND state=$2 AND expires_at>clock_timestamp() RETURNING state`, [owner.tenantId, state, pending]);
    return stored.rowCount ? result("select", true) : result("expired", true);
  } catch {
    return result("failed");
  }
}

export async function cloudflareState(env: Env, owner: Owner, request: Request) {
  const db = databaseFor(env), settings = cloudflareSettings(env);
  const rows = (await db.pool.query<Connection>(`SELECT id,account_id,account_name,write_enabled,encrypted_credentials FROM app.cloudflare_connections
    WHERE tenant_id=$1 ORDER BY account_name,id`, [owner.tenantId])).rows;
  const state = requestCookie(request, cloudflareCookie);
  const attempt = z.uuid().safeParse(state).success ? (await db.pool.query<Attempt>(`SELECT encrypted_pending FROM app.cloudflare_oauth_attempts
     WHERE tenant_id=$1 AND user_id=$2 AND session_version=$3 AND state=$4 AND expires_at>clock_timestamp()`,
    [owner.tenantId, owner.userId, owner.sessionVersion, state])).rows[0] : undefined;
  const accounts = attempt?.encrypted_pending ? (await open<Pending>(attempt.encrypted_pending, env)).accounts : [];
  const connections = await Promise.all(rows.map(async row => {
    const credentials = row.write_enabled && row.encrypted_credentials && settings.dnsWriteScope
      ? await open<Credentials>(row.encrypted_credentials, env).catch(() => null) : null;
    return { id: row.id, accountId: row.account_id, name: row.account_name,
      writeEnabled: canWriteDns(settings.dnsWriteScope, credentials), connected: !!row.encrypted_credentials };
  }));
  return cloudflareStatus.parse({ configured: settings.configured, writeAvailable: !!settings.dnsWriteScope, accounts, connections });
}

export async function selectCloudflare(env: Env, owner: Owner, request: Request, accountId: string) {
  const state = requestCookie(request, cloudflareCookie);
  if (!z.uuid().safeParse(state).success) throw forbidden();
  return databaseFor(env).transaction(async sql => {
    await lock(sql, owner.tenantId);
    const attempt = (await sql.query<Attempt>(`SELECT encrypted_pending,write_requested FROM app.cloudflare_oauth_attempts
      WHERE tenant_id=$1 AND user_id=$2 AND session_version=$3 AND state=$4 AND expires_at>clock_timestamp()`,
      [owner.tenantId, owner.userId, owner.sessionVersion, state])).rows[0];
    if (!attempt?.encrypted_pending) throw forbidden();
    const pending = await open<Pending>(attempt.encrypted_pending, env);
    const account = pending.accounts.find(row => row.id === accountId);
    if (!account) throw forbidden();
    const writeEnabled = attempt.write_requested && canWriteDns(cloudflareSettings(env).dnsWriteScope, pending.credentials);
    const { rows: [saved] } = await sql.query<{id: string}>(`INSERT INTO app.cloudflare_connections
      (tenant_id,id,account_id,account_name,write_enabled,encrypted_credentials) VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT(tenant_id,account_id) DO UPDATE SET account_name=excluded.account_name,
      write_enabled=excluded.write_enabled,encrypted_credentials=excluded.encrypted_credentials RETURNING id`,
      [owner.tenantId, crypto.randomUUID(), account.id, account.name, writeEnabled, await sealed(pending.credentials, env)]);
    await sql.query(`INSERT INTO app.agent_integrations AS i(tenant_id,kind,credential_id,name,description,available,policy)
      VALUES($1,'cloudflare',$2,$3,'Selected Cloudflare account',true,'requestable')
      ON CONFLICT(tenant_id,kind,credential_id) DO UPDATE SET name=excluded.name,available=true,epoch=i.epoch+1,revision=i.revision+1`,
      [owner.tenantId, saved.id, "Cloudflare · " + account.name]);
    await sql.query("DELETE FROM app.cloudflare_oauth_attempts WHERE tenant_id=$1", [owner.tenantId]);
    return { ok: true };
  });
}

export async function disconnectCloudflare(env: Env, owner: Owner, id: string) {
  return databaseFor(env).transaction(async sql => {
    await lock(sql, owner.tenantId);
    const result = await sql.query(`UPDATE app.cloudflare_connections SET encrypted_credentials=NULL,write_enabled=false
      WHERE tenant_id=$1 AND id=$2 AND encrypted_credentials IS NOT NULL RETURNING id`, [owner.tenantId, id]);
    if (!result.rowCount) throw forbidden();
    await sql.query("UPDATE app.agent_integrations SET available=false,epoch=epoch+1,revision=revision+1 WHERE tenant_id=$1 AND kind='cloudflare' AND credential_id=$2", [owner.tenantId, id]);
    await sql.query("DELETE FROM app.cloudflare_oauth_attempts WHERE tenant_id=$1", [owner.tenantId]);
    return { ok: true };
  });
}

const readFamilies = {
  account: /^(?:workers\/(?:scripts|domains)|storage\/kv\/namespaces|r2\/buckets(?:\/[A-Za-z0-9_-]+)?|d1\/database(?:\/[A-Za-z0-9_-]+)?|queues(?:\/[A-Za-z0-9_-]+)?|pages\/projects)$/,
  zone: /^(?:dns_records(?:\/[a-f0-9]{32})?|dnssec|settings(?:\/[A-Za-z0-9_-]+)?|workers\/routes(?:\/[a-f0-9]{32})?|cache\/cache_reserve|analytics\/dashboard)$/,
};
const sensitive = /(?:^|\/)(?:tokens?|api[-_]keys?|members?|memberships?|roles?|permissions?|secrets?|secret_text|credentials?|oauth_clients|user|bindings|settings)(?:\/|$)/i;
export function cloudflareTarget(input: string, verb: string, account: string, writeEnabled: boolean) {
  const [path, query = ""] = input.split(/\?(.*)/s, 2);
  const raw = path.startsWith("/client/v4/") ? path.slice("/client/v4".length) : path;
  if (!/^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)$/.test(raw) || /[%\\#\r\n]/.test(raw) || /[#\r\n]/.test(query)) throw forbidden();
  const search = new URLSearchParams(query);
  for (const key of search.keys()) if (!/^[A-Za-z0-9_.-]{1,64}$/.test(key) || /(?:^|[._\[\]])(?:account|zone)(?:$|[._\[\]])/i.test(key)) throw forbidden();
  const read = verb === "GET" || verb === "HEAD";
  if (raw === "/accounts" && read && !search.size) return { path: "/client/v4/accounts/" + account };
  if (raw === "/zones" && read) {
    search.set("account.id", account);
    return { path: "/client/v4/zones?" + search.toString(), zone: undefined };
  }
  const parts = raw.slice(1).split("/"), [kind, resource, ...rest] = parts;
  const suffix = rest.join("/");
  if (!idPattern.test(resource ?? "") || (kind !== "accounts" && kind !== "zones")) throw forbidden();
  if (kind === "accounts" && resource !== account) throw forbidden();
  const safeZoneSettings = kind === "zones" && /^settings(?:\/[A-Za-z0-9_-]+)?$/.test(suffix);
  if (sensitive.test(suffix) && !safeZoneSettings) throw forbidden();
  if (read) {
    if (suffix && !readFamilies[kind === "accounts" ? "account" : "zone"].test(suffix)) throw forbidden();
  } else {
    // Mutations with account transfers, credentials, script uploads, or a
    // separately scoped target need a dedicated policy before being exposed.
    const safeDnsWrite = kind === "zones" && (verb === "POST" ? suffix === "dns_records" :
      ["PATCH", "PUT", "DELETE"].includes(verb) && /^dns_records\/[a-f0-9]{32}$/.test(suffix));
    if (!writeEnabled || !safeDnsWrite || search.size) throw forbidden();
  }
  return { path: "/client/v4" + raw + (search.size ? "?" + search.toString() : ""), zone: kind === "zones" ? resource : undefined };
}

export async function cloudflareCredential(env: Env, tenant: string, id: string, path: string, verb: string) {
  const settings = cloudflareSettings(env);
  if (!settings.configured) throw unavailable();
  const db = databaseFor(env);
  const credential = await db.transaction(async sql => {
    await lock(sql, tenant);
    const connection = (await sql.query<Connection>("SELECT * FROM app.cloudflare_connections WHERE tenant_id=$1 AND id=$2", [tenant, id])).rows[0];
    if (!connection?.encrypted_credentials) throw reconnect();
    let credentials = credsSchema.parse(await open<Credentials>(connection.encrypted_credentials, env));
    cloudflareTarget(path, verb, connection.account_id, connection.write_enabled && canWriteDns(settings.dnsWriteScope, credentials));
    if (credentials.expiration <= Date.now() + 30_000) {
      if (!credentials.refresh) throw reconnect();
      try {
        credentials = await exchange(env, { grant_type: "refresh_token", refresh_token: credentials.refresh },
          credentials.scopes.filter(scope => settings.read.includes(scope) || scope === settings.dnsWriteScope), credentials);
      } catch (error) { if (error instanceof AgentApiError) throw error; throw upstream(); }
      await sql.query("UPDATE app.cloudflare_connections SET encrypted_credentials=$3 WHERE tenant_id=$1 AND id=$2",
        [tenant, id, await sealed(credentials, env)]);
    }
    const writes = connection.write_enabled && canWriteDns(settings.dnsWriteScope, credentials);
    return { target: cloudflareTarget(path, verb, connection.account_id, writes), access: credentials.access, account: connection.account_id };
  });
  if (credential.target.zone) {
    const { result } = await apiJson(credential.access, "/zones/" + credential.target.zone);
    const owner = z.object({ account: z.object({ id: z.string() }) }).safeParse(result);
    if (!owner.success || owner.data.account.id !== credential.account) throw forbidden();
  }
  return { origin: cloudflareOrigin, path: credential.target.path, credential: credential.access };
}

export async function pruneCloudflareOAuth(sql: DatabaseClient) {
  await sql.query(`DELETE FROM app.cloudflare_oauth_attempts WHERE tenant_id IN
    (SELECT tenant_id FROM app.cloudflare_oauth_attempts WHERE expires_at<now() ORDER BY expires_at LIMIT 500)
    AND expires_at<now()`);
}
