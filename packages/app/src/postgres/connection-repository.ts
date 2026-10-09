import { decrypt, encrypt } from "../crypto";
import type { Database } from "./database";
import { and, eq, like, or } from "drizzle-orm";
import { connections } from "./schema";

export class ConnectionRepository {
  constructor(private database: Database, private tenantId: string, private encryptionKey: string) {
    if (!tenantId) throw new Error("tenantId is required");
  }
  async get<T>(kind: string): Promise<T | null> {
    const row = (await this.database.orm.select({ encryptedValue: connections.encryptedValue }).from(connections).where(and(eq(connections.tenantId, this.tenantId), eq(connections.kind, kind))).limit(1))[0];
    if (!row) return null;
    return JSON.parse(await decrypt(row.encryptedValue, this.encryptionKey)) as T;
  }
  async all(kinds: readonly string[] = []): Promise<Map<string, any>> {
    const rows = await this.database.orm.select().from(connections).where(and(eq(connections.tenantId, this.tenantId), kinds.length ? or(...kinds.map(kind => kind.endsWith(":") ? like(connections.kind, `${kind}%`) : eq(connections.kind, kind))) : undefined)).orderBy(connections.kind);
    return new Map(await Promise.all(rows.map(async row => [row.kind, JSON.parse(await decrypt(row.encryptedValue, this.encryptionKey))] as const)));
  }
  async put(kind: string, value: unknown): Promise<void> {
    const encrypted = await encrypt(JSON.stringify(value), this.encryptionKey);
    await this.database.orm.insert(connections).values({ tenantId: this.tenantId, kind, encryptedValue: encrypted }).onConflictDoUpdate({ target: [connections.tenantId, connections.kind], set: { encryptedValue: encrypted, updatedAt: new Date() } });
  }
  async putLinear(organizationId: string, value: unknown): Promise<boolean> {
    const encrypted = await encrypt(JSON.stringify(value), this.encryptionKey);
    try {
      await this.database.transaction(async client => {
        await client.query("DELETE FROM app.linear_workspaces WHERE tenant_id=$1 AND organization_id<>$2", [this.tenantId, organizationId]);
        const result = await client.query("INSERT INTO app.linear_workspaces(organization_id,tenant_id) VALUES ($1,$2) ON CONFLICT (organization_id) DO UPDATE SET tenant_id=excluded.tenant_id WHERE app.linear_workspaces.tenant_id=excluded.tenant_id RETURNING tenant_id", [organizationId, this.tenantId]);
        if (!result.rows.length) throw new Error("linear_workspace_claimed");
        await client.query("INSERT INTO app.connections(tenant_id,kind,encrypted_value) VALUES ($1,'linear',$2) ON CONFLICT (tenant_id,kind) DO UPDATE SET encrypted_value=excluded.encrypted_value,updated_at=now()", [this.tenantId, encrypted]);
      });
      return true;
    } catch (error) {
      if (error instanceof Error && error.message === "linear_workspace_claimed") return false;
      throw error;
    }
  }
  async delete(kind: string): Promise<boolean> { return Boolean((await this.database.orm.delete(connections).where(and(eq(connections.tenantId, this.tenantId), eq(connections.kind, kind))).returning({ kind: connections.kind })).length); }
  async kinds(prefix?: string): Promise<string[]> {
    const rows = await this.database.orm.select({ kind: connections.kind }).from(connections).where(and(eq(connections.tenantId, this.tenantId), ...(prefix ? [like(connections.kind, `${prefix}%`)] : []))).orderBy(connections.kind);
    return rows.map(row => row.kind);
  }
}
