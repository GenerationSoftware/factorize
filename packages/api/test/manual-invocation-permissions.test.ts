import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiService, ServiceError } from "../src/flow-service";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {} }));
afterEach(() => vi.restoreAllMocks());

describe("manual invocation permission management", () => {
  const tenantId = "00000000-0000-4000-8000-000000000001", sourceId = "00000000-0000-4000-8000-000000000002";
  const destinationId = "00000000-0000-4000-8000-000000000003", foreignId = "00000000-0000-4000-8000-000000000004";
  it("replaces and lists tenant-local permissions through the authorized service", async () => {
    const persisted: string[] = [], queries: unknown[][] = [];
    const query = async (sql: string, values: unknown[] = []) => {
      queries.push(values);
      if (sql.includes("SELECT 1 FROM app.jobs")) return { rows: values[1] === sourceId ? [{ ok: 1 }] : [], rowCount: values[1] === sourceId ? 1 : 0 };
      if (sql.includes("SELECT id FROM app.jobs")) return { rows: (values[1] as string[]).filter(id => id === destinationId).map(id => ({ id })), rowCount: (values[1] as string[]).filter(id => id === destinationId).length };
      if (sql.includes("DELETE FROM app.manual_invocation_permissions")) { persisted.length = 0; return { rows: [], rowCount: 1 }; }
      if (sql.includes("INSERT INTO app.manual_invocation_permissions")) { persisted.push(...values[2] as string[]); return { rows: [], rowCount: persisted.length }; }
      if (sql.includes("SELECT destination_job_id")) return { rows: persisted.map(destination_job_id => ({ destination_job_id })), rowCount: persisted.length };
      throw new Error(`Unexpected SQL: ${sql}`);
    };
    const database = { pool: { query }, transaction: async (work: (client: any) => Promise<unknown>) => work({ query }) } as any;
    const service = new ApiService({ DATABASE: database } as any, { tenantId, userId: "owner", sessionVersion: 1, scopes: ["jobs:read", "jobs:write"], authMethod: "session" });
    const ownerAuthorization = vi.spyOn(service as any, "authorizeOwnerSession").mockResolvedValue(undefined);
    vi.spyOn(service as any, "authorize").mockResolvedValue(undefined);
    vi.spyOn(service as any, "jobs").mockReturnValue({ getJob: async (id: string) => id === sourceId ? { id } : null });
    await expect(service.setInvocationPermissions(sourceId, [destinationId])).resolves.toEqual({ sourceJobId: sourceId, destinationJobIds: [destinationId] });
    await expect(service.getInvocationPermissions(sourceId)).resolves.toEqual({ sourceJobId: sourceId, destinationJobIds: [destinationId] });
    expect(queries.every(values => values[0] === tenantId)).toBe(true);
    expect(ownerAuthorization).toHaveBeenCalledWith("jobs:write");
  });

  it("rejects cross-tenant, duplicate, self, and missing source grants", async () => {
    const query = async (sql: string, values: unknown[] = []) => {
      if (sql.includes("SELECT 1 FROM app.jobs")) return { rows: values[1] === sourceId ? [{ ok: 1 }] : [], rowCount: values[1] === sourceId ? 1 : 0 };
      if (sql.includes("SELECT id FROM app.jobs")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    };
    const database = { pool: { query }, transaction: async (work: (client: any) => Promise<unknown>) => work({ query }) } as any;
    const service = new ApiService({ DATABASE: database } as any, { tenantId, userId: "owner", sessionVersion: 1, scopes: ["jobs:write"], authMethod: "session" });
    vi.spyOn(service as any, "authorizeOwnerSession").mockResolvedValue(undefined);
    await expect(service.setInvocationPermissions(sourceId, [foreignId])).rejects.toMatchObject({ status: 400 });
    await expect(service.setInvocationPermissions(sourceId, [destinationId, destinationId])).rejects.toBeInstanceOf(ServiceError);
    await expect(service.setInvocationPermissions(sourceId, [sourceId])).rejects.toBeInstanceOf(ServiceError);
    await expect(service.setInvocationPermissions(foreignId, [destinationId])).rejects.toMatchObject({ status: 404 });
  });
});
