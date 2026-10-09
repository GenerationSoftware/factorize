import { describe, expect, it } from "vitest";
import { executionTargetResponse, triggerAvailabilityResponse, namedOption, providerOptions, githubInstallation, githubRepository, tailIntegration } from "../src/editor-contracts";
import { jobResponse } from "../src/job-contracts";
import { generateOpenApi } from "../src/api-contract";
describe("public editor contracts", () => {
  it("describes required target metadata and provider resources without credential fields", () => {
    const target = { id: "vm", kind: "exe-vm", name: "VM", workspace: "ephemeral", cwd: "/workspace", agentKind: "codex", models: ["model"], modelsRefreshedAt: null, efforts: ["high"], capabilities: ["stop"] };
    expect(executionTargetResponse.parse({ ...target, apiToken: "private" })).toEqual(target);
    expect(executionTargetResponse.safeParse({ ...target, models: [42] }).success).toBe(false);
    expect(triggerAvailabilityResponse.parse({ manual: true, schedule: true, jobLifecycle: true, linear: false, clickup: false, github: false, cloudflareTail: false }).linear).toBe(false);
    expect(namedOption.parse({ id: "option", name: "Name", secret: "private" })).toEqual({ id: "option", name: "Name" });
    expect(providerOptions.safeParse({ statuses: [], users: [], labels: [] }).success).toBe(true);
    expect(githubInstallation.safeParse({ installationId: 1, accountLogin: "owner", accountType: "Organization", state: "active", updatedAt: new Date().toISOString() }).success).toBe(true);
    expect(githubRepository.safeParse({ id: 1, name: "repo", fullName: "owner/repo", owner: "owner", private: true, defaultBranch: "main" }).success).toBe(true);
    expect(tailIntegration.safeParse({ integrationId: "tail", name: "Tail", status: "connected", secretConfigured: true, referencedJobCount: 0, createdAt: "now", updatedAt: "now" }).success).toBe(true);
  });
  it("publishes concrete create and editor resource schemas in the executable contract", () => {
    const document = generateOpenApi() as any;
    for (const path of ["/api/v1/execution-targets", "/api/v1/job-trigger-availability", "/api/v1/providers/linear/projects", "/api/v1/providers/linear/options", "/api/v1/providers/clickup/lists", "/api/v1/providers/clickup/options", "/api/v1/providers/github/installations", "/api/v1/integrations/cloudflare-tail"]) {
      const schema = document.paths[path].get.responses[200].content["application/json"].schema;
      expect(schema.type === "array" ? schema.items.required.length : schema.required.length).toBeGreaterThan(0);
    }
    const schema = document.paths["/api/v1/jobs"].post.responses[201].content["application/json"].schema;
    expect(schema.required).toContain("updatedAt"); expect(schema.required).toContain("triggers");
    expect(jobResponse.safeParse({ id: "not-a-job" }).success).toBe(false);
  });
});
