import { signingConfig } from "../../config/runtime";
import { HetznerClientKeyRepository } from "../../credentials/storage/hetzner-client-key-repository";
import { HetznerConnectionRepository } from "../../credentials/storage/hetzner-connection-repository";
import { databaseFor, type DatabaseClient } from "../../postgres/database";
import { ServiceError } from "../../service-contract";
import type { Env, OAuthProps } from "../../types";
import { generateHetznerSshKey } from "../providers/hetzner-ssh-transport";
import { lockIntegrationTopology } from "../storage/integration-removal-topology";
import { activeHetznerScope } from "./hetzner-access";

export class HetznerClientKeyService {
  constructor(private env: Env, private auth: OAuthProps) {}
  private get database() { return databaseFor(this.env); }
  private get projects() { return new HetznerConnectionRepository(this.database, this.auth.tenantId, signingConfig(this.env).credentialKey); }
  private get keys() { return new HetznerClientKeyRepository(this.auth.tenantId, signingConfig(this.env).credentialKey); }

  private async authority(sql: DatabaseClient) {
    const { authMethod, oauthInstallationId, oauthGrantId, oauthExpiresAt, tenantId, userId, sessionVersion } = this.auth;
    const forbidden = new ServiceError(403, "hetzner_not_authorized", "This client does not have Hetzner access.");
    if (authMethod !== "oauth" || !oauthInstallationId || !oauthGrantId || !Number.isFinite(oauthExpiresAt)) throw forbidden;
    const current = await activeHetznerScope(sql, { tenantId, userId, sessionVersion, installationId: oauthInstallationId, grantId: oauthGrantId, expiresAt: oauthExpiresAt! });
    if (!current) throw forbidden;
    const { rowCount } = await sql.query(
      `SELECT 1 FROM app.members m JOIN app.auth_users u ON u.id=m.user_id
       WHERE m.tenant_id=$1 AND m.user_id=$2 AND m.role='owner' AND m.session_version=$3 AND u.email_verified`,
      [tenantId, userId, sessionVersion],
    );
    if (!rowCount) throw forbidden;
    return oauthInstallationId;
  }

  async publicKey() {
    return this.database.transaction(async sql => {
      await lockIntegrationTopology(sql, this.auth.tenantId);
      const installationId = await this.authority(sql);
      if (!await this.projects.get(sql)) throw new ServiceError(404, "hetzner_not_connected", "Connect a Hetzner Cloud project first.");
      const { publicKey } = await this.keys.getOrCreate(sql, installationId, generateHetznerSshKey);
      return { publicKey, authorizedKeysEntry: `restrict,command="/bin/true" ${publicKey}`,
        notice: "An owner must install the complete restricted key line on an existing server. Do not install it as root." };
    });
  }

}
