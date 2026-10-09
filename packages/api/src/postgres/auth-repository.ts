import { hashPassword, normalizeEmail, tokenDigest, validEmail, validPassword, verifyPassword } from "../auth";
import { sendAuthEmail, validateAuthEmailConfig } from "../auth-email";
import type { Env } from "../types";
import type { Database, DatabaseClient } from "./database";

const ok = () => ({ status: 200, body: { ok: true } });
const invalidLink = () => ({ status: 400, body: { error: "The link is invalid or expired." } });

export class AuthRepository {
  constructor(private database: Database, private env: Env) {}

  async signup(input: Record<string, unknown>) {
    const email = normalizeEmail(String(input.email ?? "")), password = String(input.password ?? "");
    if (!validEmail(email) || !validPassword(password)) return { status: 400, body: { error: "Use a valid email and a password of 12–200 characters." } };
    validateAuthEmailConfig(this.env);
    const userId = crypto.randomUUID(), passwordHash = await hashPassword(password);
    try {
      await this.database.transaction(async client => {
        await client.query("INSERT INTO app.auth_users(id,email,email_verified) VALUES ($1,$2,false)", [userId, email]);
        await client.query("INSERT INTO app.auth_accounts(id,user_id,provider,provider_account_id,password_hash) VALUES ($1,$2::uuid,'credential',$2::uuid::text,$3)", [crypto.randomUUID(), userId, passwordHash]);
      });
    } catch (error: any) {
      if (error?.code === "23505") return { status: 409, body: { error: "That email is already registered. Sign in, resend verification, or reset your password." } };
      throw error;
    }
    await this.issueEmail(userId, email, "verify");
    return { status: 201, body: { ok: true } };
  }

  async login(input: Record<string, unknown>) {
    const email = normalizeEmail(String(input.email ?? "")), password = String(input.password ?? "");
    return this.database.transaction(async client => {
      const row = (await client.query<{ id: string; email: string; email_verified: boolean }>("SELECT id,email,email_verified FROM app.auth_users WHERE lower(email)=$1 FOR UPDATE", [email])).rows[0];
      const account = row ? (await client.query<{ password_hash: string }>("SELECT password_hash FROM app.auth_accounts WHERE user_id=$1 AND provider='credential'", [row.id])).rows[0] : null;
      if (!validPassword(password) || !row || !account?.password_hash || !(await verifyPassword(password, account.password_hash))) return { status: 401, body: { error: "Invalid email or password." } };
      if (!row.email_verified) return { status: 403, body: { error: "Verify your email before signing in. You can resend the verification email below." } };
      // Existing accounts keep their existing workspace; never derive tenancy from OAuth.
      const member = (await client.query<{ tenant_id: string; session_version: number }>("SELECT tenant_id,session_version FROM app.members WHERE user_id=$1 AND role='owner' ORDER BY created_at,tenant_id LIMIT 1", [row.id])).rows[0];
      if (!member) return { status: 403, body: { error: "This account needs a workspace owner invitation." } };
      return { status: 200, body: { userId: row.id, email: row.email, tenantId: member.tenant_id, sessionVersion: member.session_version } };
    });
  }

  private async issueEmail(userId: string, email: string, purpose: "verify" | "reset") {
    const token = crypto.randomUUID() + crypto.randomUUID(), digest = await tokenDigest(token, this.env.SESSION_SIGNING_SECRET);
    await this.database.pool.query("INSERT INTO app.auth_reset_tokens(digest,user_id,expires_at,purpose) VALUES ($1,$2,now()+interval '1 hour',$3)", [digest, userId, purpose]);
    try { await sendAuthEmail(this.env, email, token, purpose); }
    catch (error) { await this.database.pool.query("DELETE FROM app.auth_reset_tokens WHERE digest=$1", [digest]); throw error; }
  }

  async requestEmail(input: Record<string, unknown>, purpose: "verify" | "reset") {
    validateAuthEmailConfig(this.env);
    const email = normalizeEmail(String(input.email ?? ""));
    const user = (await this.database.pool.query<{ id: string; email_verified: boolean }>("SELECT id,email_verified FROM app.auth_users WHERE lower(email)=$1", [email])).rows[0];
    if (user && (purpose === "reset" || !user.email_verified)) await this.issueEmail(user.id, email, purpose);
    return ok();
  }
  async requestReset(input: Record<string, unknown>) { return this.requestEmail(input, "reset"); }

  private async ensureWorkspace(client: DatabaseClient, userId: string, email: string) {
    // A legacy member must never become an owner simply by resetting a password.
    const existing = await client.query("SELECT tenant_id FROM app.members WHERE user_id=$1", [userId]);
    if (existing.rows.length) return;
    await client.query("INSERT INTO app.tenants(id) VALUES ($1) ON CONFLICT DO NOTHING", [userId]);
    await client.query("INSERT INTO app.members(tenant_id,user_id,email,role) VALUES ($1,$1,$2,'owner')", [userId, email]);
  }

  async completeVerification(token: string) { return this.consumeToken(token, "verify"); }
  async completeReset(input: Record<string, unknown>) {
    const password = String(input.password ?? "");
    if (!validPassword(password)) return { status: 400, body: { error: "Use a password of 12–200 characters." } };
    return this.consumeToken(String(input.token ?? ""), "reset", await hashPassword(password));
  }
  private async consumeToken(token: string, purpose: "verify" | "reset", passwordHash?: string) {
    if (!token) return invalidLink();
    const digest = await tokenDigest(token, this.env.SESSION_SIGNING_SECRET);
    try {
      const completed = await this.database.transaction(async client => {
        // Always lock the user before tokens/accounts, including across different
        // reset links. Recheck the token after the lock to prevent concurrent reuse.
        const row = (await client.query<{ user_id: string; email: string }>(`SELECT u.id user_id,u.email FROM app.auth_users u WHERE u.id=(
          SELECT user_id FROM app.auth_reset_tokens WHERE digest=$1 AND purpose=$2 AND used_at IS NULL AND expires_at>now()) FOR UPDATE`, [digest, purpose])).rows[0];
        if (!row) return false;
        const active = await client.query("SELECT digest FROM app.auth_reset_tokens WHERE digest=$1 AND purpose=$2 AND used_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE", [digest, purpose]);
        if (!active.rows.length) return false;
        if (purpose === "reset") {
          // Email possession lets legacy Linear-only users establish native credentials.
          await client.query(`INSERT INTO app.auth_accounts(id,user_id,provider,provider_account_id,password_hash) VALUES ($1,$2::uuid,'credential',$2::uuid::text,$3)
            ON CONFLICT (provider,provider_account_id) DO UPDATE SET password_hash=excluded.password_hash`, [crypto.randomUUID(), row.user_id, passwordHash]);
          await client.query("UPDATE app.members SET session_version=session_version+1 WHERE user_id=$1", [row.user_id]);
          await client.query("UPDATE app.auth_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL", [row.user_id]);
        }
        await client.query("UPDATE app.auth_users SET email_verified=true WHERE id=$1", [row.user_id]);
        await this.ensureWorkspace(client, row.user_id, row.email);
        await client.query("UPDATE app.auth_reset_tokens SET used_at=now() WHERE user_id=$1 AND purpose=$2 AND used_at IS NULL", [row.user_id, purpose]);
        return true;
      });
      return completed ? ok() : invalidLink();
    } catch (error) { throw error; }
  }

  async changePassword(userId: string, input: Record<string, unknown>) {
    const password = String(input.password ?? ""), currentPassword = String(input.currentPassword ?? "");
    if (!validPassword(password) || !validPassword(currentPassword)) return { status: 400, body: { error: "Passwords must have 12–200 characters." } };
    const changed = await this.database.transaction(async client => {
      // Same lock order as reset, preventing a stale current password from winning a race.
      await client.query("SELECT id FROM app.auth_users WHERE id=$1 FOR UPDATE", [userId]);
      const row = (await client.query<{ password_hash: string }>("SELECT password_hash FROM app.auth_accounts WHERE user_id=$1 AND provider='credential'", [userId])).rows[0];
      if (!row || !await verifyPassword(currentPassword, row.password_hash)) return false;
      await client.query("UPDATE app.auth_accounts SET password_hash=$1 WHERE user_id=$2 AND provider='credential'", [await hashPassword(password), userId]);
      await client.query("UPDATE app.members SET session_version=session_version+1 WHERE user_id=$1", [userId]);
      await client.query("UPDATE app.auth_reset_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL", [userId]);
      return true;
    });
    return changed ? ok() : { status: 401, body: { error: "Current password is incorrect." } };
  }
}
