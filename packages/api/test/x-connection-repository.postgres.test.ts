import { describe, expect, it, vi } from "vitest";
import { decrypt } from "../src/crypto";
import { XConnectionRepository, XReconnectRequiredError } from "../src/postgres/x-connection-repository";
import { loadingFixture } from "./helpers/loading-fixture";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {}, DurableObject: class {} }));
vi.mock("@cloudflare/workers-oauth-provider", () => ({ OAuthProvider: class {}, AuthorizationError: class extends Error {}, getOAuthApi: vi.fn() }));
const url = process.env.AUTH_TEST_DATABASE_URL;

describe.skipIf(!url)("encrypted X app connections (PostgreSQL)", { timeout: 60_000 }, () => {
  it("encrypts the client secret and exposes only tenant-scoped safe metadata", async () => {
    const f = await loadingFixture(url!);
    try {
      const id = crypto.randomUUID();
      const input = { id, name: "My X app", clientId: "client-123", clientSecret: "private-x-secret", scopes: ["tweet.read", "users.read", "offline.access"] };
      const repository = new XConnectionRepository(f.db, f.tenantId, f.env.CREDENTIAL_ENCRYPTION_KEY);
      const created = await repository.create(input);
      expect(created).toMatchObject({ id, name: input.name, clientId: input.clientId, scopes: input.scopes, status: "pending", accountId: null, accountHandle: null, grantedScopes: [] });
      expect(JSON.stringify(created)).not.toContain(input.clientSecret);

      const stored = (await f.db.pool.query("SELECT encrypted_secret FROM app.x_connections WHERE tenant_id=$1 AND id=$2", [f.tenantId, id])).rows[0].encrypted_secret;
      expect(stored).not.toContain(input.clientSecret);
      expect(JSON.parse(await decrypt(stored, f.env.CREDENTIAL_ENCRYPTION_KEY))).toEqual({ clientSecret: input.clientSecret });
      expect(JSON.stringify(await repository.list())).not.toContain(input.clientSecret);
      expect(await repository.clientCredentials(id)).toMatchObject({ clientId: input.clientId, clientSecret: input.clientSecret, scopes: input.scopes });
      expect(await new XConnectionRepository(f.db, f.otherTenant, f.env.CREDENTIAL_ENCRYPTION_KEY).get(id)).toBeNull();
      expect(await new XConnectionRepository(f.db, f.otherTenant, f.env.CREDENTIAL_ENCRYPTION_KEY).clientCredentials(id)).toBeNull();
      const nonce = crypto.randomUUID(), verifier = "one-time-pkce-verifier";
      expect(await repository.createOAuthAttempt({ nonce, userId: f.userId, sessionVersion: 1, connectionId: id, scopes: input.scopes, verifier, expiresAt: new Date(Date.now() + 60_000) })).toBe(true);
      const attempt = (await f.db.pool.query("SELECT encrypted_verifier FROM app.x_oauth_attempts WHERE tenant_id=$1 AND nonce=$2", [f.tenantId, nonce])).rows[0].encrypted_verifier;
      expect(attempt).not.toContain(verifier);
      expect(await new XConnectionRepository(f.db, f.otherTenant, f.env.CREDENTIAL_ENCRYPTION_KEY).consumeOAuthAttempt(nonce)).toBeNull();
      await expect(repository.consumeOAuthAttempt(nonce)).resolves.toMatchObject({ userId: f.userId, connectionId: id, scopes: input.scopes, verifier });
      await expect(repository.consumeOAuthAttempt(nonce)).resolves.toBeNull();
      expect(await repository.delete(id)).toBe(true);
      expect(await repository.get(id)).toMatchObject({ id, status: "revoked", accountId: null, accountHandle: null, grantedScopes: [] });
      await expect(repository.clientCredentials(id)).rejects.toThrow();
      expect(await repository.delete(id)).toBe(false);
      await expect(repository.create({ ...input, name: "My X app" })).rejects.toMatchObject({ code: "23505" });
    } finally { await f.cleanup(); }
  });

  it("serializes concurrent refresh rotation and persists only the newest encrypted token pair", async () => {
    const f = await loadingFixture(url!);
    try {
      const id = crypto.randomUUID(), repository = new XConnectionRepository(f.db, f.tenantId, f.env.CREDENTIAL_ENCRYPTION_KEY);
      await repository.create({ id, name: "Rotating X", clientId: "client", clientSecret: "private", scopes: ["tweet.read", "users.read", "offline.access"] });
      await repository.completeOAuth(id, { accessToken: "expired-access", refreshToken: "refresh-v1", expiresAt: new Date(Date.now() - 1_000).toISOString(), accountId: "123", accountHandle: "user", grantedScopes: ["tweet.read", "users.read", "offline.access"] });
      let release!: () => void, started!: () => void;
      const waiting = new Promise<void>(resolve => { release = resolve; }), began = new Promise<void>(resolve => { started = resolve; });
      const refresh = vi.fn(async () => { started(); await waiting; return { accessToken: "access-v2", refreshToken: "refresh-v2", expiresAt: new Date(Date.now() + 3_600_000).toISOString() }; });
      const first = repository.accessToken(id, refresh), second = repository.accessToken(id, refresh);
      await began;
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(refresh).toHaveBeenCalledOnce();
      release();
      await expect(Promise.all([first, second])).resolves.toEqual(["access-v2", "access-v2"]);
      expect(refresh).toHaveBeenCalledOnce();
      await expect(repository.clientCredentials(id)).resolves.toMatchObject({ accessToken: "access-v2", refreshToken: "refresh-v2" });
    } finally { await f.cleanup(); }
  });

  it("marks invalid_grant terminal, preserves transient failures, and disconnect wins over an in-flight refresh", async () => {
    const f = await loadingFixture(url!);
    try {
      const id = crypto.randomUUID(), repository = new XConnectionRepository(f.db, f.tenantId, f.env.CREDENTIAL_ENCRYPTION_KEY);
      await repository.create({ id, name: "Race X", clientId: "client", clientSecret: "private", scopes: ["tweet.read", "users.read", "offline.access"] });
      await repository.completeOAuth(id, { accessToken: "expired-access", refreshToken: "refresh-v1", expiresAt: new Date(Date.now() - 1_000).toISOString(), accountId: "123", accountHandle: "user", grantedScopes: ["tweet.read", "users.read", "offline.access"] });
      await expect(repository.accessToken(id, async () => { throw new Error("temporary 503"); })).rejects.toThrow("temporary 503");
      expect(await repository.get(id)).toMatchObject({ status: "connected" });
      await expect(repository.accessToken(id, async () => { throw new XReconnectRequiredError(); })).rejects.toBeInstanceOf(XReconnectRequiredError);
      expect(await repository.get(id)).toMatchObject({ status: "reconnect_required" });

      await repository.completeOAuth(id, { accessToken: "expired-access", refreshToken: "refresh-v1", expiresAt: new Date(Date.now() - 1_000).toISOString(), accountId: "123", accountHandle: "user", grantedScopes: ["tweet.read", "users.read", "offline.access"] });
      let release!: () => void, started!: () => void;
      const waiting = new Promise<void>(resolve => { release = resolve; }), began = new Promise<void>(resolve => { started = resolve; });
      const refresh = repository.accessToken(id, async () => { started(); await waiting; return { accessToken: "late-access", refreshToken: "late-refresh", expiresAt: new Date(Date.now() + 3_600_000).toISOString() }; });
      await began;
      const disconnect = repository.disconnect(id);
      release();
      expect(await refresh).toBe("late-access");
      expect(await disconnect).toMatchObject({ accessToken: "late-access", refreshToken: "late-refresh" });
      expect(await repository.get(id)).toMatchObject({ status: "revoked", accountId: null, grantedScopes: [] });
      expect(await repository.accessToken(id, async () => { throw new Error("must not refresh revoked connection"); })).toBeNull();
      await expect(repository.clientCredentials(id)).rejects.toThrow();
    } finally { await f.cleanup(); }
  });
});
