import type { Database } from "../../postgres/database";

export async function pruneAccessControl(db: Database) {
    await db.pool.query(`DELETE FROM app.oauth_installation_issuances WHERE id IN
      (SELECT id FROM app.oauth_installation_issuances WHERE expires_at<now()-interval '1 day' ORDER BY expires_at LIMIT 1000)`);
    await db.pool.query(`DELETE FROM app.oauth_installations WHERE (tenant_id,id) IN (
      SELECT i.tenant_id,i.id FROM app.oauth_installations i WHERE i.active_grant_id IS NULL AND i.created_at<now()-interval '1 day'
        AND NOT EXISTS (SELECT 1 FROM app.oauth_installation_issuances p WHERE (p.tenant_id,p.installation_id)=(i.tenant_id,i.id))
      ORDER BY i.created_at LIMIT 1000)`);
}

export async function pruneBrowserSessions(db: Database) {
    await db.pool.query(`DELETE FROM app.revoked_browser_sessions WHERE digest IN
      (SELECT digest FROM app.revoked_browser_sessions WHERE expires_at<now()-interval '1 day' ORDER BY expires_at LIMIT 5000)`);
}
