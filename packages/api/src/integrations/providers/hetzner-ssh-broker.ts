import { DurableObject } from "cloudflare:workers";
import { activeHetznerScope } from "../application/hetzner-access";
import { IdentityRepository } from "../../auth/storage/identity-repository";
import type { Env } from "../../config/bindings";
import { signingConfig } from "../../config/runtime";
import { HetznerConnectionRepository } from "../../credentials/storage/hetzner-connection-repository";
import { HetznerSshRepository } from "../../credentials/storage/hetzner-ssh-repository";
import { databaseFor } from "../../postgres/database";
import { hetznerProbeRequest } from "../application/hetzner-ssh";
import { freshHetznerProbe } from "../application/hetzner-ssh-probe";
import { createHetznerCloudClient } from "./hetzner-cloud";
import { authenticateHetznerSsh } from "./hetzner-ssh-transport";

/** Internal-only binding. Serialize fresh checks on the same enrollment. */
export class HetznerSshBroker extends DurableObject<Env> {
  private busy = false;

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/check") return new Response(null, { status: 404 });
    if (this.busy) return new Response(null, { status: 409 });
    this.busy = true;
    try {
      const { tenantId, ownerId, authority, sessionVersion, serverId, version } = hetznerProbeRequest.parse(await request.json());
      const db = databaseFor(this.env), key = signingConfig(this.env).credentialKey;
      const hosts = new HetznerSshRepository(db, tenantId, key);
      const projects = new HetznerConnectionRepository(db, tenantId, key);
      const members = new IdentityRepository(db, tenantId);
      const host = await hosts.get(serverId);
      const project = await projects.get();
      if (!host || !project || host.version !== version || host.ownerId !== ownerId || host.connectionRevision !== project.revision) return new Response(null, { status: 404 });
      const valid = await freshHetznerProbe({
        enrolledAddress: host.address,
        lookup: () => createHetznerCloudClient().target(project.token, serverId),
        active: async () => {
          const [current, currentProject, member] = await Promise.all([hosts.get(serverId), projects.get(), members.member(ownerId)]);
          if (current?.version !== version || currentProject?.revision !== project.revision || member?.role !== "owner" || member.sessionVersion !== sessionVersion) return false;
          if (authority.type === "owner") return true;
          return (await activeHetznerScope(db.pool, { tenantId, userId: ownerId, sessionVersion,
            installationId: authority.installationId, grantId: authority.grantId, expiresAt: authority.expiresAt })) === authority.scope;
        },
        authenticate: signal => authenticateHetznerSsh(host, signal),
      });
      return valid ? Response.json({ serverId, authenticated: true, reusedConnection: false }) : new Response(null, { status: 404 });
    } catch {
      return new Response(null, { status: 502 });
    } finally {
      this.busy = false;
    }
  }
}
