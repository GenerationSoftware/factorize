import { signingConfig } from "./config/runtime";
import { databaseFor } from "./postgres/database";
import { readSession, requestCookie, type Session } from "./session";
import type { Env } from "./types";

async function browserCredential(request: Request, env: Env) {
  const value = requestCookie(request, "factorize_session");
  const session = await readSession(value, signingConfig(env).sessionSecret);
  if (!session || !value || typeof session.tenantId !== "string" || typeof session.userId !== "string"
      || typeof session.email !== "string" || !Number.isSafeInteger(session.exp)
      || !Number.isSafeInteger(session.sessionVersion)) return null;
  // Key the revocation by the signed payload, not the cookie encoding or
  // signature. Old cookies without a nonce keep working until expiry/logout.
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value.split(".", 1)[0]));
  return { session, digest: btoa(String.fromCharCode(...new Uint8Array(digest))) };
}

export async function readBrowserSession(request: Request, env: Env): Promise<Session | null> {
  const credential = await browserCredential(request, env);
  if (!credential) return null;
  const revoked = await databaseFor(env).pool.query(
    "SELECT 1 FROM app.revoked_browser_sessions WHERE digest=$1", [credential.digest],
  );
  return revoked.rows.length ? null : credential.session;
}

export async function revokeBrowserSession(request: Request, env: Env): Promise<void> {
  const credential = await browserCredential(request, env);
  if (!credential) return;
  await databaseFor(env).pool.query(
    "INSERT INTO app.revoked_browser_sessions(digest,expires_at) VALUES ($1,$2) ON CONFLICT (digest) DO NOTHING",
    [credential.digest, new Date(credential.session.exp * 1000)],
  );
}
