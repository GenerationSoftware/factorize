import { decrypt, encrypt } from "../crypto";
import type { Database } from "./database";
import { and, eq, like } from "drizzle-orm";
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
  async put(kind: string, value: unknown): Promise<void> {
    const encrypted = await encrypt(JSON.stringify(value), this.encryptionKey);
    await this.database.orm.insert(connections).values({ tenantId: this.tenantId, kind, encryptedValue: encrypted }).onConflictDoUpdate({ target: [connections.tenantId, connections.kind], set: { encryptedValue: encrypted, updatedAt: new Date() } });
  }
  async delete(kind: string): Promise<boolean> { return Boolean((await this.database.orm.delete(connections).where(and(eq(connections.tenantId, this.tenantId), eq(connections.kind, kind))).returning({ kind: connections.kind })).length); }
  async kinds(prefix?: string): Promise<string[]> {
    const rows = await this.database.orm.select({ kind: connections.kind }).from(connections).where(and(eq(connections.tenantId, this.tenantId), ...(prefix ? [like(connections.kind, `${prefix}%`)] : []))).orderBy(connections.kind);
    return rows.map(row => row.kind);
  }
}
