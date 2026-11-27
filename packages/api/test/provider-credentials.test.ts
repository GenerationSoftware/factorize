import { afterEach, describe, expect, it, vi } from "vitest";
import * as github from "../src/github";
import { resolveProviderCredentials } from "../src/credentials/application/provider-credentials";
import { ConnectionRepository } from "../src/credentials/storage/connection-repository";
import { GitHubRepository } from "../src/credentials/storage/github-repository";
import type { Env } from "../src/types";

const tenantId = "11111111-1111-4111-8111-111111111111";
const otherTenant = "22222222-2222-4222-8222-222222222222";
const database: any = { pool: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) } };
const env = { CREDENTIAL_ENCRYPTION_KEY: "test", LINEAR_CLIENT_ID: "linear-client", LINEAR_CLIENT_SECRET: "linear-secret", GITHUB_APP_ID: "github-app", GITHUB_APP_PRIVATE_KEY: "private" } as Env;

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("provider credential selection", () => {
  it("resolves only the active tenant's selected GitHub installations and denies suspended selections", async () => {
    const installation = vi.spyOn(GitHubRepository.prototype, "installation").mockImplementation(function(this: any, id: number) {
      if (this.tenantId !== tenantId) return Promise.resolve(null);
      return Promise.resolve(id === 17 ? { state: "active" } : id === 18 ? { state: "suspended" } : null);
    });
    const mint = vi.spyOn(github, "installationToken").mockResolvedValue("rotated-installation-token");
    const result = await resolveProviderCredentials({ database, env, tenantId, githubInstallationIds: [17, 18], linearSelected: false });
    expect(result).toEqual({ githubInstallations: [
      { installationId: 17, available: true, accessToken: "rotated-installation-token" },
      { installationId: 18, available: false },
    ], linearConnection: null });
    expect(installation.mock.calls.map(([id]) => id)).toEqual([17, 18, 17]);
    expect(mint).toHaveBeenCalledTimes(1);
    await resolveProviderCredentials({ database, env, tenantId: otherTenant, githubInstallationIds: [17], linearSelected: false });
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it("refreshes and persists a rotated Linear token only when that connection is selected", async () => {
    database.pool.query.mockResolvedValue({ rows: [{ connected: 1 }], rowCount: 1 });
    const old = { accessToken: "expired-access", refreshToken: "old-refresh", accessTokenExpiresAt: "2020-01-01T00:00:00.000Z" };
    const current = { ...old, accessToken: "new-access", refreshToken: "new-refresh", accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString() };
    const get = vi.spyOn(ConnectionRepository.prototype, "get").mockResolvedValue(old);
    const rotate = vi.spyOn(ConnectionRepository.prototype, "rotateLinearTokens").mockResolvedValue(current);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 })));
    const result = await resolveProviderCredentials({ database, env, tenantId, githubInstallationIds: [], linearSelected: true });
    expect(result).toEqual({ githubInstallations: [], linearConnection: { connectionId: "linear", available: true, accessToken: "new-access" } });
    expect(get).toHaveBeenCalledTimes(1);
    expect(rotate).toHaveBeenCalledWith("old-refresh", expect.objectContaining({ accessToken: "new-access", refreshToken: "new-refresh" }));

    get.mockClear();
    const unselected = await resolveProviderCredentials({ database, env, tenantId, githubInstallationIds: [], linearSelected: false });
    expect(unselected.linearConnection).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });

  it("returns no credential after Linear disconnect and never refreshes an unselected connection", async () => {
    database.pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
    const get = vi.spyOn(ConnectionRepository.prototype, "get");
    const result = await resolveProviderCredentials({ database, env, tenantId, githubInstallationIds: [], linearSelected: true });
    expect(result.linearConnection).toEqual({ connectionId: "linear", available: false });
    expect(get).not.toHaveBeenCalled();
  });
});
