import { describe, expect, it } from "vitest";
import { eventAvailabilityResponse, namedOption, providerOptions, githubInstallation, githubRepository, tailIntegration } from "../src/editor-contracts";
import {exeConnection} from "../src/settings-contracts";
import { triggerResponse } from "../src/job-contracts";
import { generateOpenApi } from "../src/api-contract";
describe("public editor contracts", () => {
  it("describes required target metadata and provider resources without credential fields", () => {
    const target={connectionId:"vm",credentialStatus:"connected",accountTags:["workspace"],tags:[]};
    expect(exeConnection.parse({...target,apiToken:"private",agentKind:"codex",models:["old"]})).toEqual(target);
    expect(exeConnection.safeParse({...target,accountTags:[42]}).success).toBe(false);
    expect(eventAvailabilityResponse.parse({ manual: true, schedule: true, triggerLifecycle: true, linear: false, clickup: false, github: false, cloudflareTail: false }).linear).toBe(false);
    expect(namedOption.parse({ id: "option", name: "Name", secret: "private" })).toEqual({ id: "option", name: "Name" });
    expect(providerOptions.safeParse({ statuses: [], users: [], labels: [] }).success).toBe(true);
    expect(githubInstallation.safeParse({ installationId: 1, accountLogin: "owner", accountType: "Organization", state: "active", updatedAt: new Date().toISOString() }).success).toBe(true);
    expect(githubRepository.safeParse({ id: 1, name: "repo", fullName: "owner/repo", owner: "owner", private: true, defaultBranch: "main" }).success).toBe(true);
    expect(tailIntegration.safeParse({ integrationId: "tail", name: "Tail", status: "connected", secretConfigured: true, referencedTriggerCount: 0, createdAt: "now", updatedAt: "now" }).success).toBe(true);
  });
  it("publishes concrete create and editor resource schemas in the executable contract", () => {
    const document = generateOpenApi() as any;
    for (const path of ["/api/v1/trigger-event-availability", "/api/v1/providers/linear/projects", "/api/v1/providers/linear/options", "/api/v1/providers/clickup/lists", "/api/v1/providers/clickup/options", "/api/v1/providers/github/installations", "/api/v1/integrations/cloudflare-tail"]) {
      const schema = document.paths[path].get.responses[200].content["application/json"].schema;
      expect(schema.type === "array" ? schema.items.required.length : schema.required.length).toBeGreaterThan(0);
    }
    const schema = document.paths["/api/v1/triggers"].post.responses[201].content["application/json"].schema;
    expect(schema.required).toContain("updatedAt"); expect(schema.required).toContain("events");
    expect(triggerResponse.safeParse({ id: "not-a-trigger" }).success).toBe(false);
  });
});
