import { hashPassword, normalizeEmail, tokenDigest, validEmail, validPassword, verifyPassword } from "../auth";
import type { Env } from "../types";
import type { Database } from "./database";

export class AuthRepository {
  constructor(private database: Database, private env: Env) {}

  async signup(input: Record<string, unknown>) {
    const email = normalizeEmail(String(input.email ?? "")), password = String(input.password ?? "");
    if (!validEmail(email) || !validPassword(password)) return { status: 400, body: { error: "Use a valid email and a password of at least 12 characters." } };
    const userId = crypto.randomUUID();
    try {
      await this.database.transaction(async client => {
        await client.query("INSERT INTO app.auth_users(id,email,email_verified) VALUES ($1,$2,false)", [userId, email]);
        await client.query("INSERT INTO app.auth_accounts(id,user_id,provider,provider_account_id,password_hash) VALUES ($1,$2,'credential',$2,$3)", [crypto.randomUUID(), userId, await hashPassword(password)]);
      });
    } catch (error: any) {
      if (error?.code === "23505") return { status: 409, body: { error: "An account already exists for that email." } };
      throw error;
    }
    return { status: 201, body: { userId, email, tenantId: userId, emailVerified: false } };
  }

  async login(input: Record<string, unknown>) {
    const email = normalizeEmail(String(input.email ?? "")), password = String(input.password ?? "");
    const result = await this.database.pool.query<{ id: string; email: string; email_verified: boolean; password_hash: string | null }>(`SELECT u.id,u.email,u.email_verified,a.password_hash FROM app.auth_users u
      LEFT JOIN app.auth_accounts a ON a.user_id=u.id AND a.provider='credential' WHERE u.email=$1`, [email]);
    const row = result.rows[0];
    if (!row?.password_hash || !(await verifyPassword(password, row.password_hash))) return { status: 401, body: { error: "Invalid email or password." } };
    return { status: 200, body: { userId: row.id, email: row.email, tenantId: row.id, emailVerified: row.email_verified } };
  }

  async requestReset(input: Record<string, unknown>) {
    const email = normalizeEmail(String(input.email ?? ""));
    const user = (await this.database.pool.query<{ id: string }>("SELECT id FROM app.auth_users WHERE email=$1", [email])).rows[0];
    if (!user) return { status: 200, body: { ok: true } };
    const token = crypto.randomUUID() + crypto.randomUUID(), digest = await tokenDigest(token, this.env.SESSION_SIGNING_SECRET);
    await this.database.pool.query("INSERT INTO app.auth_reset_tokens(digest,user_id,expires_at) VALUES ($1,$2,now()+interval '1 hour')", [digest, user.id]);
    return { status: 200, body: { ok: true, ...(this.env.AUTH_RESET_RETURN_TOKEN === "true" ? { token } : {}) } };
  }

  async completeReset(input: Record<string, unknown>) {
    const token = String(input.token ?? ""), password = String(input.password ?? "");
    if (!token || !validPassword(password)) return { status: 400, body: { error: "The reset link or password is invalid." } };
    const digest = await tokenDigest(token, this.env.SESSION_SIGNING_SECRET);
    const completed = await this.database.transaction(async client => {
      const row = (await client.query<{ user_id: string }>("SELECT user_id FROM app.auth_reset_tokens WHERE digest=$1 AND used_at IS NULL AND expires_at>now() FOR UPDATE", [digest])).rows[0];
      if (!row) return false;
      await client.query("UPDATE app.auth_accounts SET password_hash=$1 WHERE user_id=$2 AND provider='credential'", [await hashPassword(password), row.user_id]);
      await client.query("UPDATE app.auth_reset_tokens SET used_at=now() WHERE digest=$1", [digest]);
      await client.query("UPDATE app.auth_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL", [row.user_id]);
      return true;
    });
    return completed ? { status: 200, body: { ok: true } } : { status: 400, body: { error: "The reset link is invalid or expired." } };
  }
}
