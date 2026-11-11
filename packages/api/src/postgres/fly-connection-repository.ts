import { decrypt, encrypt } from "../crypto";
import type { Database } from "./database";

export type FlyConnection = { organizationSlug: string; organizationName: string };

/** Stores one org-scoped provisioning token per tenant, encrypted with the server credential key. */
export class FlyConnectionRepository {
  constructor(private database: Database, private tenantId: string, private serverEncryptionKey: string) {
    if (!tenantId) throw new Error("tenantId is required");
  }

  async get(): Promise<FlyConnection | null> {
    const { rows } = await this.database.pool.query<{ organization_slug: string; organization_name: string }>(
      "SELECT organization_slug,organization_name FROM app.fly_connections WHERE tenant_id=$1", [this.tenantId]);
    return rows[0] ? { organizationSlug: rows[0].organization_slug, organizationName: rows[0].organization_name } : null;
  }

  async save(connection: FlyConnection, token: string): Promise<FlyConnection> {
    const encryptedToken = await encrypt(token, this.serverEncryptionKey);
    const { rows } = await this.database.pool.query<{ organization_slug: string; organization_name: string }>(
      `INSERT INTO app.fly_connections(tenant_id,organization_slug,organization_name,encrypted_token)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (tenant_id) DO UPDATE SET organization_slug=excluded.organization_slug,organization_name=excluded.organization_name,encrypted_token=excluded.encrypted_token,updated_at=now()
       RETURNING organization_slug,organization_name`,
      [this.tenantId, connection.organizationSlug, connection.organizationName, encryptedToken]);
    return { organizationSlug: rows[0]!.organization_slug, organizationName: rows[0]!.organization_name };
  }

  async token(): Promise<string | null> {
    const { rows } = await this.database.pool.query<{ encrypted_token: string }>("SELECT encrypted_token FROM app.fly_connections WHERE tenant_id=$1", [this.tenantId]);
    return rows[0] ? decrypt(rows[0].encrypted_token, this.serverEncryptionKey) : null;
  }

  async remove(): Promise<boolean> {
    const result = await this.database.pool.query("DELETE FROM app.fly_connections WHERE tenant_id=$1", [this.tenantId]);
    return (result.rowCount ?? 0) > 0;
  }
}
