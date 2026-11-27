import type { z } from "zod";
import { signingConfig } from "../../config/runtime";
import { SshClientKeyRepository } from "../../credentials/storage/ssh-client-key-repository";
import { generateHetznerSshKey } from "../../integrations/providers/hetzner-ssh-transport";
import { lockIntegrationTopology } from "../../integrations/storage/integration-removal-topology";
import { databaseFor, type DatabaseClient } from "../../postgres/database";
import { ServiceError } from "../../service-contract";
import type { Env, OAuthProps } from "../../types";
import { publicHetznerSshPin, sshClientAuthority, sshExecResult, sshRoutingTarget, type hetznerSshPinInput, type SshClientAuthority, type sshExecInput, type sshTargetInput } from "../api/contracts";
import { isPublicAddress } from "../../proxy/transport/public-address";
import { hetznerSshContext } from "./hetzner-target";
import { SshTargetRepository } from "../storage/target-repository";

export async function activeSshClient(sql: DatabaseClient, caller: SshClientAuthority) {
  if (caller.oauthExpiresAt <= Date.now() / 1000) return false;
  const active = await sql.query(`SELECT 1 FROM app.oauth_installations i
    JOIN app.members m ON m.tenant_id=i.tenant_id AND m.user_id=i.user_id
    JOIN app.auth_users u ON u.id=m.user_id
    WHERE i.tenant_id=$1 AND i.user_id=$2 AND i.id=$3 AND i.active_grant_id=$4
      AND m.session_version=$5 AND i.active_session_version=$5 AND i.revoked_at IS NULL
      AND u.email_verified AND m.role='owner' AND ($6::text IS NULL OR i.client_id=$6)`,
  [caller.tenantId, caller.userId, caller.oauthInstallationId, caller.oauthGrantId, caller.sessionVersion, caller.oauthClientId ?? null]);
  return Boolean(active.rowCount);
}

export class SshService {
  constructor(private env: Env, private auth: OAuthProps,
    private owner: (scope: "integrations:read" | "integrations:write") => Promise<void>) {}

  private get db() { return databaseFor(this.env); }
  private targets(sql: DatabaseClient) {
    return new SshTargetRepository(sql, this.auth.tenantId, this.auth.userId, signingConfig(this.env).credentialKey);
  }

  private async caller(sql: DatabaseClient) {
    const forbidden = new ServiceError(403, "ssh_client_required", "Connect an active Factorize OAuth client.");
    if (this.auth.authMethod !== "oauth") throw forbidden;
    const { tenantId, userId, sessionVersion, oauthInstallationId, oauthClientId, oauthGrantId, oauthExpiresAt } = this.auth;
    const parsed = sshClientAuthority.safeParse({ tenantId, userId, sessionVersion,
      oauthInstallationId: oauthInstallationId ?? oauthGrantId, oauthClientId, oauthGrantId, oauthExpiresAt });
    if (!parsed.success || !await activeSshClient(sql, parsed.data)) throw forbidden;
    return parsed.data;
  }

  async publicKey() {
    return this.db.transaction(async sql => {
      await lockIntegrationTopology(sql, this.auth.tenantId);
      const caller = await this.caller(sql);
      const keys = new SshClientKeyRepository(this.auth.tenantId, signingConfig(this.env).credentialKey);
      const { publicKey } = await keys.getOrCreate(sql, caller.oauthInstallationId, generateHetznerSshKey);
      return { publicKey };
    });
  }

  async listTargets() {
    await this.owner("integrations:read");
    return { targets: await this.targets(this.db.pool).list() };
  }

  async addTarget(input: z.infer<typeof sshTargetInput>) {
    await this.owner("integrations:write");
    return this.db.transaction(async sql => {
      await lockIntegrationTopology(sql, this.auth.tenantId);
      const targets = this.targets(sql);
      if ((await targets.list()).length >= 100) throw new ServiceError(409, "ssh_target_limit", "Remove a saved SSH target before adding another.");
      return targets.add({ ...input, id: crypto.randomUUID() });
    });
  }

  async removeTarget(id: string) {
    await this.owner("integrations:write");
    return { deleted: await this.targets(this.db.pool).remove(id) };
  }

  async listHetznerPins() {
    await this.owner("integrations:read");
    const { connections, pins } = hetznerSshContext(this.env, this.auth);
    const project = await connections.get();
    return { targets: project ? (await pins.list(project.revision)).map(pin => publicHetznerSshPin.parse(pin)) : [] };
  }

  async saveHetznerPin(serverId: number, input: z.infer<typeof hetznerSshPinInput>) {
    await this.owner("integrations:write");
    const { inventory } = hetznerSshContext(this.env, this.auth);
    const server = await inventory.targetForServer(serverId);
    if (!isPublicAddress(server.ipv4)) throw new ServiceError(422, "ssh_target_ip_invalid", "This server has no supported public IPv4 address.");
    return this.db.transaction(async sql => {
      await lockIntegrationTopology(sql, this.auth.tenantId);
      const { connections, pins } = hetznerSshContext(this.env, this.auth, sql);
      if ((await connections.get(sql))?.revision !== server.connectionRevision) {
        throw new ServiceError(409, "hetzner_project_changed", "The Hetzner project changed. Refresh the list and verify the host again.");
      }
      const saved = await pins.save({ ...input, serverId, revision: crypto.randomUUID(), projectRevision: server.connectionRevision, needsVerification: false });
      return publicHetznerSshPin.parse(saved);
    });
  }

  async removeHetznerPin(serverId: number) {
    await this.owner("integrations:write");
    return this.db.transaction(async sql => {
      await lockIntegrationTopology(sql, this.auth.tenantId);
      return { deleted: await hetznerSshContext(this.env, this.auth, sql).pins.remove(serverId) };
    });
  }

  async exec(input: z.infer<typeof sshExecInput>) {
    const authority = await this.caller(this.db.pool);
    const broker = this.env.CLIENT_SSH;
    if (!broker) throw new ServiceError(503, "ssh_unavailable", "The SSH command broker is unavailable.");
    const name = JSON.stringify([authority.tenantId, authority.userId, authority.oauthInstallationId, sshRoutingTarget(input)]);
    const result = await broker.get(broker.idFromName(name)).fetch("https://ssh.internal/exec", {
      method: "POST", body: JSON.stringify({ ...input, authority })
    });
    switch (result.status) {
      case 200: return sshExecResult.parse(await result.json());
      case 401: throw new ServiceError(403, "ssh_client_inactive", "The OAuth client was not active.");
      case 403: throw new ServiceError(403, "hetzner_ssh_access_denied", "This client does not have access to the connected Hetzner project.");
      case 412: throw new ServiceError(412, "ssh_host_unverified", "Verify this server's SSH host fingerprint in Factorize before connecting.");
      case 421: throw new ServiceError(421, "ssh_host_fingerprint_changed", "The SSH host fingerprint differs from the verified fingerprint. No command ran. Verify the new fingerprint independently before reconnecting.");
      case 424: throw new ServiceError(424, "hetzner_ssh_lookup_failed", "Could not verify the server's current address through Hetzner. No command ran.");
      case 404: throw new ServiceError(404, "ssh_target_not_found", "Save a verified target before running SSH commands.");
      case 409: throw new ServiceError(409, "ssh_busy_or_no_key", "Generate this client's SSH key first, and wait for any running command.");
      case 422: throw new ServiceError(422, "ssh_login_failed", "SSH login failed. Check the saved host key, account, and authorized public key.");
      default: throw new ServiceError(502, "ssh_outcome_unknown", "SSH disconnected or timed out. The command may have run. Do not retry blindly.");
    }
  }
}
