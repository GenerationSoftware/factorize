import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiService, ServiceError } from "../src/flow-service";
import { protectedApiFetch } from "../src/protected-api";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {} }));
afterEach(() => vi.restoreAllMocks());

const tenantId = "00000000-0000-4000-8000-000000000001";
const sourceId = "00000000-0000-4000-8000-000000000002";
const destinationId = "00000000-0000-4000-8000-000000000003";
const foreignId = "00000000-0000-4000-8000-000000000004";

function fixture(options: { member?: boolean; activeToken?: boolean } = {}) {
  const persisted: string[] = [];
  const query = async (sql: string, values: unknown[] = []) => {
    if (sql.includes("SELECT m.user_id,m.email")) return { rows: options.member === false ? [] : [{ user_id: "owner", email: "owner@example.com", role: "owner", session_version: 1 }], rowCount: options.member === false ? 0 : 1 };
    if (sql.includes("SELECT 1 FROM app.access_tokens")) return { rows: options.activeToken === false ? [] : [{ ok: 1 }], rowCount: options.activeToken === false ? 0 : 1 };
    if (sql.includes("SELECT 1 FROM app.jobs")) return { rows: values[1] === sourceId ? [{ ok: 1 }] : [], rowCount: values[1] === sourceId ? 1 : 0 };
    if (sql.includes("SELECT id FROM app.jobs")) {
      const ids = (values[1] as string[]).filter(id => id === destinationId);
      return { rows: ids.map(id => ({ id })), rowCount: ids.length };
    }
    if (sql.includes("DELETE FROM app.manual_invocation_permissions")) { persisted.length = 0; return { rows: [], rowCount: 1 }; }
    if (sql.includes("INSERT INTO app.manual_invocation_permissions")) { persisted.push(...values[2] as string[]); return { rows: [], rowCount: persisted.length }; }
    if (sql.includes("SELECT destination_job_id")) return { rows: persisted.map(destination_job_id => ({ destination_job_id })), rowCount: persisted.length };
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  const database = { pool: { query }, transaction: async (work: (client: any) => Promise<unknown>) => work({ query }) } as any;
  const env = { APP_ORIGIN: "https://example.com", DATABASE: database } as any;
  return { env, database, persisted };
}

function auth(authMethod: "session" | "access_token" | "oauth" | "run_token", scopes = ["jobs:write"], accessTokenId?: string) {
  return { tenantId, userId: "owner", sessionVersion: 1, scopes, authMethod, accessTokenId } as any;
}

async function request(transport: "REST" | "MCP", credential: ReturnType<typeof auth> | null, scopes?: string[], destinationJobIds = [destinationId]) {
  const f = fixture();
  const rest = transport === "REST";
  const url = f.env.APP_ORIGIN + (rest ? `/api/v1/jobs/${sourceId}/invocation-permissions` : "/mcp");
  const body = { destinationJobIds };
  const payload = rest ? body : { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "set_job_invocation_permissions", arguments: { jobId: sourceId, ...body } } };
  const response = await protectedApiFetch(new Request(url, {
    method: rest ? "PUT" : "POST",
    headers: { Host: "example.com", Origin: f.env.APP_ORIGIN, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify(payload),
  }), f.env, credential ? { ...credential, ...(scopes ? { scopes } : {}) } : null, {} as any);
  return { response, f };
}

async function mcpMessage(response: Response) {
  const text = await response.text();
  return JSON.parse(text.startsWith("event:") ? text.split("\n").find(line => line.startsWith("data:"))!.slice(5) : text);
}

describe("manual invocation permission management", () => {
  it.each(["session", "access_token", "oauth"] as const)("accepts %s credentials at the REST route and MCP tool", async method => {
    for (const transport of ["REST", "MCP"] as const) {
      const { response, f } = await request(transport, auth(method, ["jobs:write"], method === "access_token" ? "token-id" : undefined));
      expect(response.status).toBe(200);
      if (transport === "REST") expect(await response.json()).toEqual({ sourceJobId: sourceId, destinationJobIds: [destinationId] });
      else expect((await mcpMessage(response)).result.structuredContent).toEqual({ sourceJobId: sourceId, destinationJobIds: [destinationId] });
      expect(f.persisted).toEqual([destinationId]);
    }
  });

  it.each(["session", "access_token", "oauth"] as const)("authorizes %s at the service and preserves tenant-local destination checks", async method => {
    const f = fixture();
    const service = new ApiService(f.env, auth(method, ["jobs:write"], method === "access_token" ? "token-id" : undefined));
    await expect(service.setInvocationPermissions(sourceId, [destinationId])).resolves.toEqual({ sourceJobId: sourceId, destinationJobIds: [destinationId] });
    expect(f.persisted).toEqual([destinationId]);
    await expect(service.setInvocationPermissions(sourceId, [foreignId])).rejects.toMatchObject({ status: 400, code: "invalid_request" });
  });

  it("rejects missing scopes, missing credentials, invalid or revoked owner credentials, and run tokens", async () => {
    for (const transport of ["REST", "MCP"] as const) {
      const noScope = await request(transport, auth("oauth", ["jobs:read"]));
      if (transport === "REST") {
        expect(noScope.response.status).toBe(403);
        expect((await noScope.response.json() as any).error.code).toBe("insufficient_scope");
      } else expect((await mcpMessage(noScope.response)).result.isError).toBe(true);
      const missing = await request(transport, null);
      if (transport === "REST") expect(missing.response.status).toBe(401);
      else expect(missing.response.status).toBe(401);
    }

    for (const transport of ["REST", "MCP"] as const) {
      const foreign = await request(transport, auth("session"), undefined, [foreignId]);
      if (transport === "REST") {
        expect(foreign.response.status).toBe(400);
        expect((await foreign.response.json() as any).error.code).toBe("invalid_request");
      } else expect((await mcpMessage(foreign.response)).result.isError).toBe(true);
    }

    for (const [options, credential] of [
      [{ member: false }, auth("oauth")],
      [{ activeToken: false }, auth("access_token", ["jobs:write"], "revoked-token")],
    ] as const) {
      const f = fixture(options);
      await expect(new ApiService(f.env, credential).setInvocationPermissions(sourceId, [destinationId]))
        .rejects.toMatchObject({ status: 401, code: "invalid_token" });
    }

    const f = fixture();
    await expect(new ApiService(f.env, auth("run_token", ["jobs:write"])).setInvocationPermissions(sourceId, [destinationId]))
      .rejects.toBeInstanceOf(ServiceError);
    await expect(new ApiService(f.env, auth("session", ["jobs:write"])).setInvocationPermissions(foreignId, [destinationId]))
      .rejects.toMatchObject({ status: 404, code: "not_found" });
  });

  it("keeps the API route's browser origin check for owner sessions", async () => {
    const f = fixture();
    const response = await protectedApiFetch(new Request(`${f.env.APP_ORIGIN}/api/v1/jobs/${sourceId}/invocation-permissions`, {
      method: "PUT", headers: { Host: "example.com", Origin: "https://attacker.example", "Content-Type": "application/json" },
      body: JSON.stringify({ destinationJobIds: [destinationId] }),
    }), f.env, auth("session"), {} as any);
    expect(response.status).toBe(403);
    expect((await response.json() as any).error.code).toBe("invalid_origin");
    expect(f.persisted).toEqual([]);
  });
});
