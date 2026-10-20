import { afterEach, describe, expect, it, vi } from "vitest";
import { IntegrationService } from "../src/postgres/integration-service";
import type { Database } from "../src/postgres/database";

afterEach(() => vi.unstubAllGlobals());

describe("saving exe integrations", () => {
  it.each([
    [401, "exe.dev rejected the account token"],
    [403, "integrations list, new, ssh, rm"],
    [503, "credential verification failed for ls --json (HTTP 503)"],
  ])("explains failed permission checks (HTTP %s) without saving", async (status, message) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("private upstream output", { status: Number(status) })));
    const service = new IntegrationService({} as Database, "tenant", "key");
    const save = vi.spyOn(service.connections, "put");
    await expect(service.saveExe({ apiToken: "test", agentKind: "codex", tags: [] })).rejects.toThrow(String(message));
    expect(save).not.toHaveBeenCalled();
  });
});
