import { Pool, type PoolClient, type PoolConfig, type QueryResultRow } from "pg";
import type { Env } from "../types";

export interface DatabaseClient {
  query<Row extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<{ rows: Row[]; rowCount: number | null }>;
}

export class Database {
  readonly pool: Pool;

  constructor(config: PoolConfig) {
    this.pool = new Pool({ max: 5, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000, ...config });
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

let shared: Database | undefined;

/** One small pool per Worker isolate, connected through Hyperdrive. */
export function databaseFor(env: Env): Database {
  if (env.DATABASE) return env.DATABASE;
  if (!env.HYPERDRIVE?.connectionString) throw new Error("PostgreSQL Hyperdrive is not configured");
  return shared ??= new Database({ connectionString: env.HYPERDRIVE.connectionString });
}

export function resetDatabaseForTests(): void { shared = undefined; }
