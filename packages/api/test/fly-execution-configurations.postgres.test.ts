import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiService } from "../src/flow-service";
import { flyExecutionConfigurationInput } from "../src/fly-execution-configurations";
import { exeConnection, integrationStatus } from "../src/settings-contracts";
import { FlyConnectionRepository } from "../src/postgres/fly-connection-repository";
import { FlyExecutionConfigurationRepository } from "../src/postgres/fly-execution-configuration-repository";
import { protectedApiFetch } from "../src/protected-api";
import { loadingFixture } from "./helpers/loading-fixture";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {}, DurableObject: class {} }));
vi.mock("@cloudflare/workers-oauth-provider", () => ({ OAuthProvider: class {}, AuthorizationError: class extends Error {}, getOAuthApi: vi.fn() }));

const url = process.env.AUTH_TEST_DATABASE_URL;
describe.skipIf(!url)("Fly execution configurations (PostgreSQL/API)", () => {
  let fixture: Awaited<ReturnType<typeof loadingFixture>>;
  beforeAll(async () => { fixture = await loadingFixture(url!); });
  beforeEach(async () => { if (fixture) await fixture.db.pool.query("DELETE FROM app.fly_connections WHERE tenant_id=$1", [fixture.tenantId]); });
  afterAll(async () => { await fixture?.cleanup(); });

  const metadata = async () => ({ regions: ["iad", "ord"], sizes: ["shared-cpu-1x", "performance-2x"] });
  const service = (tenantId = fixture.tenantId) => new ApiService(fixture.env, { ...fixture.auth, tenantId, authMethod: "session", scopes: ["integrations:read", "integrations:write"] }, undefined, metadata);
  const apiRequest = (method: string, path: string, body?: unknown) => protectedApiFetch(new Request(fixture.env.APP_ORIGIN + path, { method, headers: { Origin: fixture.env.APP_ORIGIN, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), fixture.env, { ...fixture.auth, authMethod: "session", scopes: ["integrations:read", "integrations:write"] }, { waitUntil() {} } as any);

  it("stores multiple tenant-scoped configurations, validates provider selections, and omits credentials", async () => {
    const fly = new FlyConnectionRepository(fixture.db, fixture.tenantId, fixture.env.CREDENTIAL_ENCRYPTION_KEY);
    await fly.save({ organizationSlug: "alpha", organizationName: "Alpha" }, "synthetic-fly-token");
    const api = service();
    const firstResponse = await apiRequest("POST", "/api/v1/fly/execution-configurations", { name: "Codex east", image: "ghcr.io/acme/runner:v1", region: "iad", size: "shared-cpu-1x" });
    const secondResponse = await apiRequest("POST", "/api/v1/fly/execution-configurations", { name: "Code west", image: "ghcr.io/acme/code:v2", region: "ord", size: "performance-2x" });
    expect(firstResponse.status).toBe(200); expect(secondResponse.status).toBe(200);
    const first = await firstResponse.json() as any, second = await secondResponse.json() as any;
    expect((await (await apiRequest("GET", "/api/v1/fly/execution-configurations")).json() as any).configurations).toHaveLength(2);
    expect((await api.getFlyExecutionConfiguration(first.configuration.id)).configuration).toEqual(first.configuration);
    expect(JSON.stringify(await (await apiRequest("GET", "/api/v1/fly/execution-configurations")).json())).not.toContain("synthetic-fly-token");
    await expect(new FlyExecutionConfigurationRepository(fixture.db, fixture.otherTenant).list()).resolves.toEqual([]);
    await expect(api.saveFlyExecutionConfiguration({ name: "Bad region", image: "ghcr.io/acme/runner:v1", region: "xyz", size: "shared-cpu-1x" })).rejects.toMatchObject({ code: "invalid_fly_configuration" });
    await expect(api.saveFlyExecutionConfiguration({ name: "Bad size", image: "ghcr.io/acme/runner:v1", region: "iad", size: "custom" })).rejects.toMatchObject({ code: "invalid_fly_configuration" });
    expect(await api.removeFlyExecutionConfiguration(second.configuration.id)).toEqual({ id: second.configuration.id, deleted: true });
  });

  it("requires a Fly connection and preserves old exe payload omission compatibility", async () => {
    const api = service();
    await expect(api.saveFlyExecutionConfiguration({ name: "x", image: "ghcr.io/a/b:v1", region: "iad", size: "shared-cpu-1x" })).rejects.toMatchObject({ code: "fly_connection_required" });
    expect(flyExecutionConfigurationInput.safeParse({ name: "x", image: "bad image", region: "iad", size: "shared-cpu-1x" }).success).toBe(false);
    expect(exeConnection.parse({ connectionId: "old", credentialStatus: "connected" })).toEqual({ connectionId: "old", credentialStatus: "connected", accountTags: [], models: [], efforts: [] });
    expect(integrationStatus.parse({ linear: null, clickup: null, exe: null, exeConnections: [], ampConnections: [], cloudflareTail: { count: 0, installations: [] } }).exeConnections).toEqual([]);
  });
});
