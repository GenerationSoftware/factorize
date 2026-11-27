import { DurableObject } from "cloudflare:workers";
import type { Env } from "../../config/bindings";
import { signingConfig } from "../../config/runtime";
import { HetznerConnectionRepository } from "../../credentials/storage/hetzner-connection-repository";
import { HetznerSshRepository } from "../../credentials/storage/hetzner-ssh-repository";
import { databaseFor } from "../../postgres/database";
import { isPublicAddress } from "../../proxy/transport/public-address";
import { hetznerProbeRequest } from "../application/hetzner-ssh";
import { HetznerSshPool } from "../application/hetzner-ssh-pool";
import { connectHetznerSsh } from "./hetzner-ssh-transport";

/** Internal-only binding. The Worker authenticates and checks the caller's grant. */
export class HetznerSshBroker extends DurableObject<Env> {
  private readonly pool = new HetznerSshPool();

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/check") return new Response(null, { status: 404 });
    try {
      const { tenantId, ownerId, principal, serverId, version } = hetznerProbeRequest.parse(await request.json());
      const db = databaseFor(this.env), key = signingConfig(this.env).credentialKey;
      const host = await new HetznerSshRepository(db, tenantId, key).get(serverId);
      const project = await new HetznerConnectionRepository(db, tenantId, key).get();
      if (!host || !project || host.version !== version || host.ownerId !== ownerId || host.connectionRevision !== project.revision
        || (principal !== "owner" && principal !== host.clientInstallationId) || !isPublicAddress(host.address)) {
        this.pool.close();
        return new Response(null, { status: 404 });
      }
      const result = await this.pool.check(version, closed => connectHetznerSsh(host, closed));
      if ("busy" in result) return new Response(null, { status: 409 });
      return Response.json({ serverId, authenticated: true, reusedConnection: result.reusedConnection });
    } catch {
      this.pool.close();
      return new Response(null, { status: 502 });
    }
  }
}
