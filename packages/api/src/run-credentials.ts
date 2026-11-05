import type { Env, OAuthProps } from "./types";
import { databaseFor } from "./postgres/database";
import { accessTokenDigest } from "./access-tokens";

// Reads remain available through the same proxy; mutations are limited to
// explicitly permitted invocations. These scopes never include owner writes.
export const RUN_SCOPES = ["projects:read", "jobs:read", "runs:read", "integrations:read", "skills:read", "runs:invoke"];
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function runProxyName(runId: string): string {
  if (!RUN_ID.test(runId)) throw new Error("A UUID run identity is required for a run proxy");
  return `fz-run-${runId.toLowerCase()}`;
}

export function runProxyInstructions(runId: string): string {
  return `\n\n## Factorize access\nDiscover the ${runProxyName(runId)} integration in https://reflection.int.exe.xyz/integrations and use the proxy URL in its help text for all Factorize /api/v1 requests, replacing any shared Factorize hostname mentioned in the task or job template. exe.dev injects this run's credential outside the VM; do not supply Authorization headers or look for tokens in the environment. This proxy supports reads and manually invoking this job's explicitly authorized destinations. Other writes are not granted. If an optional bookkeeping operation is unavailable, continue implementation and report that limitation. Use FACTORIZE_RESULT_PATH to report the final outcome.\n`;
}

const encode = (value: string) => btoa(String.fromCharCode(...new TextEncoder().encode(value))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
const encodeBytes = (value: Uint8Array) => btoa(String.fromCharCode(...value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
const decode = (value: string) => new TextDecoder().decode(Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((value.length + 3) % 4)), c => c.charCodeAt(0)));

/** Rotate on each launch attempt; only a digest is persisted. */
export async function issueRunCredential(env: Env, tenantId: string, runId: string): Promise<string> {
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const token = `fzt_run_${encode(runId)}_${encodeBytes(secret)}`;
  const db = databaseFor(env);
  const owner = (await db.pool.query<{ user_id: string; session_version: number }>("SELECT user_id,session_version FROM app.members WHERE tenant_id=$1 AND role='owner' ORDER BY user_id LIMIT 1", [tenantId])).rows[0];
  if (!owner) throw new Error("Run owner is unavailable");
  await db.pool.query(`INSERT INTO app.run_credentials(tenant_id,run_id,digest,user_id,session_version,expires_at,proxy_name)
    VALUES ($1,$2,$3,$4,$5,now()+interval '24 hours',$6) ON CONFLICT (tenant_id,run_id) DO UPDATE SET digest=excluded.digest,user_id=excluded.user_id,session_version=excluded.session_version,expires_at=excluded.expires_at,proxy_name=excluded.proxy_name`, [tenantId, runId, await accessTokenDigest(token), owner.user_id, owner.session_version, runProxyName(runId)]);
  return token;
}

export async function authenticateRunCredential(request: Request, env: Env): Promise<OAuthProps | null> {
  const value = request.headers.get("Authorization")?.match(/^Bearer (fzt_run_[A-Za-z0-9_-]+_[A-Za-z0-9_-]{43})$/)?.[1];
  if (!value) return null;
  const match = value.match(/^fzt_run_([A-Za-z0-9_-]+)_([A-Za-z0-9_-]{43})$/);
  if (!match) return null;
  let runId: string;
  try { runId = decode(match[1]!); } catch { return null; }
  if (!RUN_ID.test(runId)) return null;
  const digest = await accessTokenDigest(value);
  const result = await databaseFor(env).pool.query<{ tenant_id: string; user_id: string; session_version: number; job_id: string }>(`SELECT c.tenant_id,c.user_id,c.session_version,r.job_id
    FROM app.run_credentials c JOIN app.job_runs r ON r.tenant_id=c.tenant_id AND r.id=c.run_id
    JOIN app.members m ON m.tenant_id=c.tenant_id AND m.user_id=c.user_id AND m.role='owner' AND m.session_version=c.session_version
    WHERE c.run_id=$1 AND c.digest=$2 AND c.proxy_name=$3 AND c.expires_at>now() AND r.state IN ('reserved','starting','running','blocked','stopping')`, [runId, digest, runProxyName(runId)]);
  const row = result.rows[0];
  return row ? { tenantId: row.tenant_id, userId: row.user_id, sessionVersion: row.session_version, scopes: [...RUN_SCOPES], authMethod: "run_token", runId, runJobId: row.job_id, runCredentialDigest: digest } : null;
}
