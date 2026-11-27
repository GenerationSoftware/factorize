import { getOAuthInstallation } from "../../access-control/application/oauth-installations";
import type { DatabaseClient } from "../../postgres/database";
import { requiredIntegrationScope, type AgentIntegration } from "../../proxy/application/agent-integration-access";

export type HetznerOAuthClient = {
  tenantId: string; userId: string; sessionVersion: number;
  installationId: string; grantId: string; expiresAt: number;
};

export async function activeHetznerScope(db: DatabaseClient, client: HetznerOAuthClient) {
  if (!Number.isFinite(client.expiresAt) || client.expiresAt <= Date.now() / 1000) return null;
  const [installation, integration] = await Promise.all([
    getOAuthInstallation(db, client.tenantId, client.userId, client.installationId),
    db.query<AgentIntegration>("SELECT * FROM app.agent_integrations WHERE tenant_id=$1 AND kind='hetzner' AND credential_id='hetzner'", [client.tenantId])
      .then(r => r.rows[0]),
  ]);
  if (!integration?.available || integration.policy === "disabled" || !installation || installation.revoked_at ||
      installation.active_grant_id !== client.grantId || installation.active_session_version !== client.sessionVersion ||
      (installation.active_expires_at && installation.active_expires_at.getTime() <= Date.now())) return null;
  const scope = requiredIntegrationScope(integration);
  // Like AWS Use, this is owner-managed authorization evaluated against a
  // live installation, not a new OAuth bearer scope.
  return installation.selected_scopes.includes(scope) ? scope : null;
}
