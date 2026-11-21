import { Buffer } from "node:buffer";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ACCESS_SCOPES, accessTokenDigest } from "./access-tokens";
import { oidcJwks, oidcSigner } from "./oidc-signing";
import { databaseFor, type DatabaseClient } from "./postgres/database";
import type { Session } from "./session";
import type { Env, OAuthProps } from "./types";

const path = "/oauth/apps";
const scopesSupported = ["openid", "email", "offline_access", ...ACCESS_SCOPES];
const secretPattern = /^[A-Za-z0-9_-]{43}$/;
const verifierPattern = /^[A-Za-z0-9._~-]{43,128}$/;
const browserPage = "/app-consent";
const uuid = z.uuid();
const random = () => randomBytes(32).toString("base64url");

type App = {
  id: string;
  name: string;
  tenant_id: string;
  is_public: boolean;
  enabled: boolean;
  redirect_uris: string[];
  secret_digest: string | null;
  secret_version: number;
};
type Consent = {
  id: string;
  app_id: string;
  redirect_uri: string;
  challenge: string;
  state: string | null;
  nonce: string | null;
  scopes: string[];
};
type Credential = {
  connection_id: string;
  tenant_id: string;
  user_id: string;
  session_version: number;
  scopes: string[];
  email: string;
};
type Code = Credential & { challenge: string; redirect_uri: string; nonce: string | null };
type Refresh = Credential & { access_digest: string; refresh_expires_at: Date };

export const oidcConsentInput = z.object({ requestId: uuid, decision: z.enum(["allow", "deny"]) }).strict();
export const oidcConsentPreview = z.object({ appName: z.string(), scopes: z.array(z.string()) });
const activeMembership = "m.role='owner' AND m.session_version=c.session_version AND u.email_verified";
const joinedMembership = "JOIN app.members m ON m.tenant_id=c.tenant_id AND m.user_id=c.user_id JOIN app.auth_users u ON u.id=c.user_id";
const identityColumns = "c.id AS connection_id,c.tenant_id,c.user_id,c.session_version,m.email";
const credentialsActive = `c.revoked_at IS NULL AND a.enabled AND (a.is_public OR a.tenant_id=c.tenant_id) AND ${activeMembership}`;
const issuerOf = (env: Env) => env.APP_ORIGIN + path;
const noStore = { "Cache-Control": "no-store", Pragma: "no-cache", "X-Content-Type-Options": "nosniff" };
function json(value: unknown, status = 200, headers?: Record<string, string>) {
  return Response.json(value, { status, headers: { ...noStore, ...headers } });
}
function error(code: string, status = 400) {
  return json({ error: code }, status, status === 401 ? { "WWW-Authenticate": code === "invalid_client" ? 'Basic realm="Factorize Apps"' : 'Bearer error="invalid_token"' } : undefined);
}
function redirect(uri: string, params: Record<string, string | null>) {
  const target = new URL(uri);
  for (const [key, value] of Object.entries(params)) if (value !== null) target.searchParams.set(key, value);
  return target.href;
}
function go(uri: string) { return new Response(null, { status: 302, headers: { ...noStore, Location: uri, "Referrer-Policy": "no-referrer" } }); }
function scopesOf(value: string | null) {
  return [...new Set((value ?? "openid").split(/ +/).filter(Boolean))];
}
function visible(app: App, tenantId: string) { return app.enabled && !!app.secret_digest && (app.is_public || app.tenant_id === tenantId); }
async function findApp(db: Pick<DatabaseClient, "query">, id: string, lock = false) {
  return (await db.query<App>(`SELECT id,name,tenant_id,is_public,enabled,redirect_uris,secret_digest,secret_version
    FROM app.oauth_apps WHERE id=$1${lock ? " FOR UPDATE" : ""}`, [id])).rows[0];
}

async function authorize(request: Request, env: Env) {
  const url = new URL(request.url);
  if (request.method !== "GET" || url.search.length > 8192) return error("invalid_request");
  const q = url.searchParams;
  if (Array.from(q.keys()).some(key => q.getAll(key).length > 1)) return error("invalid_request");
  const id = q.get("client_id"), uri = q.get("redirect_uri");
  if (!uuid.safeParse(id).success || !uri) return error("invalid_request");
  const db = databaseFor(env);
  const app = await findApp(db.pool, id!);
  if (!app?.enabled || !app.secret_digest || !app.redirect_uris.includes(uri)) return error("invalid_request");
  const state = q.get("state"), nonce = q.get("nonce"), challenge = q.get("code_challenge");
  const reject = (cause: string) => go(redirect(uri, { error: cause, state }));
  if (q.get("response_type") !== "code") return reject("unsupported_response_type");
  if (state && state.length > 1024 || nonce && nonce.length > 1024 || !challenge || !secretPattern.test(challenge) || q.get("code_challenge_method") !== "S256") return reject("invalid_request");
  if (q.has("request") || q.has("request_uri") || q.has("max_age") || (q.has("response_mode") && q.get("response_mode") !== "query")) return reject("invalid_request");
  if (q.get("prompt") === "none") return reject("interaction_required");
  if (q.has("prompt") && q.get("prompt") !== "consent") return reject("invalid_request");
  const scopes = scopesOf(q.get("scope"));
  if (!scopes.includes("openid") || scopes.some(scope => !scopesSupported.includes(scope))) return reject("invalid_scope");

  await db.pool.query("DELETE FROM app.oidc_requests WHERE id IN (SELECT id FROM app.oidc_requests WHERE expires_at<now() LIMIT 100)");
  const { rows: [row] } = await db.pool.query<{ id: string }>(`INSERT INTO app.oidc_requests(app_id,redirect_uri,challenge,state,nonce,scopes,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,now()+interval '10 minutes') RETURNING id`, [app.id, uri, challenge, state, nonce, scopes]);
  const page = new URL(browserPage, env.APP_ORIGIN);
  page.searchParams.set("request", row.id);
  return go(page.href);
}

export async function inspectOidcConsent(env: Env, session: Pick<Session, "tenantId">, requestId: string) {
  const db = databaseFor(env);
  const { rows: [pending] } = await db.pool.query<Consent>("SELECT * FROM app.oidc_requests WHERE id=$1 AND decided_at IS NULL AND expires_at>now()", [requestId]);
  if (!pending) return null;
  const app = await findApp(db.pool, pending.app_id);
  if (!app || !visible(app, session.tenantId) || !app.redirect_uris.includes(pending.redirect_uri)) return null;
  return { appName: app.name, scopes: pending.scopes };
}

export async function decideOidcConsent(env: Env, session: Pick<Session, "tenantId" | "userId" | "sessionVersion">, input: z.infer<typeof oidcConsentInput>) {
  return databaseFor(env).transaction(async tx => {
    const { rows: [pending] } = await tx.query<Consent>("SELECT * FROM app.oidc_requests WHERE id=$1 AND decided_at IS NULL AND expires_at>now() FOR UPDATE", [input.requestId]);
    if (!pending) return null;
    const app = await findApp(tx, pending.app_id, true);
    if (!app || !visible(app, session.tenantId) || !app.redirect_uris.includes(pending.redirect_uri)) return null;
    await tx.query("UPDATE app.oidc_requests SET decided_at=now() WHERE id=$1", [input.requestId]);
    if (input.decision === "deny") return redirect(pending.redirect_uri, { error: "access_denied", state: pending.state });
    const { rows: [connection] } = await tx.query<{ id: string }>(`INSERT INTO app.oauth_app_connections(app_id,tenant_id,user_id,session_version,scopes)
      VALUES($1,$2,$3,$4,$5) RETURNING id`, [app.id, session.tenantId, session.userId, session.sessionVersion, pending.scopes]);
    const code = random();
    await tx.query(`INSERT INTO app.oidc_codes(digest,connection_id,secret_version,redirect_uri,challenge,nonce,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,now()+interval '5 minutes')`, [await accessTokenDigest(code), connection.id, app.secret_version,
        pending.redirect_uri, pending.challenge, pending.nonce]);
    return redirect(pending.redirect_uri, { code, state: pending.state });
  });
}

function clientCredentials(request: Request, form: URLSearchParams) {
  const auth = request.headers.get("Authorization");
  if (!auth) return { id: form.get("client_id"), secret: form.get("client_secret") };
  if (!/^Basic /i.test(auth) || auth.length > 1024 || form.has("client_secret") || form.has("client_id")) return {};
  try {
    const decoded = Buffer.from(auth.slice(6), "base64").toString();
    const boundary = decoded.indexOf(":");
    if (boundary === -1) return {};
    const unescape = (part: string) => decodeURIComponent(part.replaceAll("+", " "));
    return { id: unescape(decoded.slice(0, boundary)), secret: unescape(decoded.slice(boundary + 1)) };
  } catch {
    return {};
  }
}

async function matchesSecret(digest: string | null, value: string) {
  if (!digest || !secretPattern.test(value)) return false;
  const supplied = Buffer.from(await accessTokenDigest(value));
  const expected = Buffer.from(digest);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function claims(credential: Credential) {
  return credential.scopes.includes("email")
    ? { sub: credential.user_id, email: credential.email, email_verified: true }
    : { sub: credential.user_id };
}

async function mint(tx: DatabaseClient, app: App, credential: Credential, scopes: string[], refreshUntil?: Date) {
  const access = "fza_" + random();
  const refresh = scopes.includes("offline_access") ? "fzr_" + random() : null;
  const refreshExpiry = refresh ? refreshUntil ?? new Date(Date.now() + 30 * 86_400_000) : null;
  await tx.query(`INSERT INTO app.oidc_tokens(access_digest,refresh_digest,connection_id,secret_version,scopes,access_expires_at,refresh_expires_at)
    VALUES($1,$2,$3,$4,$5,now()+interval '1 hour',$6)`,
    [await accessTokenDigest(access), refresh ? await accessTokenDigest(refresh) : null, credential.connection_id, app.secret_version, scopes, refreshExpiry]);
  return { access_token: access, token_type: "Bearer", expires_in: 3600, scope: scopes.join(" "), ...(refresh ? { refresh_token: refresh } : {}) };
}

async function readForm(request: Request) {
  if (!/^application\/x-www-form-urlencoded(?:;|$)/i.test(request.headers.get("Content-Type") ?? "")) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let length = 0, body = "";
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    length += part.value.length;
    if (length > 8192) { await reader.cancel(); return null; }
    body += decoder.decode(part.value, { stream: true });
  }
  const form = new URLSearchParams(body + decoder.decode());
  return Array.from(form.keys()).some(key => form.getAll(key).length > 1) ? null : form;
}

async function token(request: Request, env: Env) {
  if (request.method !== "POST") return error("invalid_request", 405);
  const form = await readForm(request);
  if (!form) return error("invalid_request");
  const { id, secret } = clientCredentials(request, form);
  if (!uuid.safeParse(id).success || !secret) return error("invalid_client", 401);
  const method = form.get("grant_type");
  if (method !== "authorization_code" && method !== "refresh_token") return error("unsupported_grant_type");
  const db = databaseFor(env);
  const app = await findApp(db.pool, id!);
  if (!app?.enabled || !await matchesSecret(app.secret_digest, secret)) return error("invalid_client", 401);
  const sign = method === "authorization_code" ? await oidcSigner(env) : null;

  await db.pool.query("DELETE FROM app.oidc_codes WHERE digest IN (SELECT digest FROM app.oidc_codes WHERE expires_at<now() LIMIT 100)");
  await db.pool.query(`DELETE FROM app.oidc_tokens WHERE access_digest IN
    (SELECT access_digest FROM app.oidc_tokens WHERE access_expires_at<now() AND coalesce(refresh_expires_at,access_expires_at)<now() LIMIT 100)`);

  return db.transaction(async tx => {
    const current = await findApp(tx, app.id, true);
    if (!current?.enabled || current.secret_version !== app.secret_version) return error("invalid_client", 401);
    if (method === "authorization_code") {
      const code = form.get("code"), verifier = form.get("code_verifier");
      if (!code || !secretPattern.test(code) || !verifier || !verifierPattern.test(verifier)) return error("invalid_grant");
      const digest = await accessTokenDigest(code);
      const { rows: [grant] } = await tx.query<Code>(`SELECT ${identityColumns},c.scopes,g.challenge,g.redirect_uri,g.nonce
        FROM app.oidc_codes g JOIN app.oauth_app_connections c ON c.id=g.connection_id JOIN app.oauth_apps a ON a.id=c.app_id ${joinedMembership}
        WHERE g.digest=$1 AND c.app_id=$2 AND g.secret_version=$3 AND g.expires_at>now() AND ${credentialsActive}
        FOR UPDATE OF g,c`, [digest, app.id, app.secret_version]);
      if (!grant || grant.redirect_uri !== form.get("redirect_uri") || !current.redirect_uris.includes(grant.redirect_uri)
          || grant.challenge !== await accessTokenDigest(verifier)) return error("invalid_grant");
      const now = Math.floor(Date.now() / 1000);
      const idToken = await sign!({ ...claims(grant), iss: issuerOf(env), aud: app.id, iat: now, exp: now + 300, ...(grant.nonce ? { nonce: grant.nonce } : {}) });
      await tx.query("DELETE FROM app.oidc_codes WHERE digest=$1", [digest]);
      return json({ ...await mint(tx, current, grant, grant.scopes), id_token: idToken });
    }
    const refresh = form.get("refresh_token");
    if (!refresh || !/^fzr_[A-Za-z0-9_-]{43}$/.test(refresh)) return error("invalid_grant");
    const { rows: [grant] } = await tx.query<Refresh>(`SELECT ${identityColumns},t.scopes,t.access_digest,t.refresh_expires_at
      FROM app.oidc_tokens t JOIN app.oauth_app_connections c ON c.id=t.connection_id JOIN app.oauth_apps a ON a.id=c.app_id ${joinedMembership}
      WHERE t.refresh_digest=$1 AND c.app_id=$2 AND t.secret_version=$3 AND t.refresh_expires_at>now() AND ${credentialsActive}
      FOR UPDATE OF t,c`, [await accessTokenDigest(refresh), app.id, app.secret_version]);
    if (!grant) return error("invalid_grant");
    const requested = form.has("scope") ? scopesOf(form.get("scope")) : grant.scopes;
    if (!requested.length || requested.some(scope => !grant.scopes.includes(scope))) return error("invalid_scope");
    await tx.query("UPDATE app.oidc_tokens SET refresh_digest=NULL,refresh_expires_at=NULL WHERE access_digest=$1", [grant.access_digest]);
    return json(await mint(tx, current, grant, requested, grant.refresh_expires_at));
  });
}

async function access(request: Request, env: Env) {
  const credential = request.headers.get("Authorization")?.match(/^Bearer (fza_[A-Za-z0-9_-]{43})$/i)?.[1];
  if (!credential) return null;
  const { rows: [row] } = await databaseFor(env).pool.query<Credential>(`SELECT ${identityColumns},t.scopes
    FROM app.oidc_tokens t JOIN app.oauth_app_connections c ON c.id=t.connection_id JOIN app.oauth_apps a ON a.id=c.app_id ${joinedMembership}
    WHERE t.access_digest=$1 AND t.access_expires_at>now() AND t.secret_version=a.secret_version AND ${credentialsActive}`,
    [await accessTokenDigest(credential)]);
  return row ?? null;
}

export async function oidcApiAuth(request: Request, env: Env): Promise<OAuthProps | null> {
  const row = await access(request, env);
  if (!row) return null;
  return { userId: row.user_id, tenantId: row.tenant_id, sessionVersion: row.session_version,
    authMethod: "access_token", scopes: row.scopes.filter(scope => (ACCESS_SCOPES as readonly string[]).includes(scope)) };
}

export async function oidcRequest(request: Request, env: Env): Promise<Response | null> {
  const target = new URL(request.url).pathname;
  if (!target.startsWith(path + "/")) return null;
  const issuer = issuerOf(env);
  switch (target.slice(path.length)) {
    case "/authorize": return authorize(request, env);
    case "/token": return token(request, env);
    case "/userinfo": {
      if (request.method !== "GET" && request.method !== "POST") return error("invalid_request", 405);
      const row = await access(request, env);
      return row?.scopes.includes("openid") ? json(claims(row)) : error("invalid_token", 401);
    }
    case "/jwks": return request.method === "GET" ? json(await oidcJwks(env)) : error("invalid_request", 405);
    case "/.well-known/openid-configuration": return request.method === "GET" ? json({
      issuer, authorization_endpoint: issuer + "/authorize", token_endpoint: issuer + "/token", userinfo_endpoint: issuer + "/userinfo",
      jwks_uri: issuer + "/jwks", response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"],
      response_modes_supported: ["query"], subject_types_supported: ["public"], id_token_signing_alg_values_supported: ["RS256"],
      code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
      scopes_supported: scopesSupported, claims_supported: ["iss", "sub", "aud", "iat", "exp", "nonce", "email", "email_verified"],
    }) : error("invalid_request", 405);
    default: return error("invalid_request", 404);
  }
}
