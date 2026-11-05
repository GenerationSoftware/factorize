import { describe, expect, it } from "vitest";
import { authenticateRunCredential, issueRunCredential, RUN_SCOPES } from "../src/run-credentials";

describe("run-scoped execution credentials", () => {
  it("binds a short-lived bearer credential to its active tenant, job, and run", async () => {
    let storedDigest = "", active = true;
    const database = { pool: { query: async (sql: string, values: unknown[] = []) => {
      if (sql.includes("SELECT user_id,session_version")) return { rows: [{ user_id: "owner-1", session_version: 7 }], rowCount: 1 };
      if (sql.includes("INSERT INTO app.run_credentials")) { storedDigest = String(values[2]); return { rows: [], rowCount: 1 }; }
      if (sql.includes("FROM app.run_credentials c")) return active && values[1] === storedDigest ? { rows: [{ tenant_id: "tenant-1", user_id: "owner-1", session_version: 7, job_id: "job-1" }], rowCount: 1 } : { rows: [], rowCount: 0 };
      throw new Error(`Unexpected SQL: ${sql}`);
    } } } as any;
    const env = { DATABASE: database } as any;
    const token = await issueRunCredential(env, "tenant-1", "00000000-0000-4000-8000-000000000001");
    const request = (credential: string) => new Request("https://example.test/api/v1", { headers: { Authorization: `Bearer ${credential}` } });
    const auth = await authenticateRunCredential(request(token), env);
    expect(auth).toMatchObject({ tenantId: "tenant-1", userId: "owner-1", scopes: RUN_SCOPES, authMethod: "run_token", runJobId: "job-1", runId: "00000000-0000-4000-8000-000000000001" });
    expect(auth?.scopes).toContain("runs:read");
    expect(auth?.scopes.some(scope => scope.endsWith(":write") || scope === "runs:cancel")).toBe(false);
    expect(auth?.runCredentialDigest).toBe(storedDigest);
    expect(await authenticateRunCredential(request(token + "forged"), env)).toBeNull();
    active = false;
    expect(await authenticateRunCredential(request(token), env)).toBeNull();
  });
});
