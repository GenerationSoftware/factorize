import { signingConfig } from "../../config/runtime";
import { HetznerClientKeyRepository } from "../../credentials/storage/hetzner-client-key-repository";
import { HetznerConnectionRepository } from "../../credentials/storage/hetzner-connection-repository";
import { databaseFor, type DatabaseClient } from "../../postgres/database";
import { ServiceError } from "../../service-contract";
import type { Env, OAuthProps } from "../../types";
import type { HetznerCreateInput } from "../api/hetzner-contracts";
import { createHetznerCloudClient, HetznerCloudError } from "../providers/hetzner-cloud";
import { generateHetznerSshKey } from "../providers/hetzner-ssh-transport";
import { HetznerServerRequests } from "../storage/hetzner-server-requests";
import { lockIntegrationTopology } from "../storage/integration-removal-topology";
import { activeHetznerScope } from "./hetzner-access";
import { reportIntegrationFailure } from "./diagnostics";

export class HetznerProvisionService {
  constructor(private env: Env, private auth: OAuthProps) {}
  private get database() { return databaseFor(this.env); }
  private get projects() { return new HetznerConnectionRepository(this.database, this.auth.tenantId, signingConfig(this.env).credentialKey); }
  private get keys() { return new HetznerClientKeyRepository(this.auth.tenantId, signingConfig(this.env).credentialKey); }
  private get requests() { return new HetznerServerRequests(this.auth.tenantId, this.auth.userId); }

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

  async create(input: HetznerCreateInput) {
    const { project, ticket, dispatch, serverId, publicKey } = await this.database.transaction(async sql => {
      await lockIntegrationTopology(sql, this.auth.tenantId);
      const installationId = await this.authority(sql);
      const project = await this.projects.get(sql);
      if (!project?.provisioningEnabled) throw new ServiceError(403, "hetzner_provisioning_disabled", "The owner has not enabled server provisioning for this Hetzner Cloud project.");
      const request = await this.requests.reserve(sql, installationId, project.revision, input);
      const { publicKey } = await this.keys.getOrCreate(sql, installationId, generateHetznerSshKey);
      return { project, ...request, publicKey };
    });
    const recheck = async () => {
      await this.authority(this.database.pool);
      if ((await this.projects.get())?.revision !== project.revision) {
        throw new ServiceError(409, "hetzner_connection_changed", "The Hetzner project changed.");
      }
    };

    let id = serverId;
    if (id === null) {
      // A durable reservation permits exactly one POST. Repeated calls can only look up the ticket.
      const client = createHetznerCloudClient();
      await recheck();
      const started = performance.now();
      try {
        id = dispatch ? await client.create(project.token, input, ticket, publicKey) : await client.reconcile(project.token, input.name, ticket);
      } catch (error) {
        if (!(error instanceof HetznerCloudError)) throw error;
        const requestId = reportIntegrationFailure({ provider: "hetzner", operation: "provision_server", reason: error.reason, upstreamStatus: error.upstreamStatus }, started, error.kind !== "auth");
        if (error.kind === "auth") throw new ServiceError(422, "hetzner_provisioning_token_rejected", "Hetzner rejected the project token. Provisioning needs a project token with Read & Write permission.", requestId);
        throw new ServiceError(502, "hetzner_create_unconfirmed", "Hetzner did not confirm this server request. Check the project or repeat the same request ID to reconcile without creating another server.", requestId);
      }
      if (id !== null) await this.requests.complete(this.database.pool, ticket, id);
    }
    await recheck();
    return id === null ? { state: "unconfirmed" as const, requestId: input.requestId,
      notice: "No matching server is visible yet. Reuse this request ID to reconcile; Factorize will not send another create request." } :
      { state: "created" as const, requestId: input.requestId, serverId: id, name: input.name,
        ssh: "owner_pin_required" as const, notice: "Hetzner accepted the server. The client key is configured at first boot. Before SSH checks, an owner must verify the host fingerprint from a trusted console." };
  }
}
