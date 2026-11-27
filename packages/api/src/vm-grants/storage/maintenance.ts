import type { Database } from "../../postgres/database";

export async function pruneVmGrants(db: Database) {
    await db.pool.query(`DELETE FROM app.vm_permission_proofs WHERE (tenant_id,grant_id,proof_id) IN
      (SELECT tenant_id,grant_id,proof_id FROM app.vm_permission_proofs WHERE expires_at<now() ORDER BY expires_at LIMIT 5000)`);
    await db.pool.query(`UPDATE app.vm_permission_grants SET revoked_at=now(),updated_at=now(),updated_by='system:enrollment-timeout',
      cleaned_at=CASE WHEN provider_kind='fly' THEN now() ELSE NULL END
      WHERE activated_at IS NULL AND revoked_at IS NULL AND created_at<now()-interval '1 hour'`);
}
