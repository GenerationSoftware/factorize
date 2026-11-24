import { serialize } from "hono/utils/cookie";
import { tokenDigest, verifyPassword } from "./auth";
import { decrypt, encrypt } from "./crypto";
import { requestCookie, type Session } from "./session";
import { databaseFor, type DatabaseClient } from "./postgres/database";
import { googleEnabled, googleTotpProof } from "./google-sign-in";
import type { Env } from "./types";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const encoder = new TextEncoder();
const ttlSeconds = 300;
const token = () => binaryBase32(crypto.getRandomValues(new Uint8Array(32)));
const codePattern = /^\d{6}$/;
const recoveryPattern = /^[A-Z2-7]{26}$/;
const fail = (status: number, message: string) => ({ status, message } as const);
const expired = () => fail(400, "This two-factor request expired. Start again.");
const incorrect = () => fail(401, "The code is incorrect or has already been used.");
const throttled = () => fail(429, "Too many attempts. Wait five minutes and try again.");

function binaryBase32(bytes: Uint8Array) {
  let value = 0, bits = 0, output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) output += alphabet[(value >> (bits -= 5)) & 31];
  }
  if (bits) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

function bytesFromBase32(value: string) {
  let buffer = 0, bits = 0;
  const bytes = new Uint8Array(Math.floor(value.length * 5 / 8));
  let i = 0;
  for (const character of value) {
    const digit = alphabet.indexOf(character);
    if (digit === -1) throw new Error("Invalid TOTP secret");
    buffer = (buffer << 5) | digit;
    bits += 5;
    if (bits >= 8) bytes[i++] = (buffer >> (bits -= 8)) & 255;
  }
  return bytes;
}

export async function totpAt(secret: string, counter: number) {
  const key = await crypto.subtle.importKey("raw", bytesFromBase32(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(counter));
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, bytes));
  const offset = digest[digest.length - 1] & 15;
  const truncated = new DataView(digest.buffer).getUint32(offset) & 0x7fffffff;
  return (truncated % 1_000_000).toString().padStart(6, "0");
}

const counterNow = () => Math.floor(Date.now() / 30_000);
async function matchingCounter(secret: string, code: string, lastCounter: number) {
  if (!codePattern.test(code)) return null;
  const now = counterNow();
  // Prefer the newest match if two adjacent windows happen to share digits.
  const counters = [now + 1, now, now - 1];
  const candidates = await Promise.all(counters.map(counter => totpAt(secret, counter)));
  return counters.find((counter, index) => counter > lastCounter && candidates[index] === code) ?? null;
}

export function totpKey(env: Env) {
  const value = env.TOTP_ENCRYPTION_KEY?.trim();
  try {
    if (!value || atob(value).length !== 32 || (env.CREDENTIAL_ENCRYPTION_KEY && atob(env.CREDENTIAL_ENCRYPTION_KEY) === atob(value))) return null;
    return value;
  } catch { return null; }
}

const isHttps = (env: Env) => new URL(env.APP_ORIGIN).protocol === "https:";
const cookieName = (env: Env, purpose: string) => (isHttps(env) ? "__Host-" : "") + "factorize_totp_" + purpose;
const cookie = (env: Env, purpose: string, value: string, maxAge: number) => serialize(cookieName(env, purpose), value, {
  httpOnly: true, secure: isHttps(env), sameSite: "Lax", path: "/", maxAge,
});
export const clearTotpLoginCookie = (env: Env) => cookie(env, "login", "", 0);
export const clearTotpEnrollCookie = (env: Env) => cookie(env, "enroll", "", 0);
async function browserDigest(request: Request, env: Env, purpose: string) {
  const value = requestCookie(request, cookieName(env, purpose));
  return value && /^[A-Z2-7]{52}$/.test(value) ? tokenDigest("totp:" + purpose + ":" + value, env.SESSION_SIGNING_SECRET) : null;
}
const digestNew = (env: Env, purpose: string, value: string) => tokenDigest("totp:" + purpose + ":" + value, env.SESSION_SIGNING_SECRET);
async function recoveryDigest(userId: string, code: string) {
  // 128 random bits per code make an offline dictionary impractical without
  // tying recovery to the deployment encryption key or its rotation.
  const bytes = await crypto.subtle.digest("SHA-256", encoder.encode("totp-recovery:" + userId + ":" + code));
  return binaryBase32(new Uint8Array(bytes));
}

type Identity = { userId: string; tenantId: string; sessionVersion: number; email: string };
type Totp = { encrypted_secret: string; last_counter: string };
type Challenge = { user_id: string; tenant_id: string; session_version: number; return_to: string };
const lockUser = (sql: DatabaseClient, userId: string) => sql.query("SELECT id FROM app.auth_users WHERE id=$1 FOR UPDATE", [userId]);
async function member(sql: DatabaseClient, identity: Omit<Identity, "email">) {
  return (await sql.query<{ email: string }>(`SELECT u.email FROM app.members m JOIN app.auth_users u ON u.id=m.user_id
    WHERE m.tenant_id=$1 AND m.user_id=$2 AND m.session_version=$3 AND m.role='owner' AND u.email_verified`,
    [identity.tenantId, identity.userId, identity.sessionVersion])).rows[0];
}
async function active(sql: DatabaseClient, id: string) {
  return (await sql.query<Totp>("SELECT encrypted_secret,last_counter FROM app.auth_totp WHERE user_id=$1", [id])).rows[0];
}
async function takeAttempt(sql: DatabaseClient, userId: string, kind: "code" | "settings" | "challenge") {
  const limit = kind === "code" ? 10 : kind === "challenge" ? 15 : 5;
  return !!(await sql.query(`INSERT INTO app.auth_totp_limits AS l(user_id,kind,attempts,expires_at)
      VALUES($1,$2,1,clock_timestamp()+interval '5 minutes')
      ON CONFLICT(user_id,kind) DO UPDATE SET attempts=CASE WHEN l.expires_at<=clock_timestamp() THEN 1 ELSE l.attempts+1 END,
        expires_at=CASE WHEN l.expires_at<=clock_timestamp() THEN excluded.expires_at ELSE l.expires_at END
      WHERE l.expires_at<=clock_timestamp() OR l.attempts<$3 RETURNING attempts`, [userId, kind, limit])).rowCount;
}

async function useCode(sql: DatabaseClient, env: Env, userId: string, config: Totp, supplied: string) {
  const code = supplied.replace(/[ -]/g, "").toUpperCase();
  if (recoveryPattern.test(code)) {
    const result = await sql.query("DELETE FROM app.auth_totp_recovery_codes WHERE user_id=$1 AND digest=$2 RETURNING digest", [userId, await recoveryDigest(userId, code)]);
    return result.rowCount === 1;
  }
  const key = totpKey(env);
  if (!key || !codePattern.test(code)) return false;
  const match = await matchingCounter(await decrypt(config.encrypted_secret, key), code, Number(config.last_counter));
  if (match === null) return false;
  return (await sql.query("UPDATE app.auth_totp SET last_counter=$2 WHERE user_id=$1 AND last_counter<$2 RETURNING user_id", [userId, match])).rowCount === 1;
}

export async function beginTotpLogin(env: Env, identity: Identity, returnTo: string) {
  const db = databaseFor(env);
  if (!await active(db.pool, identity.userId)) return null;
  if (!await takeAttempt(db.pool, identity.userId, "challenge")) return false;
  const value = token();
  await db.pool.query(`INSERT INTO app.auth_totp_challenges(digest,tenant_id,user_id,session_version,return_to,expires_at)
    VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '5 minutes')`, [
    await digestNew(env, "login", value), identity.tenantId, identity.userId, identity.sessionVersion, returnTo,
  ]);
  return cookie(env, "login", value, ttlSeconds);
}
export async function finishTotpLogin(request: Request, env: Env, code: string) {
  const digest = await browserDigest(request, env, "login");
  if (!digest) return expired();
  return databaseFor(env).transaction(async sql => {
    const attempt = (await sql.query<Challenge>(`SELECT tenant_id,user_id,session_version,return_to FROM app.auth_totp_challenges
      WHERE digest=$1 AND expires_at>clock_timestamp() FOR UPDATE`, [digest])).rows[0];
    if (!attempt) return expired();
    const partial = { userId: attempt.user_id, tenantId: attempt.tenant_id, sessionVersion: attempt.session_version };
    await lockUser(sql, partial.userId);
    const owner = await member(sql, partial);
    const config = await active(sql, partial.userId);
    if (!owner || !config) return expired();
    if (!await takeAttempt(sql, partial.userId, "code")) return throttled();
    if (!await useCode(sql, env, partial.userId, config, code)) return incorrect();
    await sql.query("DELETE FROM app.auth_totp_challenges WHERE digest=$1", [digest]);
    return { identity: { ...partial, email: owner.email }, returnTo: attempt.return_to };
  });
}

export async function totpStatus(request: Request, env: Env, session: Session) {
  const db = databaseFor(env);
  const row = (await db.pool.query<{ has_password: boolean; has_google: boolean }>(`SELECT
    EXISTS(SELECT 1 FROM app.auth_accounts WHERE user_id=$1 AND provider='credential' AND password_hash IS NOT NULL) has_password,
    EXISTS(SELECT 1 FROM app.auth_accounts WHERE user_id=$1 AND provider='google') has_google`, [session.userId])).rows[0]!;
  const config = await active(db.pool, session.userId);
  const method = row.has_password ? "password" : row.has_google && googleEnabled(env) ? "google" : "unavailable";
  return { enabled: !!config, available: !!totpKey(env), method, googleVerified: method === "google" && await googleTotpProof(db.pool, request, env, session) };
}

async function confirmPrimary(sql: DatabaseClient, request: Request, env: Env, session: Session, password?: string) {
  const row = (await sql.query<{ password_hash: string }>("SELECT password_hash FROM app.auth_accounts WHERE user_id=$1 AND provider='credential' AND password_hash IS NOT NULL", [session.userId])).rows[0];
  if (row) return !!password && await verifyPassword(password, row.password_hash);
  return !password && googleEnabled(env) && await googleTotpProof(sql, request, env, session);
}

async function advanceSessions(sql: DatabaseClient, session: Session) {
  const updated = (await sql.query<{ tenant_id: string; session_version: number }>("UPDATE app.members SET session_version=session_version+1 WHERE user_id=$1 RETURNING tenant_id,session_version", [session.userId])).rows;
  await sql.query("UPDATE app.auth_sessions SET revoked_at=clock_timestamp() WHERE user_id=$1 AND revoked_at IS NULL", [session.userId]);
  const next = updated.find(row => row.tenant_id === session.tenantId)!;
  return { userId: session.userId, tenantId: session.tenantId, email: session.email, sessionVersion: next.session_version };
}

export async function beginTotpEnrollment(request: Request, env: Env, session: Session, password?: string) {
  const key = totpKey(env);
  if (!key) return fail(503, "Two-factor enrollment is not configured.");
  return databaseFor(env).transaction(async sql => {
    await lockUser(sql, session.userId);
    if (!await member(sql, session)) return expired();
    if (await active(sql, session.userId)) return fail(409, "Two-factor authentication is already enabled.");
    if (!await takeAttempt(sql, session.userId, "settings")) return throttled();
    if (!await confirmPrimary(sql, request, env, session, password)) return fail(401, "Confirm your current password or your linked Google account.");
    if (!password && !await googleTotpProof(sql, request, env, session, true)) return expired();
    const secret = binaryBase32(crypto.getRandomValues(new Uint8Array(20)));
    const value = token();
    await sql.query(`INSERT INTO app.auth_totp_enrollments(user_id,browser_digest,session_version,encrypted_secret,expires_at)
      VALUES($1,$2,$3,$4,clock_timestamp()+interval '5 minutes')
      ON CONFLICT(user_id) DO UPDATE SET browser_digest=excluded.browser_digest,session_version=excluded.session_version,
        encrypted_secret=excluded.encrypted_secret,expires_at=excluded.expires_at`, [
      session.userId, await digestNew(env, "enroll", value), session.sessionVersion, await encrypt(secret, key),
    ]);
    const uri = new URL("otpauth://totp/Factorize:" + encodeURIComponent(session.email));
    uri.search = new URLSearchParams({ secret, issuer: "Factorize", algorithm: "SHA1", digits: "6", period: "30" }).toString();
    return { secret, uri: uri.href, cookie: cookie(env, "enroll", value, ttlSeconds) };
  });
}

export async function enableTotp(request: Request, env: Env, session: Session, code: string) {
  const key = totpKey(env);
  const digest = await browserDigest(request, env, "enroll");
  if (!key || !digest) return expired();
  return databaseFor(env).transaction(async sql => {
    await lockUser(sql, session.userId);
    if (!await member(sql, session)) return expired();
    const pending = (await sql.query<{ encrypted_secret: string }>(`SELECT encrypted_secret FROM app.auth_totp_enrollments
      WHERE user_id=$1 AND browser_digest=$2 AND session_version=$3 AND expires_at>clock_timestamp() FOR UPDATE`,
      [session.userId, digest, session.sessionVersion])).rows[0];
    if (!pending || await active(sql, session.userId)) return expired();
    if (!await takeAttempt(sql, session.userId, "code")) return throttled();
    const counter = await matchingCounter(await decrypt(pending.encrypted_secret, key), code, -1);
    if (counter === null) return incorrect();
    await sql.query("INSERT INTO app.auth_totp(user_id,encrypted_secret,last_counter) VALUES($1,$2,$3)", [session.userId, pending.encrypted_secret, counter]);
    const codes = Array.from({ length: 10 }, () => binaryBase32(crypto.getRandomValues(new Uint8Array(16))));
    const digests = await Promise.all(codes.map(code => recoveryDigest(session.userId, code)));
    await sql.query("INSERT INTO app.auth_totp_recovery_codes(user_id,digest) SELECT $1,unnest($2::text[])", [session.userId, digests]);
    await sql.query("DELETE FROM app.auth_totp_enrollments WHERE user_id=$1", [session.userId]);
    const identity = await advanceSessions(sql, session);
    return { identity, recoveryCodes: codes.map(code => code.match(/.{1,5}/g)!.join("-")) };
  });
}

export async function disableTotp(request: Request, env: Env, session: Session, input: { password?: string; code: string }) {
  return databaseFor(env).transaction(async sql => {
    await lockUser(sql, session.userId);
    if (!await member(sql, session)) return expired();
    const config = await active(sql, session.userId);
    if (!config) return fail(409, "Two-factor authentication is not enabled.");
    if (!await takeAttempt(sql, session.userId, "settings")) return throttled();
    if (!await confirmPrimary(sql, request, env, session, input.password)) return fail(401, "Confirm your current password or your linked Google account.");
    if (!await takeAttempt(sql, session.userId, "code")) return throttled();
    if (!await useCode(sql, env, session.userId, config, input.code)) return incorrect();
    if (!input.password && !await googleTotpProof(sql, request, env, session, true)) throw new Error("Google verification expired during two-factor change.");
    await sql.query("DELETE FROM app.auth_totp WHERE user_id=$1", [session.userId]);
    return { identity: await advanceSessions(sql, session) };
  });
}

export async function pruneTotp(sql: DatabaseClient) {
  await sql.query(`DELETE FROM app.auth_totp_challenges WHERE digest IN
    (SELECT digest FROM app.auth_totp_challenges WHERE expires_at<now() ORDER BY expires_at LIMIT 500)`);
  await sql.query(`DELETE FROM app.auth_totp_enrollments WHERE user_id IN
    (SELECT user_id FROM app.auth_totp_enrollments WHERE expires_at<now() ORDER BY expires_at LIMIT 500)`);
  await sql.query(`DELETE FROM app.auth_totp_limits WHERE (user_id,kind) IN
    (SELECT user_id,kind FROM app.auth_totp_limits WHERE expires_at<now() ORDER BY expires_at LIMIT 500)
    AND expires_at<now()`);
}
