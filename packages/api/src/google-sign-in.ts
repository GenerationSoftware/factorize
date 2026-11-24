import { serialize } from "hono/utils/cookie";
import { z } from "zod";
import { normalizeEmail, tokenDigest, verifyPassword } from "./auth";
import { sendAuthEmail } from "./auth-email";
import { requestCookie } from "./session";
import { databaseFor, type DatabaseClient } from "./postgres/database";
import { AuthRepository } from "./postgres/auth-repository";
import { createJwksResolver } from "./vm-oidc";
import type { Env } from "./types";

export const googleCallbackPath = "/oauth/google/sign-in/callback";
const cookieName = "factorize_google_attempt";
const maxAge = 600;
const tokenUrl = "https://oauth2.googleapis.com/token";
const authorizationUrl = "https://accounts.google.com/o/oauth2/v2/auth";
const jwksUri = "https://www.googleapis.com/oauth2/v3/certs";
const encoder = new TextEncoder();

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const random = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
const secureCookie = (env: Env, value: string, maxAge: number) => serialize(cookieName, value, {
  path: "/", httpOnly: true, secure: new URL(env.APP_ORIGIN).protocol === "https:", sameSite: "Lax", maxAge,
});
export const clearGoogleCookie = (env: Env) => secureCookie(env, "", 0);
export const googleEnabled = (env: Env) => !!(env.GOOGLE_SIGN_IN_CLIENT_ID && env.GOOGLE_SIGN_IN_CLIENT_SECRET);
const redirectUri = (env: Env) => new URL(googleCallbackPath, env.APP_ORIGIN).href;
type Attempt = {
  id: string; browser_digest: string; verifier: string | null; nonce: string; return_to: string; connection_id: string | null;
  google_subject: string | null; email: string | null; existing_user_id: string | null; email_confirmed: boolean; password_attempts: number;
};
export type GoogleIdentity = { userId: string; tenantId: string; email: string; sessionVersion: number };
const fail = (status: number, message: string) => ({ status, message } as const);
const expired = () => fail(400, "This Google sign-in expired. Start again from Factorize.");

async function digestFor(request: Request, env: Env) {
  const browser = requestCookie(request, cookieName);
  return browser && /^[A-Za-z0-9_-]{43}$/.test(browser) ? tokenDigest(browser, env.SESSION_SIGNING_SECRET) : null;
}

export async function startGoogleSignIn(env: Env, returnTo: string, connectionId?: string) {
  const db = databaseFor(env);
  const id = crypto.randomUUID(), browser = random(), verifier = random(), nonce = random();
  await db.pool.query("DELETE FROM app.google_sign_in_attempts WHERE expires_at < now()");
  await db.pool.query(`INSERT INTO app.google_sign_in_attempts
    (id,browser_digest,verifier,nonce,return_to,connection_id,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,now()+interval '10 minutes')`,
    [id, await tokenDigest(browser, env.SESSION_SIGNING_SECRET), verifier, nonce, returnTo, connectionId ?? null]);
  const target = new URL(authorizationUrl);
  target.search = new URLSearchParams({
    client_id: env.GOOGLE_SIGN_IN_CLIENT_ID!, redirect_uri: redirectUri(env), response_type: "code", scope: "openid email",
    state: id, nonce, code_challenge: base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(verifier)))),
    code_challenge_method: "S256", prompt: "select_account",
  }).toString();
  return { authorizationUrl: target.href, cookie: secureCookie(env, browser, maxAge) };
}

const jwtHeader = z.object({ alg: z.literal("RS256"), kid: z.string().min(1).max(256) });
const jwtClaims = z.object({
  iss: z.enum(["https://accounts.google.com", "accounts.google.com"]),
  aud: z.string(),
  azp: z.string().optional(),
  sub: z.string().min(1).max(255),
  nonce: z.string(),
  exp: z.number().int(),
  iat: z.number().int(),
  nbf: z.number().int().optional(),
  email: z.string().email().max(320),
  email_verified: z.literal(true),
  hd: z.string().min(1).max(253).optional(),
});
function decodePart(input: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(input)) throw new Error("Invalid Google identity token.");
  const padded = input.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - input.length % 4) % 4);
  return Uint8Array.from(atob(padded), char => char.charCodeAt(0));
}
async function exchangeGoogleCode(env: Env, attempt: Attempt, code: string) {
  const token = await fetch(tokenUrl, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
    body: new URLSearchParams({
      grant_type: "authorization_code", code, client_id: env.GOOGLE_SIGN_IN_CLIENT_ID!, client_secret: env.GOOGLE_SIGN_IN_CLIENT_SECRET!,
      redirect_uri: redirectUri(env), code_verifier: attempt.verifier!,
    }),
  });
  if (!token.ok) throw new Error("Google sign-in was not verified.");
  const { id_token } = z.object({ id_token: z.string().min(1).max(16384) }).parse(await token.json());
  const parts = id_token.split(".");
  if (parts.length !== 3) throw new Error("Invalid Google identity token.");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const header = jwtHeader.parse(JSON.parse(decoder.decode(decodePart(parts[0]))));
  const claims = jwtClaims.parse(JSON.parse(decoder.decode(decodePart(parts[1]))));
  const now = Math.floor(Date.now() / 1000);
  if (claims.aud !== env.GOOGLE_SIGN_IN_CLIENT_ID || (claims.azp && claims.azp !== claims.aud) || claims.nonce !== attempt.nonce ||
      claims.exp <= now || claims.exp <= claims.iat || claims.iat > now + 30 || claims.iat < now - maxAge || (claims.nbf ?? 0) > now + 30) throw new Error("Invalid Google sign-in claims.");
  const resolveKey = createJwksResolver({ jwksUri });
  const jwk = await resolveKey(header.kid, false);
  if (jwk?.kty !== "RSA" || (jwk.alg && jwk.alg !== "RS256")) throw new Error("Google signing key unavailable.");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  if (!await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, decodePart(parts[2]), encoder.encode(parts[0] + "." + parts[1]))) {
    throw new Error("Google identity signature invalid.");
  }
  const email = normalizeEmail(claims.email);
  return { subject: claims.sub, email, authoritativeEmail: email.endsWith("@gmail.com") || !!claims.hd };
}

async function workspace(db: DatabaseClient, userId: string): Promise<GoogleIdentity | null> {
  const row = (await db.query<{ tenant_id: string; session_version: number; email: string }>(`SELECT m.tenant_id,m.session_version,u.email
    FROM app.members m JOIN app.auth_users u ON u.id=m.user_id
    WHERE m.user_id=$1 AND m.role='owner' AND u.email_verified ORDER BY m.created_at,m.tenant_id LIMIT 1`, [userId])).rows[0];
  return row ? { userId, tenantId: row.tenant_id, sessionVersion: row.session_version, email: row.email } : null;
}

export async function redeemGoogleCallback(request: Request, env: Env) {
  const parsed = new URL(request.url);
  const state = z.uuid().safeParse(parsed.searchParams.get("state"));
  const code = parsed.searchParams.get("code");
  const digest = await digestFor(request, env);
  if (!googleEnabled(env) || !state.success || !code || code.length > 4096 || !digest || parsed.searchParams.has("error")) return expired();
  const db = databaseFor(env);
  const attempt = await db.transaction(async sql => {
    const row = (await sql.query<Attempt>(`SELECT * FROM app.google_sign_in_attempts
      WHERE id=$1 AND browser_digest=$2 AND verifier IS NOT NULL AND expires_at>clock_timestamp() FOR UPDATE`, [state.data, digest])).rows[0];
    if (row) await sql.query("UPDATE app.google_sign_in_attempts SET verifier=NULL WHERE id=$1", [row.id]);
    return row;
  });
  if (!attempt) return expired();
  const google = await exchangeGoogleCode(env, attempt, code);
  const linked = (await db.pool.query<{ user_id: string }>(`SELECT user_id FROM app.auth_accounts
    WHERE provider='google' AND provider_account_id=$1`, [google.subject])).rows[0];
  if (linked) {
    const identity = await workspace(db.pool, linked.user_id);
    await db.pool.query("DELETE FROM app.google_sign_in_attempts WHERE id=$1", [attempt.id]);
    return identity ? { identity, returnTo: attempt.return_to, connection: attempt.connection_id ?? undefined } : fail(403, "This account cannot access the workspace.");
  }
  const existing = (await db.pool.query<{ id: string }>("SELECT id FROM app.auth_users WHERE lower(email)=$1", [google.email])).rows[0];
  const updated = await db.pool.query(`UPDATE app.google_sign_in_attempts SET google_subject=$2,email=$3,existing_user_id=$4,email_confirmed=$5
    WHERE id=$1 AND expires_at>clock_timestamp() RETURNING id`, [attempt.id, google.subject, google.email, existing?.id ?? null, google.authoritativeEmail]);
  return updated.rowCount ? { pending: true as const } : expired();
}

async function pendingAttempt(db: DatabaseClient, digest: string, lock = false) {
  return (await db.query<Attempt>(`SELECT * FROM app.google_sign_in_attempts
    WHERE browser_digest=$1 AND google_subject IS NOT NULL AND expires_at>clock_timestamp()${lock ? " FOR UPDATE" : ""}`, [digest])).rows[0];
}
export async function googlePending(request: Request, env: Env) {
  const digest = await digestFor(request, env);
  const attempt = digest && await pendingAttempt(databaseFor(env).pool, digest);
  return attempt && attempt.email ? { email: attempt.email, mode: attempt.existing_user_id ? "link" as const : attempt.email_confirmed ? "signup" as const : "verify-email" as const } : null;
}
export async function requestGoogleEmail(request: Request, env: Env) {
  const browser = await digestFor(request, env);
  if (!browser) return false;
  const db = databaseFor(env);
  const token = random(), digest = await tokenDigest(token, env.SESSION_SIGNING_SECRET);
  const attempt = (await db.pool.query<{ email: string }>(`UPDATE app.google_sign_in_attempts
    SET email_token_digest=$2,email_sent_at=clock_timestamp()
    WHERE browser_digest=$1 AND google_subject IS NOT NULL AND existing_user_id IS NULL AND NOT email_confirmed
      AND expires_at>clock_timestamp() AND (email_sent_at IS NULL OR email_sent_at<clock_timestamp()-interval '1 minute')
    RETURNING email`, [browser, digest])).rows[0];
  if (!attempt) return (await googlePending(request, env))?.mode === "verify-email";
  try {
    await sendAuthEmail(env, attempt.email, token, "google-verify");
    return true;
  } catch (error) {
    await db.pool.query("UPDATE app.google_sign_in_attempts SET email_token_digest=NULL,email_sent_at=NULL WHERE browser_digest=$1 AND email_token_digest=$2", [browser, digest]);
    throw error;
  }
}
export async function verifyGoogleEmail(request: Request, env: Env, token: string) {
  const browser = await digestFor(request, env);
  if (!browser) return false;
  const digest = await tokenDigest(token, env.SESSION_SIGNING_SECRET);
  const verified = await databaseFor(env).pool.query(`UPDATE app.google_sign_in_attempts SET email_confirmed=true,email_token_digest=NULL
    WHERE browser_digest=$1 AND email_token_digest=$2 AND google_subject IS NOT NULL AND existing_user_id IS NULL
      AND NOT email_confirmed AND expires_at>clock_timestamp()`, [browser, digest]);
  return verified.rowCount === 1;
}
export async function googleUsernameAvailable(request: Request, env: Env, username: string) {
  const pending = await googlePending(request, env);
  if (!pending || pending.mode !== "signup") return null;
  return !(await databaseFor(env).pool.query("SELECT 1 FROM app.auth_users WHERE username=$1", [username])).rows.length;
}
export async function finishGoogleSignIn(request: Request, env: Env, input: { username: string } | { password: string }) {
  const digest = await digestFor(request, env);
  if (!digest) return expired();
  const db = databaseFor(env);
  try {
    return await db.transaction(async sql => {
      const attempt = await pendingAttempt(sql, digest, true);
      if (!attempt?.google_subject || !attempt.email) return expired();
      const link = async (userId: string) => sql.query(`INSERT INTO app.auth_accounts(id,user_id,provider,provider_account_id)
        VALUES($1,$2,'google',$3)`, [crypto.randomUUID(), userId, attempt.google_subject]);
      let userId: string;
      if (attempt.existing_user_id) {
        if (!("password" in input)) return fail(400, "Confirm your existing Factorize password.");
        if (attempt.password_attempts >= 5) return fail(429, "Too many attempts. Start Google sign-in again or reset your password.");
        await sql.query("UPDATE app.google_sign_in_attempts SET password_attempts=password_attempts+1 WHERE id=$1", [attempt.id]);
        const user = (await sql.query<{ id: string; email_verified: boolean }>("SELECT id,email_verified FROM app.auth_users WHERE id=$1 AND lower(email)=$2 FOR UPDATE", [attempt.existing_user_id, attempt.email])).rows[0];
        const account = user?.email_verified ? (await sql.query<{ password_hash: string | null }>("SELECT password_hash FROM app.auth_accounts WHERE user_id=$1 AND provider='credential'", [user.id])).rows[0] : null;
        if (!user || !account?.password_hash || !await verifyPassword(input.password, account.password_hash)) {
          return fail(401, "Could not confirm your Factorize password. Try again or reset your password.");
        }
        userId = user.id;
        if (!await workspace(sql, userId)) return fail(403, "This account cannot access the workspace.");
      } else {
        if (!("username" in input) || !attempt.email_confirmed) return fail(400, "Choose a username to finish signing up.");
        userId = crypto.randomUUID();
        await sql.query("INSERT INTO app.auth_users(id,email,email_verified,username) VALUES($1,$2,true,$3)", [userId, attempt.email, input.username]);
        await new AuthRepository(db, env).ensurePersonalTeam(sql, userId, attempt.email);
      }
      await link(userId);
      const identity = await workspace(sql, userId);
      if (!identity) throw new Error("Google sign-in workspace unavailable.");
      await sql.query("DELETE FROM app.google_sign_in_attempts WHERE id=$1", [attempt.id]);
      return { identity, returnTo: attempt.return_to, connection: attempt.connection_id ?? undefined };
    });
  } catch (error) {
    const pg = error as { code?: string; constraint?: string };
    if (pg.constraint === "auth_users_username_unique") return fail(409, "That username is already taken.");
    if (pg.code === "23505") return fail(409, "Account details changed. Start Google sign-in again.");
    throw error;
  }
}
