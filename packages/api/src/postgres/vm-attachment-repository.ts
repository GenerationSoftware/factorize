import type { AgentIntegration } from "../agent-api";
import { connectionAccess } from "../agent-api";
import type { Database } from "./database";

type AttachmentStatus = "active" | "expired" | "revoked" | "inactive" | "pending";
type RunBinding = {
  sourceId: string;
  sourceName: string | null;
  vmId: string;
  provider: "exe.dev" | "fly.io";
  expiresAt: Date;
  revokedAt: Date | null;
  runnable: boolean;
};
type ClientBinding = {
  id: string;
  sourceId: string;
  label: string | null;
  vmId: string;
  app: string | null;
  provider: AgentIntegration;
  providerEpoch: number;
  expiresAt: Date;
  revokedAt: Date | null;
  parentRevokedAt: Date | null;
  enrolled: boolean;
  currentMember: boolean;
  parent_scopes: string[];
  disabled_scopes: string[];
  integration_overrides: Record<string, string | false>;
};

function accessStatus(revoked: Date | null, expiry: Date, now: number, enrolled: boolean, eligible: boolean): AttachmentStatus {
  if (revoked) return "revoked";
  if (expiry.getTime() <= now) return "expired";
  if (!enrolled) return "pending";
  return eligible ? "active" : "inactive";
}

export class VmAttachmentRepository {
  constructor(private db: Database, private tenantId: string) {}

  async runs(runId?: string) {
    const { rows } = await this.db.pool.query<RunBinding>(`
      SELECT b.run_id AS "sourceId", NULLIF(r.run_name, '') AS "sourceName", b.vm_id AS "vmId", b.provider, b.expires_at AS "expiresAt",
        b.revoked_at AS "revokedAt",
        coalesce(t.state IN ('starting','running','blocked') AND r.state IN ('starting','running','blocked')
          AND EXISTS (SELECT 1 FROM app.run_authorizations a
            JOIN app.members m ON m.tenant_id=a.tenant_id AND m.user_id=a.user_id
            JOIN app.auth_users u ON u.id=m.user_id AND u.email_verified
            WHERE a.tenant_id=b.tenant_id AND a.run_id=b.run_id AND m.role='owner'
              AND m.session_version=a.session_version), false) AS runnable
      FROM app.vendor_run_identity_bindings b
      JOIN app.trigger_runs t ON t.tenant_id=b.tenant_id AND t.id=b.run_id
      LEFT JOIN app.runs r ON r.tenant_id=b.tenant_id AND r.id=b.run_id
      WHERE b.tenant_id=$1 AND ($2::uuid IS NULL OR b.run_id=$2)
        AND ($2::uuid IS NOT NULL OR (b.revoked_at IS NULL AND b.expires_at>now()
          AND t.state IN ('starting','running','blocked')))
      ORDER BY b.issued_at DESC, b.run_id, b.provider`, [this.tenantId, runId ?? null]);
    const now = Date.now();
    return rows.map(row => ({
      id: `${row.sourceId}:${row.provider}`,
      source: "run" as const,
      sourceId: row.sourceId,
      sourceName: row.sourceName,
      vmId: row.vmId,
      app: null,
      provider: row.provider,
      expiresAt: row.expiresAt.toISOString(),
      revokedAt: row.revokedAt?.toISOString() ?? null,
      status: accessStatus(row.revokedAt, row.expiresAt, now, true, row.runnable),
    }));
  }

  async clients(userId: string, grantId?: string) {
    const { rows } = await this.db.pool.query<ClientBinding>(`
      SELECT g.id, p.subject AS "sourceId", p.display_name AS label, g.vm AS "vmId", g.app,
        to_jsonb(i) AS provider, g.provider_epoch AS "providerEpoch", g.expires_at AS "expiresAt",
        g.revoked_at AS "revokedAt", p.revoked_at AS "parentRevokedAt", g.issuer IS NOT NULL AS enrolled,
        EXISTS (SELECT 1 FROM app.members m JOIN app.auth_users u ON u.id=m.user_id AND u.email_verified
          WHERE m.tenant_id=p.tenant_id AND m.user_id=p.user_id AND m.role='owner'
            AND m.session_version=p.session_version) AS "currentMember",
        g.parent_scopes, p.disabled_scopes, p.integration_overrides
      FROM app.vm_grants g
      JOIN app.agent_identities p ON p.tenant_id=g.tenant_id AND p.id=g.parent_id AND p.kind='oauth'
      JOIN app.agent_integrations i ON i.tenant_id=g.tenant_id AND i.id=g.provider_id
      WHERE g.tenant_id=$1 AND p.user_id=$2 AND ($3::text IS NULL OR p.subject=$3)
        AND ($3::text IS NOT NULL OR (g.revoked_at IS NULL AND p.revoked_at IS NULL AND g.expires_at>now()))
      ORDER BY g.expires_at DESC, g.id`, [this.tenantId, userId, grantId ?? null]);
    const now = Date.now();
    return rows.map(row => {
      const eligible = row.currentMember && row.provider.epoch === row.providerEpoch
        && !row.disabled_scopes.includes("vm:grant")
        && connectionAccess(row.provider, row.parent_scopes, row) === "granted";
      const revokedAt = row.revokedAt ?? row.parentRevokedAt;
      return {
        id: row.id,
        source: "client" as const,
        sourceId: row.sourceId,
        sourceName: row.label,
        vmId: row.vmId,
        app: row.app,
        provider: row.app ? "fly.io" as const : "exe.dev" as const,
        expiresAt: row.expiresAt.toISOString(),
        revokedAt: revokedAt?.toISOString() ?? null,
        status: accessStatus(revokedAt, row.expiresAt, now, row.enrolled, eligible),
      };
    });
  }
}
