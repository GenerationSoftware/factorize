import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiService } from "../src/flow-service";
import { IdentityRepository } from "../src/postgres/identity-repository";
import { RunQueryRepository } from "../src/postgres/run-query-repository";
import { ArtifactRepository } from "../src/postgres/artifact-repository";
import { ConnectionRepository } from "../src/postgres/connection-repository";
import { IntegrationService } from "../src/postgres/integration-service";
import { encrypt } from "../src/crypto";

const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
afterEach(() => vi.restoreAllMocks());
describe("independent loading", () => {
  it("starts all run metadata reads before any of them completes", async () => {
    const activity = deferred<any[]>(), artifacts = deferred<any[]>(), projection = deferred<any>(), cursor = deferred<any>();
    const key = btoa("a".repeat(32)), encrypted_prompt = await encrypt("prompt", key);
    vi.spyOn(IdentityRepository.prototype, "member").mockResolvedValue({ userId: "u", email: "u@example.test", role: "owner", sessionVersion: 1 });
    vi.spyOn(RunQueryRepository.prototype, "get").mockResolvedValue({ id: "run", tenant_id: "t", job_id: "job", invocation_id: "invocation", issue_id: "manual", issue_url: null, issue_title: "", run_name: "", agent_name: "", workspace_name: "", agent_kind: "codex", state: "queued", provider: "manual", execution_backend_kind: "exe-vm", execution_capabilities: [], destination_url: null, artifact_state: "pending", artifact_error: null, claim_released: false, vm_cleanup_attempt: 0, cleanup_next_at: null, vm_cleanup_complete: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), started_at: null, context: {}, occurrence: null, invocation_source: "manual", invocation_claim_key: "key", invocation_trigger_id: null, invocation_created_at: new Date().toISOString(), encrypted_prompt, job_name: "Job" });
    const activitySpy = vi.spyOn(RunQueryRepository.prototype, "activity").mockReturnValue(activity.promise);
    const artifactsSpy = vi.spyOn(ArtifactRepository.prototype, "list").mockReturnValue(artifacts.promise);
    const query = vi.fn((sql: string) => sql.includes("projections") ? projection.promise : cursor.promise);
    const service = new ApiService({ DATABASE: { pool: { query } }, CREDENTIAL_ENCRYPTION_KEY: key } as any, { tenantId: "t", userId: "u", sessionVersion: 1, scopes: ["runs:read"] } as any);
    const result = service.getRun("run");
    await vi.waitFor(() => { expect(activitySpy).toHaveBeenCalled(); expect(artifactsSpy).toHaveBeenCalled(); expect(query).toHaveBeenCalledTimes(2); });
    activity.resolve([]); artifacts.resolve([]); projection.resolve({ rows: [] }); cursor.resolve({ rows: [] });
    expect(await result).toMatchObject({ prompt: "prompt", job_name: "Job", activity: [], trace_generation: null, trace_projection: null, harness_log: null });
  });
  it("starts integration counts while encrypted connections are still loading", async () => {
    const connections = deferred<Map<string, any>>(), counts = deferred<any>();
    const all = vi.spyOn(ConnectionRepository.prototype, "all").mockReturnValue(connections.promise), query = vi.fn(() => counts.promise);
    const result = new IntegrationService({ pool: { query } } as any, "tenant", "key").status();
    expect(all).toHaveBeenCalledTimes(1); expect(query).toHaveBeenCalledTimes(1);
    connections.resolve(new Map()); counts.resolve({ rows: [] });
    expect(await result).toMatchObject({ exeConnections: [], ampConnections: [], cloudflareTail: { count: 0, installations: [] } });
  });
  it("propagates a failed integration read without leaving an unhandled sibling promise", async () => {
    vi.spyOn(ConnectionRepository.prototype, "all").mockRejectedValue(new Error("Connection read failed"));
    const query = vi.fn(async () => ({ rows: [] }));
    await expect(new IntegrationService({ pool: { query } } as any, "tenant", "key").status()).rejects.toThrow("Connection read failed");
  });

});
