import { env, fetchMock } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { Env as FactorizeEnv } from "../src/types";

declare module "cloudflare:test" {
  interface ProvidedEnv extends FactorizeEnv {}
}

describe("fresh TenantV2 namespace", () => {
  beforeAll(() => {
    fetchMock.activate();
    fetchMock.disableNetConnect();
  });

  it("initializes the current schema and creates a manual Job with a selected execution target", async () => {
    fetchMock.get("https://ampcode.com").intercept({ path: "/api/cloud/v1/projects?limit=1" }).reply(200, {});
    const tenant = env.TENANTS.get(env.TENANTS.idFromName(`fresh-v2:${crypto.randomUUID()}`));

    const connection = await tenant.fetch("https://tenant/connections/amp", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ connectionId: "execution-1", accessToken: "test-token", project: "generation/factorize" }),
    });
    expect(connection.status, await connection.clone().text()).toBe(200);

    const created = await tenant.fetch("https://tenant/v1/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Manual prompt",
        promptTemplate: "{{trigger-1.prompt}}",
        concurrencyLimit: 1,
        executionTargetId: "amp:execution-1",
        triggers: [{ kind: "manual", slug: "trigger-1", config: {} }],
      }),
    });

    expect(created.status, await created.clone().text()).toBe(200);
    await expect(created.json()).resolves.toMatchObject({
      name: "Manual prompt",
      promptTemplate: "{{trigger-1.prompt}}",
      executionTargetId: "amp:execution-1",
      triggers: [{ kind: "manual", slug: "trigger-1" }],
    });
  });
});

describe("fresh GitHubInstallationRegistryV2 namespace", () => {
  it("initializes and stores a new installation claim", async () => {
    const registry = env.GITHUB_INSTALLATIONS!.get(env.GITHUB_INSTALLATIONS!.idFromName(`fresh-v2:${crypto.randomUUID()}`));
    const installationId = 2030;
    const stored = await registry.fetch(`https://registry/installations/${installationId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenantId: "tenant-2030", accountLogin: "generation", accountType: "Organization" }),
    });
    expect(stored.status, await stored.clone().text()).toBe(200);

    const loaded = await registry.fetch(`https://registry/installations/${installationId}`);
    expect(loaded.status, await loaded.clone().text()).toBe(200);
    await expect(loaded.json()).resolves.toMatchObject({ installation_id: installationId, tenant_id: "tenant-2030" });
  });
});
