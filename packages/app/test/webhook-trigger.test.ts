import { describe, expect, it } from "vitest";
import { adaptWebhook, publicWebhookConfig } from "../src/webhook-trigger";

describe("webhook Job trigger adapters", () => {
  it("matches Linear and derives a stable claim plus string invocation inputs", () => {
    const config = { provider: "linear" as const, projectId: "p1", matchRules: [{ type: "status" as const, targetId: "done" }] };
    const payload = { type: "Issue", action: "update", data: { id: "i1", project: { id: "p1" }, state: { id: "done" } }, updatedFrom: { stateId: "todo" } };
    expect(adaptWebhook(config, "linear", "linear:d1", payload)).toMatchObject({ claimKey: "webhook:linear:linear:d1", payload: { data: { id: "i1" }, provider: "linear", delivery_id: "linear:d1" }, occurrence: { externalId: "linear:d1" } });
  });

  it("matches GitHub installation, repository, event, and action", () => {
    const config = { provider: "github" as const, installationId: 7, repositoryId: 9, event: "pull_request", action: "dequeued" };
    expect(adaptWebhook(config, "github", "github:d1", { installation: { id: 7 }, repository: { id: 9 }, action: "dequeued" }, "pull_request")).not.toBeNull();
    expect(adaptWebhook(config, "github", "github:d2", { installation: { id: 7 }, repository: { id: 10 }, action: "dequeued" }, "pull_request")).toBeNull();
  });

  it("never exposes webhook secrets", () => {
    expect(publicWebhookConfig({ provider: "cloudflareTail", signingSecret: "super-secret-value" })).toEqual({ provider: "cloudflareTail", secretConfigured: true });
  });
});
