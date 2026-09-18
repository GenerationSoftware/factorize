import { Pool, type PoolClient, type PoolConfig, type QueryResultRow } from "pg";

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
