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

export async function resolveHetznerSshTarget(env: Env, caller: SshClientAuthority, serverId: number, username?: string) {
  const database = databaseFor(env), db = database.pool;
  const { connections, inventory, pins } = hetznerSshContext(env, caller, db);
  if (!await hetznerSshAllowed(db, caller)) throw new ServiceError(403, "hetzner_ssh_access_denied", "This client does not have access to the connected Hetzner project.");
  const project = await connections.get();
  const pin = await pins.get(serverId);
  const unverified = () => new ServiceError(412, "ssh_host_unverified", "Recheck this server's SSH host identity before connecting.");
  if (!project || (pin && (pin.needsVerification || pin.projectRevision !== project.revision))) throw unverified();
  const server = await inventory.targetForServer(serverId);
  if (!isPublicAddress(server.ipv4) || server.connectionRevision !== project.revision) throw unverified();

  const target = {
    id: pin?.revision ?? crypto.randomUUID(),
    name: "Hetzner " + serverId,
    address: server.ipv4,
    username: username ?? pin?.username ?? "factorize-agent",
    hostFingerprint: pin?.hostFingerprint ?? null,
  };
  const persist = async (observed: string): Promise<"saved" | "changed" | "stale"> =>
    database.transaction(async sql => {
      await lockIntegrationTopology(sql, caller.tenantId);
      const scoped = hetznerSshContext(env, caller, sql);
      if (!await hetznerSshAllowed(sql, caller) || (await scoped.connections.get(sql))?.revision !== project.revision) return "stale";
      const latest = await scoped.pins.get(serverId);
      if (latest) {
        if (latest.needsVerification || latest.projectRevision !== project.revision) return "stale";
        if (latest.hostFingerprint !== observed) {
          // A concurrent first connection or owner write won. Never overwrite its fingerprint.
          return "changed";
        }
        target.id = latest.revision;
      } else {
        await scoped.pins.save({ serverId, revision: target.id, username: target.username,
          hostFingerprint: observed, projectRevision: project.revision, needsVerification: false });
      }
      target.hostFingerprint = observed;
      return "saved";
    });

  return {
    target, persist,
    markMismatch: async () => {
      if (!pin) return;
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
      return Boolean(scope && latest?.revision === target.id && !latest.needsVerification && active?.revision === project.revision);
    },
  };
}
