import type { Database } from "./database";
import type { VendorIdentity, VendorIdentityProvider } from "../vendor-run-identity";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const activeStates = "('starting','running','blocked')";

export type VendorRunIdentityBinding = {
  tenantId: string;
  runId: string;
  provider: VendorIdentityProvider;
  vmId: string;
  issuer: string;
  subject: string;
  audience: string;
  issuedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
};

function validate(input: { tenantId: string; identity: VendorIdentity; issuedAt: number }): void {
  if (!uuid.test(input.tenantId) || !uuid.test(input.identity.runId)) throw new TypeError("Vendor identity tenant and run IDs must be UUIDs");
  for (const [name, value, max] of [
    ["vmId", input.identity.vmId, 255], ["issuer", input.identity.issuer, 512],
    ["subject", input.identity.subject, 512], ["audience", input.identity.audience, 512],
  ] as const) {
    if (typeof value !== "string" || !value.trim() || value.length > max) throw new TypeError(`${name} must contain 1 to ${max} characters`);
  }
  if (!Number.isSafeInteger(input.issuedAt) || !Number.isSafeInteger(input.identity.expiresAt) || input.identity.expiresAt <= input.issuedAt) throw new TypeError("Vendor identity validity interval is invalid");
  if (!input.identity.keyId || input.identity.keyId.length > 255) throw new TypeError("Vendor identity key ID is invalid");
}

function matches(row: VendorRunIdentityBinding, identity: VendorIdentity): boolean {
  return row.provider === identity.provider && row.runId === identity.runId && row.vmId === identity.vmId
    && row.issuer === identity.issuer && row.subject === identity.subject && row.audience === identity.audience;
}

/** Persists verified identity claims, never the bearer JWT. A run's provider
 * identity is immutable; renewal can extend its expiry but cannot rebind it. */
export class VendorRunIdentityRepository {
  constructor(private readonly database: Database) {}

  async persistVerified(input: { tenantId: string; identity: VendorIdentity; issuedAt: number; now?: Date }): Promise<VendorRunIdentityBinding> {
    validate(input);
    const now = input.now ?? new Date();
    if (!Number.isFinite(now.getTime())) throw new TypeError("now must be a valid date");
    const issuedAt = new Date(input.issuedAt * 1000), expiresAt = new Date(input.identity.expiresAt * 1000);
    if (expiresAt <= now) throw new TypeError("Vendor identity has expired");

    return this.database.transaction(async client => {
      const active = await client.query(`SELECT 1 FROM app.job_runs WHERE tenant_id=$1 AND id=$2 AND state IN ${activeStates} FOR UPDATE`, [input.tenantId, input.identity.runId]);
      if (!active.rowCount) throw new Error("Vendor identity run is not active");

      const current = await client.query<VendorRunIdentityBinding>(`SELECT tenant_id AS "tenantId",run_id AS "runId",provider,vm_id AS "vmId",issuer,subject,audience,issued_at AS "issuedAt",expires_at AS "expiresAt",revoked_at AS "revokedAt"
        FROM app.vendor_run_identity_bindings WHERE tenant_id=$1 AND run_id=$2 AND provider=$3 FOR UPDATE`, [input.tenantId, input.identity.runId, input.identity.provider]);
      const existing = current.rows[0];
      if (existing) {
        if (existing.revokedAt) throw new Error("Vendor identity binding is revoked");
        if (!matches(existing, input.identity)) throw new Error("Vendor identity does not match the persisted run binding");
        const renewed = await client.query<VendorRunIdentityBinding>(`UPDATE app.vendor_run_identity_bindings
          SET issued_at=$4,expires_at=$5,updated_at=$6
          WHERE tenant_id=$1 AND run_id=$2 AND provider=$3 AND revoked_at IS NULL
          RETURNING tenant_id AS "tenantId",run_id AS "runId",provider,vm_id AS "vmId",issuer,subject,audience,issued_at AS "issuedAt",expires_at AS "expiresAt",revoked_at AS "revokedAt"`,
        [input.tenantId, input.identity.runId, input.identity.provider, issuedAt, expiresAt, now]);
        if (!renewed.rows[0]) throw new Error("Vendor identity binding is revoked");
        return renewed.rows[0];
      }

      try {
        const saved = await client.query<VendorRunIdentityBinding>(`INSERT INTO app.vendor_run_identity_bindings(tenant_id,run_id,provider,vm_id,issuer,subject,audience,issued_at,expires_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          RETURNING tenant_id AS "tenantId",run_id AS "runId",provider,vm_id AS "vmId",issuer,subject,audience,issued_at AS "issuedAt",expires_at AS "expiresAt",revoked_at AS "revokedAt"`,
        [input.tenantId, input.identity.runId, input.identity.provider, input.identity.vmId, input.identity.issuer, input.identity.subject, input.identity.audience, issuedAt, expiresAt]);
        return saved.rows[0]!;
      } catch (error) {
        if ((error as { code?: unknown })?.code === "23505") throw new Error("Vendor VM or subject is already bound to another run");
        throw error;
      }
    });
  }

  async getActive(input: { tenantId: string; runId: string; provider: VendorIdentityProvider; now?: Date }): Promise<VendorRunIdentityBinding | null> {
    if (!uuid.test(input.tenantId) || !uuid.test(input.runId)) throw new TypeError("Vendor identity tenant and run IDs must be UUIDs");
    const now = input.now ?? new Date();
    const result = await this.database.pool.query<VendorRunIdentityBinding>(`SELECT b.tenant_id AS "tenantId",b.run_id AS "runId",b.provider,b.vm_id AS "vmId",b.issuer,b.subject,b.audience,b.issued_at AS "issuedAt",b.expires_at AS "expiresAt",b.revoked_at AS "revokedAt"
      FROM app.vendor_run_identity_bindings b JOIN app.job_runs r ON r.tenant_id=b.tenant_id AND r.id=b.run_id
      WHERE b.tenant_id=$1 AND b.run_id=$2 AND b.provider=$3 AND b.revoked_at IS NULL AND b.expires_at>$4 AND r.state IN ${activeStates}`,
    [input.tenantId, input.runId, input.provider, now]);
    return result.rows[0] ?? null;
  }

  async revoke(input: { tenantId: string; runId: string; provider: VendorIdentityProvider; now?: Date }): Promise<boolean> {
    if (!uuid.test(input.tenantId) || !uuid.test(input.runId)) throw new TypeError("Vendor identity tenant and run IDs must be UUIDs");
    const result = await this.database.pool.query(`UPDATE app.vendor_run_identity_bindings SET revoked_at=$4,updated_at=$4
      WHERE tenant_id=$1 AND run_id=$2 AND provider=$3 AND revoked_at IS NULL`, [input.tenantId, input.runId, input.provider, input.now ?? new Date()]);
    return Boolean(result.rowCount);
  }
}
