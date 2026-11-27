import { signingConfig } from "../../config/runtime";
import { HetznerConnectionRepository } from "../../credentials/storage/hetzner-connection-repository";
import { activeHetznerScope } from "../../integrations/application/hetzner-access";
import { HetznerInventoryService } from "../../integrations/application/hetzner-inventory";
import { lockIntegrationTopology } from "../../integrations/storage/integration-removal-topology";
import { databaseFor, type DatabaseClient } from "../../postgres/database";
import { isPublicAddress } from "../../proxy/transport/public-address";
import { ServiceError } from "../../service-contract";
import type { Env } from "../../types";
import type { SshClientAuthority } from "../api/contracts";
import { HetznerSshPinRepository } from "../storage/hetzner-pin-repository";

export function hetznerSshContext(env: Env, identity: { tenantId: string; userId: string }, sql?: DatabaseClient) {
  const database = databaseFor(env), key = signingConfig(env).credentialKey;
  const connections = new HetznerConnectionRepository(database, identity.tenantId, key);
  return {
    connections,
    inventory: new HetznerInventoryService(connections),
    pins: new HetznerSshPinRepository(sql ?? database.pool, identity.tenantId, identity.userId, key),
  };
}

export function hetznerSshAllowed(db: DatabaseClient, caller: SshClientAuthority) {
  return activeHetznerScope(db, { tenantId: caller.tenantId, userId: caller.userId, sessionVersion: caller.sessionVersion,
    installationId: caller.oauthInstallationId, grantId: caller.oauthGrantId, expiresAt: caller.oauthExpiresAt });
}

export async function resolveHetznerSshTarget(env: Env, caller: SshClientAuthority, serverId: number) {
  const db = databaseFor(env).pool, { connections, inventory, pins } = hetznerSshContext(env, caller, db);
  if (!await hetznerSshAllowed(db, caller)) throw new ServiceError(403, "hetzner_ssh_access_denied", "This client does not have access to the connected Hetzner project.");
  const pin = await pins.get(serverId);
  const project = await connections.get();
  if (!pin || pin.needsVerification || pin.projectRevision !== project?.revision) throw new ServiceError(412, "ssh_host_unverified", "Verify this server's SSH host fingerprint in Factorize before connecting.");
  const server = await inventory.targetForServer(serverId);
  if (!isPublicAddress(server.ipv4) || server.connectionRevision !== pin.projectRevision) {
    throw new ServiceError(412, "ssh_host_unverified", "Recheck this server's SSH host identity before connecting.");
  }
  return {
    target: { id: pin.revision, name: "Hetzner " + serverId, address: server.ipv4, username: pin.username, hostFingerprint: pin.hostFingerprint },
    markMismatch: async () => {
      const database = databaseFor(env);
      await database.transaction(async sql => {
        await lockIntegrationTopology(sql, caller.tenantId);
        const scoped = hetznerSshContext(env, caller, sql).pins;
        const latest = await scoped.get(serverId);
        if (latest?.revision === pin.revision && !latest.needsVerification) {
          await scoped.save({ ...latest, needsVerification: true });
        }
      });
    },
    current: async () => {
      const [scope, latest, active] = await Promise.all([hetznerSshAllowed(db, caller), pins.get(serverId), connections.get()]);
      return Boolean(scope && latest?.revision === pin.revision && !latest.needsVerification && active?.revision === pin.projectRevision);
    },
  };
}
