import { DurableObject } from "cloudflare:workers";
import { hashPassword, normalizeEmail, tokenDigest, validEmail, validPassword, verifyPassword } from "./auth";
import type { Env } from "./types";

const json = (value: unknown, status = 200) => Response.json(value, { status });
const now = () => Math.floor(Date.now() / 1000);

export class AuthStore extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS auth_users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, email_verified INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS auth_accounts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, provider TEXT NOT NULL, provider_account_id TEXT NOT NULL, password_hash TEXT, UNIQUE(provider, provider_account_id));
      CREATE TABLE IF NOT EXISTS auth_reset_tokens (digest TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER);
      CREATE TABLE IF NOT EXISTS auth_sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER);
    `);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      const input = await request.json().catch(() => ({})) as Record<string, unknown>;
      if (request.method === "POST" && url.pathname === "/signup") return this.signup(input);
      if (request.method === "POST" && url.pathname === "/login") return this.login(input);
      if (request.method === "POST" && url.pathname === "/reset/request") return this.requestReset(input);
      if (request.method === "POST" && url.pathname === "/reset/complete") return this.completeReset(input);
      return new Response("Not found", { status: 404 });
    } catch (error) { console.error("auth store error", error); return json({ error: "Authentication failed" }, 500); }
  }

  private async signup(input: Record<string, unknown>): Promise<Response> {
    const email = normalizeEmail(String(input.email ?? "")), password = String(input.password ?? "");
    if (!validEmail(email) || !validPassword(password)) return json({ error: "Use a valid email and a password of at least 12 characters." }, 400);
    if (this.ctx.storage.sql.exec("SELECT id FROM auth_users WHERE email=?", email).toArray().length) return json({ error: "An account already exists for that email." }, 409);
    const userId = crypto.randomUUID();
    this.ctx.storage.sql.exec("INSERT INTO auth_users VALUES (?,?,0,?)", userId, email, now());
    this.ctx.storage.sql.exec("INSERT INTO auth_accounts VALUES (?,?,?,?,?)", crypto.randomUUID(), userId, "credential", userId, await hashPassword(password));
    return json({ userId, email, tenantId: userId, emailVerified: false }, 201);
  }

  private async login(input: Record<string, unknown>): Promise<Response> {
    const email = normalizeEmail(String(input.email ?? "")), password = String(input.password ?? "");
    const user = this.ctx.storage.sql.exec("SELECT id,email,email_verified FROM auth_users WHERE email=?", email).toArray()[0] as any;
    const account = user && this.ctx.storage.sql.exec("SELECT password_hash FROM auth_accounts WHERE user_id=? AND provider='credential'", user.id).toArray()[0] as any;
    if (!user || !account?.password_hash || !(await verifyPassword(password, String(account.password_hash)))) return json({ error: "Invalid email or password." }, 401);
    return json({ userId: user.id, email: user.email, tenantId: user.id, emailVerified: Boolean(user.email_verified) });
  }

  private async requestReset(input: Record<string, unknown>): Promise<Response> {
    const email = normalizeEmail(String(input.email ?? ""));
    const user = this.ctx.storage.sql.exec("SELECT id FROM auth_users WHERE email=?", email).toArray()[0] as any;
    // Always return the same response to avoid account enumeration.
    if (!user) return json({ ok: true });
    const token = crypto.randomUUID() + crypto.randomUUID();
    this.ctx.storage.sql.exec("INSERT INTO auth_reset_tokens VALUES (?,?,?,NULL)", await tokenDigest(token, this.env.SESSION_SIGNING_SECRET), user.id, now() + 3600);
    return json({ ok: true, ...(this.env.AUTH_RESET_RETURN_TOKEN === "true" ? { token } : {}) });
  }

  private async completeReset(input: Record<string, unknown>): Promise<Response> {
    const token = String(input.token ?? ""), password = String(input.password ?? "");
    if (!token || !validPassword(password)) return json({ error: "The reset link or password is invalid." }, 400);
    const digest = await tokenDigest(token, this.env.SESSION_SIGNING_SECRET);
    const row = this.ctx.storage.sql.exec("SELECT user_id FROM auth_reset_tokens WHERE digest=? AND used_at IS NULL AND expires_at>?", digest, now()).toArray()[0] as any;
    if (!row) return json({ error: "The reset link is invalid or expired." }, 400);
    this.ctx.storage.sql.exec("UPDATE auth_accounts SET password_hash=? WHERE user_id=? AND provider='credential'", await hashPassword(password), row.user_id);
    this.ctx.storage.sql.exec("UPDATE auth_reset_tokens SET used_at=? WHERE digest=?", now(), digest);
    this.ctx.storage.sql.exec("UPDATE auth_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL", now(), row.user_id);
    return json({ ok: true });
  }
}
