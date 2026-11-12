import { describe, expect, it } from "vitest";
import { RunRepository } from "../src/postgres/run-repository";

describe("durable proxy-gated launch retry", () => {
  it("persists a blocked pre-launch run without polling it as a live execution", async () => {
    const statements: string[] = [];
    const client = { query: async (sql: string) => { statements.push(sql); return { rowCount: 1, rows: [{ id: "run" }] }; } };
    const database = { transaction: async <T>(fn: (client: any) => Promise<T>) => fn(client), pool: { query: client.query } };
    await new RunRepository(database as any).blockLaunch({ tenantId: "tenant", id: "run" } as any, "proxy_locked");
    expect(statements.some(sql => sql.includes("state='blocked'") && sql.includes("launch_lease_expires_at=NULL"))).toBe(true);
    expect(statements.some(sql => sql.includes("execution_handle IS NULL"))).toBe(true);
    expect(statements.some(sql => sql.includes("'launch_blocked'"))).toBe(true);
  });

  it("only manually requeues a proxy-gated run that has no execution handle", async () => {
    const statements: string[] = [];
    const client = { query: async (sql: string) => { statements.push(sql); return { rowCount: 1, rows: [{ id: "run" }] }; } };
    const database = { transaction: async <T>(fn: (client: any) => Promise<T>) => fn(client), pool: { query: client.query } };
    expect(await new RunRepository(database as any).retryBlockedLaunch("tenant", "run")).toBe(true);
    expect(statements.some(sql => sql.includes("state='blocked'") && sql.includes("failure_code='proxy_launch_blocked'") && sql.includes("execution_handle IS NULL"))).toBe(true);
    expect(statements.some(sql => sql.includes("state='reserved'"))).toBe(true);
    expect(statements.some(sql => sql.includes("'launch_retry_requested'"))).toBe(true);
    expect(statements.some(sql => sql.includes("wake_hints"))).toBe(true);
  });
});
