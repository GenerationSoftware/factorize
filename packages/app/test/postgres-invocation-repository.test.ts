import { describe, expect, it, vi } from "vitest";
import { InvocationRepository } from "../src/postgres/invocation-repository";
import type { Database } from "../src/postgres/database";
import type { Invocation, JobRun } from "../src/job-domain";

const tenantId = "10000000-0000-4000-8000-000000000001";
const invocation: Invocation = { id: "20000000-0000-4000-8000-000000000001", jobId: "30000000-0000-4000-8000-000000000001", source: "manual", claimKey: "manual:one", triggerId: "40000000-0000-4000-8000-000000000001", context: { value: 1 }, createdAt: "2026-09-18T00:00:00.000Z" };
const run: JobRun = { id: "50000000-0000-4000-8000-000000000001", jobId: invocation.jobId, invocationId: invocation.id, state: "queued", encryptedPrompt: "ciphertext", createdAt: invocation.createdAt, updatedAt: invocation.createdAt };
const row = { invocation_id: invocation.id, job_id: invocation.jobId, source: invocation.source, claim_key: invocation.claimKey, trigger_id: invocation.triggerId, context: invocation.context, occurrence: null, invocation_created_at: new Date(invocation.createdAt), run_id: run.id, run_state: run.state, encrypted_prompt: run.encryptedPrompt, run_name: "", run_created_at: new Date(run.createdAt), run_updated_at: new Date(run.updatedAt), started_at: null };

describe("InvocationRepository", () => {
  it("creates invocation, run, and wake hint in one transaction", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ id: invocation.id }], rowCount: 1 }).mockResolvedValueOnce({ rows: [], rowCount: 1 }).mockResolvedValueOnce({ rows: [], rowCount: 1 }).mockResolvedValueOnce({ rows: [row], rowCount: 1 });
    const database = { pool: {}, transaction: (work: (client: { query: typeof query }) => unknown) => work({ query }) } as unknown as Database;
    const result = await new InvocationRepository(database, tenantId).create(invocation, run);
    expect(result.duplicate).toBe(false);
    expect(query).toHaveBeenCalledTimes(4);
    expect(query.mock.calls[0][1][0]).toBe(tenantId);
    expect(query.mock.calls[2][0]).toContain("app.wake_hints");
    expect(query.mock.calls[3][1]).toEqual([tenantId, invocation.jobId, invocation.claimKey]);
  });

  it("returns the canonical winner without creating a second run", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [], rowCount: 0 }).mockResolvedValueOnce({ rows: [row], rowCount: 1 });
    const database = { pool: {}, transaction: (work: (client: { query: typeof query }) => unknown) => work({ query }) } as unknown as Database;
    const result = await new InvocationRepository(database, tenantId).create(invocation, run);
    expect(result.duplicate).toBe(true);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("rejects construction without tenant scope", () => {
    expect(() => new InvocationRepository({} as Database, "")).toThrow("tenantId is required");
  });
});
