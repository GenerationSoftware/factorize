import { Pool, type PoolClient, type PoolConfig, type QueryResultRow } from "pg";
import type { Env } from "../types";

export interface DatabaseClient {
  query<Row extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<{ rows: Row[]; rowCount: number | null }>;
}

export class Database {
  readonly pool: Pool;

  constructor(config: PoolConfig) {
    // Workers may reuse an isolate, but sockets opened for one request cannot be
    // safely retained by node-postgres for a later request. Hyperdrive makes a
    // fresh connection inexpensive, so retire every checkout on release.
    this.pool = new Pool({ max: 5, maxUses: 1, allowExitOnIdle: true, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 1_000, ...config });
  }

  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> { await this.pool.end(); }
}

/**
 * Create a request-local pool connected through Hyperdrive.
 *
 * Cloudflare Workers may reuse an isolate, but network objects created while
 * handling one request cannot be used by another request. Keeping a Pool in
 * module state lets concurrent requests exchange clients through the pool's
 * waiter queue even when every checked-out client has maxUses=1.
 */
export function databaseFor(env: Env): Database {
  if (env.DATABASE) return env.DATABASE;
  if (!env.HYPERDRIVE?.connectionString) throw new Error("PostgreSQL Hyperdrive is not configured");
  return new Database({ connectionString: env.HYPERDRIVE.connectionString });
}

export function resetDatabaseForTests(): void { /* Production databases are not cached. */ }
