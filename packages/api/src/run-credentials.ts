import type { Env, OAuthProps } from "./types";
import { databaseFor } from "./postgres/database";
import { accessTokenDigest } from "./access-tokens";

const encode = (value: string) => btoa(String.fromCharCode(...new TextEncoder().encode(value))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
const encodeBytes = (value: Uint8Array) => btoa(String.fromCharCode(...value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
const decode = (value: string) => new TextDecoder().decode(Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((value.length + 3) % 4)), c => c.charCodeAt(0)));

/** One-use issuance per launch attempt; only a digest is persisted. */
export async function issueRunCredential(env: Env, tenantId: string, runId: string): Promise<string> {
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const token = `fzt_run_${encode(runId)}_${encodeBytes(secret)}`;
  const db = databaseFor(env);
  const owner = (await db.pool.query<{ user_id: string; session_version: number }>("SELECT user_id,session_version FROM app.members WHERE tenant_id=$1 AND role='owner' ORDER BY user_id LIMIT 1", [tenantId])).rows[0];
  if (!owner) throw new Error("Run owner is unavailable");
  await db.pool.query(`INSERT INTO app.run_credentials(tenant_id,run_id,digest,user_id,session_version,expires_at)
    VALUES ($1,$2,$3,$4,$5,now()+interval '24 hours') ON CONFLICT (tenant_id,run_id) DO UPDATE SET digest=excluded.digest,user_id=excluded.user_id,session_version=excluded.session_version,expires_at=excluded.expires_at`, [tenantId, runId, await accessTokenDigest(token), owner.user_id, owner.session_version]);
  return token;
}

export async function authenticateRunCredential(request: Request, env: Env): Promise<OAuthProps | null> {
  const value = request.headers.get("Authorization")?.match(/^Bearer (fzt_run_[A-Za-z0-9_-]+_[A-Za-z0-9_-]{43})$/)?.[1];
  if (!value) return null;
  const match = value.match(/^fzt_run_([A-Za-z0-9_-]+)_([A-Za-z0-9_-]{43})$/);
  if (!match) return null;
  let runId: string;
  try { runId = decode(match[1]!); } catch { return null; }
  if (!/^[0-9a-f-]{36}$/i.test(runId)) return null;
  const digest = await accessTokenDigest(value);
  const result = await databaseFor(env).pool.query<{ tenant_id: string; user_id: string; session_version: number; job_id: string }>(`SELECT c.tenant_id,c.user_id,c.session_version,r.job_id
    FROM app.run_credentials c JOIN app.job_runs r ON r.tenant_id=c.tenant_id AND r.id=c.run_id
    JOIN app.members m ON m.tenant_id=c.tenant_id AND m.user_id=c.user_id AND m.role='owner' AND m.session_version=c.session_version
    WHERE c.run_id=$1 AND c.digest=$2 AND c.expires_at>now() AND r.state IN ('reserved','starting','running','blocked','stopping')`, [runId, digest]);
  const row = result.rows[0];
  return row ? { tenantId: row.tenant_id, userId: row.user_id, sessionVersion: row.session_version, scopes: ["runs:invoke"], authMethod: "run_token", runId, runJobId: row.job_id, runCredentialDigest: digest } : null;
}
