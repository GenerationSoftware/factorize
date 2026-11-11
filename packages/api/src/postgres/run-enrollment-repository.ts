import type { Database } from "./database";

export type RunEnrollmentBinding = {
  tenantId: string;
  runId: string;
  vmIdentity: string;
  proxyIdentity: string;
  bootEpoch: string;
};

export type ConsumedRunEnrollment = RunEnrollmentBinding & { grantRevision: number; enrollmentId: string };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validateBinding(binding: RunEnrollmentBinding): void {
  if (!uuid.test(binding.tenantId) || !uuid.test(binding.runId) || !uuid.test(binding.bootEpoch)) throw new TypeError("Enrollment tenant, run, and boot epoch must be UUIDs");
  for (const [name, value] of [["vmIdentity", binding.vmIdentity], ["proxyIdentity", binding.proxyIdentity]] as const) {
    if (typeof value !== "string" || !value.trim() || value.length > 255) throw new TypeError(`${name} must contain 1 to 255 characters`);
  }
}

const digest = async (token: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
const activeStates = "('starting','running','blocked')";

/** Durable, one-use enrollments. Only a SHA-256 digest of each random token is stored. */
export class RunEnrollmentRepository {
  constructor(private database: Database) {}

  async setProxyState(input: { tenantId: string; proxyIdentity: string; bootEpoch: string; disabled?: boolean; revoked?: boolean }): Promise<void> {
    if (!uuid.test(input.tenantId) || !uuid.test(input.bootEpoch)) throw new TypeError("tenantId and bootEpoch must be UUIDs");
    if (!input.proxyIdentity.trim() || input.proxyIdentity.length > 255) throw new TypeError("proxyIdentity must contain 1 to 255 characters");
    await this.database.pool.query(`INSERT INTO app.credential_proxy_states(tenant_id,proxy_identity,boot_epoch,disabled_at,revoked_at)
      VALUES ($1,$2,$3,CASE WHEN $4 THEN now() END,CASE WHEN $5 THEN now() END)
      ON CONFLICT (tenant_id) DO UPDATE SET proxy_identity=excluded.proxy_identity,boot_epoch=excluded.boot_epoch,disabled_at=excluded.disabled_at,revoked_at=excluded.revoked_at,updated_at=now()`,
    [input.tenantId, input.proxyIdentity, input.bootEpoch, input.disabled ?? false, input.revoked ?? false]);
  }

  async authorizeRun(binding: RunEnrollmentBinding, grantRevision: number): Promise<boolean> {
    validateBinding(binding);
    if (!Number.isSafeInteger(grantRevision) || grantRevision < 1) throw new TypeError("grantRevision must be a positive safe integer");
    return this.database.transaction(async client => {
      const valid = await client.query(`SELECT 1 FROM app.job_runs r JOIN app.credential_proxy_states p ON p.tenant_id=r.tenant_id
        WHERE r.tenant_id=$1 AND r.id=$2 AND r.state IN ${activeStates} AND p.proxy_identity=$3 AND p.boot_epoch=$4 AND p.disabled_at IS NULL AND p.revoked_at IS NULL`,
      [binding.tenantId, binding.runId, binding.proxyIdentity, binding.bootEpoch]);
      if (!valid.rowCount) return false;
      const saved = await client.query(`INSERT INTO app.credential_run_grants(tenant_id,run_id,vm_identity,proxy_identity,boot_epoch,grant_revision,revoked_at)
        VALUES ($1,$2,$3,$4,$5,$6,NULL) ON CONFLICT (tenant_id,run_id) DO UPDATE SET vm_identity=excluded.vm_identity,proxy_identity=excluded.proxy_identity,boot_epoch=excluded.boot_epoch,grant_revision=excluded.grant_revision,revoked_at=NULL
        WHERE app.credential_run_grants.grant_revision < excluded.grant_revision RETURNING grant_revision`,
      [binding.tenantId, binding.runId, binding.vmIdentity, binding.proxyIdentity, binding.bootEpoch, grantRevision]);
      if (saved.rowCount) return true;
      const current = await client.query(`SELECT 1 FROM app.credential_run_grants WHERE tenant_id=$1 AND run_id=$2 AND vm_identity=$3 AND proxy_identity=$4 AND boot_epoch=$5 AND grant_revision=$6 AND revoked_at IS NULL`,
        [binding.tenantId, binding.runId, binding.vmIdentity, binding.proxyIdentity, binding.bootEpoch, grantRevision]);
      return Boolean(current.rowCount);
    });
  }

  async revokeRun(tenantId: string, runId: string): Promise<boolean> {
    const result = await this.database.pool.query("UPDATE app.credential_run_grants SET revoked_at=now() WHERE tenant_id=$1 AND run_id=$2 AND revoked_at IS NULL", [tenantId, runId]);
    return Boolean(result.rowCount);
  }

  async issue(binding: RunEnrollmentBinding, expiresAt: Date, now = new Date()): Promise<{ enrollmentId: string; token: string; grantRevision: number } | null> {
    validateBinding(binding);
    if (!(expiresAt instanceof Date) || !Number.isFinite(expiresAt.getTime()) || expiresAt <= now) throw new TypeError("expiresAt must be in the future");
    const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
    const tokenDigest = await digest(token), enrollmentId = crypto.randomUUID();
    const result = await this.database.transaction(async client => {
      const rows = await client.query<{ grant_revision: string | number }>(`SELECT g.grant_revision FROM app.credential_run_grants g
        JOIN app.credential_proxy_states p ON p.tenant_id=g.tenant_id
        JOIN app.job_runs r ON r.tenant_id=g.tenant_id AND r.id=g.run_id
        WHERE g.tenant_id=$1 AND g.run_id=$2 AND g.vm_identity=$3 AND g.proxy_identity=$4 AND g.boot_epoch=$5
          AND g.revoked_at IS NULL AND p.proxy_identity=g.proxy_identity AND p.boot_epoch=g.boot_epoch
          AND p.disabled_at IS NULL AND p.revoked_at IS NULL AND r.state IN ${activeStates}
        FOR UPDATE OF g,p,r`, [binding.tenantId, binding.runId, binding.vmIdentity, binding.proxyIdentity, binding.bootEpoch]);
      const revision = rows.rows[0]?.grant_revision;
      if (revision === undefined) return null;
      await client.query("UPDATE app.credential_run_enrollments SET consumed_at=$3 WHERE tenant_id=$1 AND run_id=$2 AND consumed_at IS NULL", [binding.tenantId, binding.runId, now]);
      await client.query(`INSERT INTO app.credential_run_enrollments(tenant_id,id,run_id,token_digest,vm_identity,proxy_identity,boot_epoch,grant_revision,expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [binding.tenantId, enrollmentId, binding.runId, Buffer.from(tokenDigest), binding.vmIdentity, binding.proxyIdentity, binding.bootEpoch, revision, expiresAt]);
      return Number(revision);
    });
    return result === null ? null : { enrollmentId, token, grantRevision: result };
  }

  async consume(token: string, binding: RunEnrollmentBinding, now = new Date()): Promise<ConsumedRunEnrollment | null> {
    validateBinding(binding);
    if (typeof token !== "string" || token.length < 32 || token.length > 128 || !Number.isFinite(now.getTime())) return null;
    const tokenDigest = Buffer.from(await digest(token));
    return this.database.transaction(async client => {
      const result = await client.query<{ id: string; grant_revision: string | number }>(`UPDATE app.credential_run_enrollments e
        SET consumed_at=$7
        FROM app.credential_run_grants g, app.credential_proxy_states p, app.job_runs r
        WHERE e.tenant_id=$1 AND e.token_digest=$2 AND e.run_id=$3 AND e.vm_identity=$4 AND e.proxy_identity=$5 AND e.boot_epoch=$6
          AND e.consumed_at IS NULL AND e.expires_at>$7
          AND g.tenant_id=e.tenant_id AND g.run_id=e.run_id AND g.vm_identity=e.vm_identity AND g.proxy_identity=e.proxy_identity AND g.boot_epoch=e.boot_epoch
          AND g.grant_revision=e.grant_revision AND g.revoked_at IS NULL
          AND p.tenant_id=e.tenant_id AND p.proxy_identity=e.proxy_identity AND p.boot_epoch=e.boot_epoch AND p.disabled_at IS NULL AND p.revoked_at IS NULL
          AND r.tenant_id=e.tenant_id AND r.id=e.run_id AND r.state IN ${activeStates}
        RETURNING e.id,e.grant_revision`, [binding.tenantId, tokenDigest, binding.runId, binding.vmIdentity, binding.proxyIdentity, binding.bootEpoch, now]);
      const row = result.rows[0];
      return row ? { ...binding, enrollmentId: row.id, grantRevision: Number(row.grant_revision) } : null;
    });
  }
}
