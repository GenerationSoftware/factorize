import { linearConfig, signingConfig } from "../../config/runtime";
import type { Env } from "../../types";
import type { Database } from "../../postgres/database";
import { installationToken } from "../../integrations/providers/github";
import { refreshLinearToken } from "../../integrations/providers/linear";
import { ConnectionRepository } from "../storage/connection-repository";
import { GitHubRepository } from "../storage/github-repository";

type CachedInstallationToken = { token: string; expiresAt: number };
const installationTokens = new Map<string, CachedInstallationToken>();
const LINEAR_REFRESH_MARGIN_MS = 5 * 60_000;
const GITHUB_TOKEN_TTL_MS = 50 * 60_000;
const LINEAR_TOKEN_TTL_MS = 50 * 60_000;

function validExpiry(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Resolve provider credentials for one already-authorized integration. The
 * caller supplies only the selection read from the caller request. */
export async function resolveProviderCredentials(input: {
  database: Database;
  env: Env;
  tenantId: string;
  githubInstallationIds: number[];
  linearSelected: boolean;
}): Promise<{ githubInstallations: Array<{ installationId: number; available: boolean; accessToken?: string }>;
  linearConnection: null | { connectionId: "linear"; available: boolean; accessToken?: string } }> {
  const { database, env, tenantId } = input;
  const github = await Promise.all(input.githubInstallationIds.map(async installationId => {
    const cacheKey = `${tenantId}:${installationId}`;
    const installation = await new GitHubRepository(database, tenantId).installation(installationId);
    if (installation?.state !== "active") { installationTokens.delete(cacheKey); return { installationId, available: false }; }
    let cached = installationTokens.get(cacheKey);
    if (!cached || cached.expiresAt <= Date.now()) {
      const token = await installationToken(env, installationId);
      cached = { token, expiresAt: Date.now() + GITHUB_TOKEN_TTL_MS };
      installationTokens.set(cacheKey, cached);
    }
    // Recheck availability after the remote token request to close a
    // suspension/disconnect race before returning a usable credential.
    const current = await new GitHubRepository(database, tenantId).installation(installationId);
    if (current?.state !== "active") {
      installationTokens.delete(cacheKey);
      return { installationId, available: false };
    }
    return { installationId, available: true, accessToken: cached.token };
  }));

  if (!input.linearSelected) return { githubInstallations: github, linearConnection: null };
  const connected = await database.pool.query("SELECT 1 FROM app.connections WHERE tenant_id=$1 AND kind='linear'", [tenantId]);
  if (!connected.rowCount) return { githubInstallations: github, linearConnection: { connectionId: "linear", available: false } };
  const connections = new ConnectionRepository(database, tenantId, signingConfig(env).credentialKey);
  let linear = await connections.get<Record<string, any>>("linear");
  if (!linear) return { githubInstallations: github, linearConnection: { connectionId: "linear", available: false } };
  let expiry = validExpiry(linear.accessTokenExpiresAt);
  if (!expiry || expiry <= Date.now() + LINEAR_REFRESH_MARGIN_MS) {
    const refreshed = await refreshLinearToken(linear.refreshToken, linearConfig(env).clientId, linearConfig(env).clientSecret);
    const updated = await connections.rotateLinearTokens(linear.refreshToken, {
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token ?? linear.refreshToken,
      accessTokenExpiresAt: new Date(Date.now() + (Number.isFinite(refreshed.expires_in)
        ? Math.max(0, refreshed.expires_in!) * 1000 : LINEAR_TOKEN_TTL_MS)).toISOString(),
    });
    if (!updated) return { githubInstallations: github, linearConnection: { connectionId: "linear", available: false } };
    linear = updated;
    expiry = validExpiry(linear.accessTokenExpiresAt);
    // A refresh response without an expiry cannot be safely cached as current.
    if (!expiry || expiry <= Date.now()) return { githubInstallations: github, linearConnection: { connectionId: "linear", available: false } };
  }
  return { githubInstallations: github, linearConnection: { connectionId: "linear", available: true, accessToken: linear.accessToken } };
}
