import { describe, expect, it, vi } from "vitest";
import { decrypt } from "../src/crypto";
import { XConnectionRepository } from "../src/postgres/x-connection-repository";
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
      expect(await repository.get(id)).toBeNull();
    } finally { await f.cleanup(); }
  });
});
