import type { DatabaseClient } from "../../postgres/database";
import { ServiceError } from "../../service-contract";
import type { HetznerCreateInput } from "../api/hetzner-contracts";

type RequestRow = { project_revision: string; ticket: string; name: string; server_type: string; location: string; server_id: string | null };

export class HetznerServerRequests {
  constructor(private tenantId: string, private ownerId: string) {}
  private get owner() { return [this.tenantId, this.ownerId]; }

  /** Call while holding the integration topology transaction lock. */
  async reserve(sql: DatabaseClient, installationId: string, revision: string, input: HetznerCreateInput) {
    const [state] = (await sql.query<RequestRow>(
      "SELECT project_revision,ticket,name,server_type,location,server_id FROM app.hetzner_server_requests WHERE tenant_id=$1 AND owner_id=$2 AND installation_id=$3 AND request_id=$4",
      [...this.owner, installationId, input.requestId],
    )).rows;
    if (state) {
      if (state.project_revision !== revision || state.name !== input.name || state.server_type !== input.serverType || state.location !== input.location) {
        throw new ServiceError(409, "hetzner_request_conflict", "This request ID was already used with other settings.");
      }
      return { ticket: state.ticket, serverId: state.server_id === null ? null : Number(state.server_id), dispatch: false };
    }
    const counts = (await sql.query<{total: number; daily: number}>(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE created_at>now()-interval '24 hours')::int AS daily
       FROM app.hetzner_server_requests WHERE tenant_id=$1 AND project_revision=$2`, [this.tenantId, revision],
    )).rows[0]!;
    if (counts.total >= 20 || counts.daily >= 3) {
      throw new ServiceError(429, "hetzner_create_limit", "This connection has reached its bounded Factorize provisioning limit.");
    }
    const ticket = crypto.randomUUID();
    const result = await sql.query(
      `INSERT INTO app.hetzner_server_requests(tenant_id,owner_id,installation_id,request_id,project_revision,ticket,name,server_type,location)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (tenant_id,project_revision,name) DO NOTHING`,
      [...this.owner, installationId, input.requestId, revision, ticket, input.name, input.serverType, input.location],
    );
    if (!result.rowCount) throw new ServiceError(409, "hetzner_name_reserved", "This project already has a Factorize request for that name.");
    return { ticket, serverId: null, dispatch: true };
  }

  async complete(sql: DatabaseClient, ticket: string, serverId: number) {
    await sql.query("UPDATE app.hetzner_server_requests SET server_id=$4 WHERE tenant_id=$1 AND owner_id=$2 AND ticket=$3 AND (server_id IS NULL OR server_id=$4)",
      [...this.owner, ticket, serverId]);
  }

  async installation(sql: DatabaseClient, revision: string, serverId: number) {
    return (await sql.query<{installation_id: string}>(
      "SELECT installation_id FROM app.hetzner_server_requests WHERE tenant_id=$1 AND owner_id=$2 AND project_revision=$3 AND server_id=$4",
      [...this.owner, revision, serverId],
    )).rows[0]?.installation_id ?? null;
  }
}
