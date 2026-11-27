import type { DatabaseClient } from "../../postgres/database";

// Preserve the exact key binding for servers created by the retired typed workflow.
export class HetznerServerRequests {
  constructor(private tenantId: string, private ownerId: string) {}
  private get owner() { return [this.tenantId, this.ownerId]; }
  async installation(sql: DatabaseClient, revision: string, serverId: number) {
    return (await sql.query<{installation_id: string}>(
      "SELECT installation_id FROM app.hetzner_server_requests WHERE tenant_id=$1 AND owner_id=$2 AND project_revision=$3 AND server_id=$4",
      [...this.owner, revision, serverId],
    )).rows[0]?.installation_id ?? null;
  }
}
