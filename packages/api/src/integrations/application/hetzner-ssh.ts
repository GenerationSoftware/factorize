import { HetznerClientKeyRepository } from "../../credentials/storage/hetzner-client-key-repository";
import { HetznerServerRequests } from "../storage/hetzner-server-requests";
import { getOAuthInstallation } from "../../access-control/application/oauth-installations";
import { provisionedSshUser } from "../providers/hetzner-cloud";
import { z } from "zod";
import { activeHetznerScope } from "./hetzner-access";
import { signingConfig } from "../../config/runtime";
import { HetznerConnectionRepository } from "../../credentials/storage/hetzner-connection-repository";
import { HetznerSshRepository } from "../../credentials/storage/hetzner-ssh-repository";
import { databaseFor } from "../../postgres/database";
import { isPublicAddress } from "../../proxy/transport/public-address";
import { ServiceError } from "../../service-contract";
import type { Env, OAuthProps } from "../../types";
import { hetznerServerId, hetznerSshEnrollment, hetznerSshResult, hetznerSshTarget } from "../api/hetzner-ssh-contracts";
import { generateHetznerSshKey } from "../providers/hetzner-ssh-transport";
import { lockIntegrationTopology } from "../storage/integration-removal-topology";
import { HetznerInventoryService } from "./hetzner-inventory";

const authority = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("owner") }),
  z.strictObject({ type: z.literal("oauth"), installationId: z.string().min(1).max(512), grantId: z.string().min(1), expiresAt: z.number().finite(), scope: z.string().min(1) }),
]);

export const hetznerProbeRequest = z.strictObject({
  tenantId: z.uuid(), ownerId: z.uuid(), authority, sessionVersion: z.number().int().positive(),
  serverId: hetznerServerId, version: z.uuid(),
});

function publicHost(host: z.infer<typeof hetznerSshTarget>) {
  const { serverId, username, hostFingerprint, clientInstallationId, publicKey } = host;
  return hetznerSshTarget.parse({ serverId, username, hostFingerprint, clientInstallationId, publicKey });
}

export class HetznerSshService {
  constructor(private env: Env, private auth: OAuthProps,
    private owner: (scope: "integrations:read" | "integrations:write") => Promise<void>) {}

  private database() { return databaseFor(this.env); }
  private get repository() {
    return new HetznerSshRepository(this.database(), this.auth.tenantId, signingConfig(this.env).credentialKey);
  }
  private get projects() {
    return new HetznerConnectionRepository(this.database(), this.auth.tenantId, signingConfig(this.env).credentialKey);
  }

  async list() {
    await this.owner("integrations:read");
    return { servers: (await this.repository.listForOwner(this.auth.userId)).map(publicHost) };
  }

  async enroll(input: unknown) {
    await this.owner("integrations:write");
    const enrollment = hetznerSshEnrollment.parse(input);
    const { tenantId, userId } = this.auth;
    const selected = await new HetznerInventoryService(this.projects).targetForServer(enrollment.serverId);
    if (!isPublicAddress(selected.ipv4)) throw new ServiceError(400, "ssh_public_address_required", "This server needs a public IPv4 address for SSH checks.");
    return this.database().transaction(async sql => {
      await lockIntegrationTopology(sql, tenantId);
      if ((await this.projects.get(sql))?.revision !== selected.connectionRevision) {
        throw new ServiceError(409, "hetzner_connection_changed", "The Hetzner project changed. Select the server again.");
      }
      if (await this.repository.get(enrollment.serverId, sql)) {
        throw new ServiceError(409, "ssh_target_exists", "Delete the existing SSH enrollment before replacing it.");
      }
      const provisionedClient = await new HetznerServerRequests(tenantId, userId).installation(sql, selected.connectionRevision, enrollment.serverId);
      if (provisionedClient && (enrollment.username !== provisionedSshUser ||
          (enrollment.clientInstallationId && enrollment.clientInstallationId !== provisionedClient))) {
        throw new ServiceError(400, "ssh_target_mismatch", "Use the provisioned non-root account and the client that created this server.");
      }
      const clientInstallationId = provisionedClient ?? enrollment.clientInstallationId;
      if (clientInstallationId) {
        const client = await getOAuthInstallation(sql, tenantId, userId, clientInstallationId);
        if (!client?.active_grant_id || client.revoked_at || client.active_session_version !== this.auth.sessionVersion ||
            (client.active_expires_at && client.active_expires_at.getTime() <= Date.now())) {
          throw new ServiceError(400, "ssh_client_not_authorized", "Choose a current authorized OAuth client.");
        }
      }
      const keys = clientInstallationId ?
        await new HetznerClientKeyRepository(tenantId, signingConfig(this.env).credentialKey).getOrCreate(sql, clientInstallationId, generateHetznerSshKey) :
        generateHetznerSshKey();
      const host = { ...enrollment, ...(clientInstallationId ? { clientInstallationId } : {}), ...keys,
        connectionRevision: selected.connectionRevision, ownerId: userId, version: crypto.randomUUID(), address: selected.ipv4 };
      await this.repository.put(host, sql);
      return publicHost(host);
    });
  }

  async delete(serverId: number) {
    await this.owner("integrations:write");
    return this.database().transaction(async sql => {
      await lockIntegrationTopology(sql, this.auth.tenantId);
      const host = await this.repository.get(serverId, sql);
      if (host?.ownerId !== this.auth.userId) return { deleted: false };
      await this.repository.delete(serverId, sql);
      return { deleted: true };
    });
  }

  async checkAsOwner(serverId: number) {
    await this.owner("integrations:read");
    return this.check(serverId, { type: "owner" });
  }

  async checkAsClient(serverId: number) {
    return this.check(serverId, await this.clientAuthority());
  }

  async inventoryAsClient() {
    await this.clientAuthority();
    const inventory = await new HetznerInventoryService(this.projects).inventory();
    await this.clientAuthority();
    return inventory;
  }

  private async clientAuthority() {
    const { authMethod, oauthInstallationId, oauthGrantId, oauthExpiresAt, tenantId, userId, sessionVersion } = this.auth;
    const forbidden = () => new ServiceError(403, "hetzner_not_authorized", "This client does not have Hetzner access.");
    if (authMethod !== "oauth" || !oauthInstallationId || !oauthGrantId || !oauthExpiresAt) throw forbidden();
    const scope = await activeHetznerScope(this.database().pool, { tenantId, userId, sessionVersion, installationId: oauthInstallationId,
      grantId: oauthGrantId, expiresAt: oauthExpiresAt });
    if (!scope) throw forbidden();
    return { type: "oauth" as const, installationId: oauthInstallationId, grantId: oauthGrantId, expiresAt: oauthExpiresAt, scope };
  }

  private async check(serverId: number, principal: z.infer<typeof authority>) {
    const { tenantId, userId } = this.auth;
    const host = await this.repository.get(serverId);
    if (!host || host.ownerId !== userId || (principal.type === "oauth" && host.clientInstallationId !== principal.installationId)) {
      throw new ServiceError(404, "ssh_target_not_found", "No SSH enrollment is available to this caller.");
    }
    const broker = this.env.HETZNER_SSH;
    if (!broker) throw new ServiceError(503, "ssh_unavailable", "SSH checks are unavailable.");
    const stub = broker.get(broker.idFromName(`${tenantId}:${userId}:${serverId}:${host.version}`));
    const response = await stub.fetch("https://hetzner-ssh.internal/check", { method: "POST", body: JSON.stringify({
      tenantId, ownerId: userId, authority: principal, sessionVersion: this.auth.sessionVersion, serverId, version: host.version,
    }) });
    if (!response.ok) {
      if (response.status === 409) throw new ServiceError(409, "ssh_busy", "An SSH check is already running.");
      throw new ServiceError(502, "ssh_check_failed", "SSH check failed. Verify the server still belongs to the connected project and that its address, fingerprint, account and key have not changed.");
    }
    return hetznerSshResult.parse(await response.json());
  }
}
