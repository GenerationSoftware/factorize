import type { Database } from "../../postgres/database";
import type { AwsRegion } from "../providers/aws/policy";

export type AwsConnection = {
  id: string; name: string; region: AwsRegion; roleArn: string | null;
  oauthInstallationId: string | null; revision: number;
};

const fields = 'id,name,region,role_arn AS "roleArn",oauth_installation_id AS "oauthInstallationId",revision';

export class AwsConnections {
  private owner: [string, string];
  constructor(private db: Database, tenantId: string, userId: string) { this.owner = [tenantId, userId]; }
  private scope = "tenant_id=$1 AND user_id=$2";
  async list() {
    return (await this.db.pool.query<AwsConnection>(`SELECT ${fields} FROM app.aws_connections WHERE ${this.scope} ORDER BY created_at DESC, id`, this.owner)).rows;
  }
  async get(id: string) {
    return (await this.db.pool.query<AwsConnection>(`SELECT ${fields} FROM app.aws_connections WHERE ${this.scope} AND id=$3`, [...this.owner,id])).rows[0];
  }
  async getForGrant(id: string, installation: string, grant: string, sessionVersion: number) {
    return (await this.db.pool.query<AwsConnection>(`SELECT ${fields} FROM app.aws_connections WHERE ${this.scope} AND id=$3
      AND oauth_installation_id=$4 AND role_arn IS NOT NULL AND EXISTS (
        SELECT 1 FROM app.oauth_installations i WHERE i.tenant_id=$1 AND i.user_id=$2 AND i.id=$4 AND i.active_grant_id=$5
        AND i.active_session_version=$6 AND i.revoked_at IS NULL AND (i.active_expires_at IS NULL OR i.active_expires_at>now())
      )`, [...this.owner,id,installation,grant,sessionVersion])).rows[0];
  }
  async create(name: string, region: AwsRegion) {
    return (await this.db.pool.query<AwsConnection>(`INSERT INTO app.aws_connections(tenant_id,user_id,id,name,region) VALUES($1,$2,$3,$4,$5) RETURNING ${fields}`, [...this.owner,crypto.randomUUID(),name,region])).rows[0]!;
  }
  async activate(id: string, revision: number, arn: string) {
    return (await this.db.pool.query<AwsConnection>(`UPDATE app.aws_connections SET role_arn=$5,revision=revision+1
      WHERE ${this.scope} AND id=$3 AND revision=$4 AND (role_arn IS NULL OR role_arn=$5) RETURNING ${fields}`, [...this.owner,id,revision,arn])).rows[0];
  }
  async allow(id: string, revision: number, installation: string | null, sessionVersion: number) {
    return (await this.db.pool.query<AwsConnection>(`UPDATE app.aws_connections SET oauth_installation_id=$5,revision=revision+1
      WHERE ${this.scope} AND id=$3 AND revision=$4 AND role_arn IS NOT NULL AND (
        $5::text IS NULL OR EXISTS (SELECT 1 FROM app.oauth_installations i WHERE i.tenant_id=$1 AND i.user_id=$2 AND i.id=$5
          AND i.revoked_at IS NULL AND i.active_grant_id IS NOT NULL AND i.active_session_version=$6
          AND (i.active_expires_at IS NULL OR i.active_expires_at>now()))
      ) RETURNING ${fields}`, [...this.owner,id,revision,installation,sessionVersion])).rows[0];
  }
  async remove(id: string) {
    return (await this.db.pool.query(`DELETE FROM app.aws_connections WHERE ${this.scope} AND id=$3`, [...this.owner,id])).rowCount === 1;
  }
}
