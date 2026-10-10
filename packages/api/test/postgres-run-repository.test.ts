import { describe, expect, it, vi } from "vitest";
import { RunRepository } from "../src/postgres/run-repository";

describe("RunRepository", () => {
  it("records the first successful launch time without replacing creation time", async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 1 }));
    const database = { transaction: (work: any) => work({ query }) } as any;
    await new RunRepository(database).markLaunched({ tenantId: "tenant", id: "run" } as any, { backendKind: "exe" } as any, "https://example.com", []);
    const calls = query.mock.calls as unknown as [string, unknown[]][];
    expect(calls[0][0]).toContain("started_at=COALESCE(started_at,now())");
    expect(calls[0][1]).toEqual(["tenant", "run"]);
    expect(calls.every(([sql]) => !sql.includes("created_at="))).toBe(true);
  });

  it("persists the source declaration at launch and reads it independently of current driver defaults", async () => {
    const query = vi.fn(async (_sql: string, _values: unknown[]) => ({ rows: [], rowCount: 1 }));
    const repository = new RunRepository({ transaction: (work: any) => work({ query }), pool: { query } } as any);
    const sources = { primary: { kind: "execution_stream" as const, path: "/tmp/stream.jsonl", mediaType: "application/x-ndjson" as const, provider: "codex" as const, harnessVersion: "v1" } };
    await repository.markLaunched({ tenantId: "tenant", id: "run" } as any, { backendKind: "exe-vm", id: "factorize-run" }, "https://vm", [], sources);
    expect(query.mock.calls[1][0]).toContain("trace_sources=$7");
    expect(query.mock.calls[1][1][6]).toBe(JSON.stringify(sources));
    await repository.dueForPoll();
    expect(query.mock.calls.at(-1)![0]).toContain("x.trace_sources,x.execution_handle");
  });

  it("claims queue work with row locking and persisted concurrency", async () => {
    const query = vi.fn(async (sql: string) => ({ rows: sql.includes("WITH candidate") ? [] : [], rowCount: 0 }));
    const database = { transaction: (work: any) => work({ query }), pool: { query } } as any;
    await expect(new RunRepository(database).claimNext()).resolves.toBeNull();
    expect(query.mock.calls[0][0]).toContain("FOR UPDATE OF r SKIP LOCKED");
    expect(query.mock.calls[0][0]).toContain("concurrency_limit");
  });
});

describe("execution evidence persistence", () => {
  it("uses a tenant-qualified first-write-wins snapshot without persisting raw commands", async () => {
    const first = { state: "failed", detail: "exit 42", systemd: null };
    const query = vi.fn(async (_sql: string, _values: unknown[]) => ({ rows: [{ execution_diagnostics: first }] }));
    const repository = new RunRepository({ pool: { query } } as any);
    const result = await repository.recordObservation({ tenantId: "tenant", id: "run" } as any, {
      state: "failed", detail: "Bearer secret", command: { ok: false, status: 500, exitCode: 1, body: "raw response", requestBody: "raw command" },
    });
    expect(result).toEqual(first);
    expect(query.mock.calls[0]).toEqual([
      expect.stringContaining("execution_diagnostics=COALESCE(execution_diagnostics,$3::jsonb)"),
      ["tenant", "run", JSON.stringify({ state: "failed", detail: "[REDACTED]", systemd: null })],
    ]);
    expect(query.mock.calls[0][0]).toContain("WHERE tenant_id=$1 AND id=$2");
  });
});

it("recording an independent artifact cannot clear execution or collection errors", async () => {
  const { ArtifactRepository } = await import("../src/postgres/artifact-repository");
  const query = vi.fn(async (_sql: string, _values: unknown[]) => ({ rows: [] }));
  const repository = new ArtifactRepository({ transaction: (work: any) => work({ query }) } as any, "tenant");
  await repository.record({ runId: "run", kind: "terminal_log", objectKey: "log", provider: "codex", format: "text", byteSize: 1, sha256: "a".repeat(64) });
  const update = query.mock.calls.find(([sql]) => sql.startsWith("UPDATE app.runs"))![0];
  expect(update).not.toContain("artifact_error");
  expect(update).not.toContain("execution_diagnostics");
});
