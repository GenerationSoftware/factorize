import { z } from "zod";
import { getOAuthInstallation } from "../../access-control/application/oauth-installations";
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

export const hetznerProbeRequest = z.strictObject({
  tenantId: z.uuid(), ownerId: z.uuid(), principal: z.union([z.literal("owner"), z.uuid()]),
  serverId: hetznerServerId, version: z.uuid(),
});

function publicHost(host: z.infer<typeof hetznerSshTarget>) {
  const { serverId, username, hostFingerprint, clientInstallationId, publicKey } = host;
  return hetznerSshTarget.parse({ serverId, username, hostFingerprint, clientInstallationId, publicKey });
}

export class HetznerSshService {
  constructor(private env: Env, private auth: OAuthProps, private read: () => Promise<void>,
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
    const keys = generateHetznerSshKey();
    const host = { ...enrollment, ...keys, connectionRevision: selected.connectionRevision, ownerId: userId,
      version: crypto.randomUUID(), address: selected.ipv4 };
    await this.database().transaction(async sql => {
      await lockIntegrationTopology(sql, tenantId);
      if ((await this.projects.get(sql))?.revision !== selected.connectionRevision) {
        throw new ServiceError(409, "hetzner_connection_changed", "The Hetzner project changed. Select the server again.");
      }
      const client = await getOAuthInstallation(sql, tenantId, userId, enrollment.clientInstallationId);
      if (!client || client.revoked_at || !client.active_grant_id || !client.active_scopes.includes("integrations:read")) {
        throw new ServiceError(400, "ssh_client_not_authorized", "Select a currently authorized MCP client.");
      }
      if (await this.repository.get(enrollment.serverId, sql)) {
        throw new ServiceError(409, "ssh_target_exists", "Delete the existing SSH enrollment before replacing it.");
      }
      await this.repository.put(host, sql);
    });
    return publicHost(host);
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
    return this.check(serverId, "owner");
  }

  async checkAsClient(serverId: number) {
    await this.read();
    const { authMethod, oauthInstallationId, oauthGrantId, tenantId, userId } = this.auth;
    if (authMethod !== "oauth" || !oauthInstallationId || !oauthGrantId) {
      throw new ServiceError(403, "ssh_client_not_authorized", "An explicitly enrolled OAuth client is required.");
    }
    const client = await getOAuthInstallation(this.database().pool, tenantId, userId, oauthInstallationId);
    if (!client || client.revoked_at || client.active_grant_id !== oauthGrantId || !client.active_scopes.includes("integrations:read")) {
      throw new ServiceError(403, "ssh_client_not_authorized", "This client is no longer authorized.");
    }
    return this.check(serverId, oauthInstallationId);
  }

  private async check(serverId: number, principal: string) {
    const { tenantId, userId } = this.auth;
    const host = await this.repository.get(serverId);
    if (!host || host.ownerId !== userId || (principal !== "owner" && host.clientInstallationId !== principal)) {
      throw new ServiceError(404, "ssh_target_not_found", "No SSH enrollment is available to this caller.");
    }
    const broker = this.env.HETZNER_SSH;
    if (!broker) throw new ServiceError(503, "ssh_unavailable", "SSH checks are unavailable.");
    const stub = broker.get(broker.idFromName(`${tenantId}:${userId}:${serverId}:${host.version}:${principal}`));
    const response = await stub.fetch("https://hetzner-ssh.internal/check", { method: "POST", body: JSON.stringify({
      tenantId, ownerId: userId, principal, serverId, version: host.version,
    }) });
    if (!response.ok) {
      if (response.status === 409) throw new ServiceError(409, "ssh_busy", "An SSH check is already running.");
      throw new ServiceError(502, "ssh_check_failed", "SSH check failed. Verify the enrolled host fingerprint, account and public key.");
    }
    return hetznerSshResult.parse(await response.json());
  }
}
