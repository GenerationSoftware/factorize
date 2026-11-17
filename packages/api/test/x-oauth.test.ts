import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createXPKCE, readXOAuthState, signXOAuthState, validateXOAuthScopes, X_SUGGESTED_SCOPES } from "../src/x-oauth";

const session = { tenantId: "tenant-a", userId: "owner-a", sessionVersion: 3 };
const stateValue = {
  ...session,
  connectionId: "connection-a",
  scopes: [...X_SUGGESTED_SCOPES],
  nonce: "nonce-a",
  exp: Math.floor(Date.now() / 1000) + 600,
};

describe("X OAuth setup foundation", () => {
  it("offers a posts and users preset with offline refresh", () => {
    expect(validateXOAuthScopes(X_SUGGESTED_SCOPES)).toEqual(["tweet.read", "users.read", "offline.access"]);
  });

  it("rejects unknown scopes and missing API v2 baseline or offline access", () => {
    expect(() => validateXOAuthScopes(["tweet.read", "users.read", "made.up", "offline.access"])).toThrow(/not supported/);
    expect(() => validateXOAuthScopes(["tweet.read", "offline.access"])).toThrow(/users.read/);
    expect(() => validateXOAuthScopes(["tweet.read", "users.read"])).toThrow(/offline.access/);
  });

  it("deduplicates and returns scopes in stable provider order", () => {
    expect(validateXOAuthScopes(["users.read", "tweet.read", "offline.access", "tweet.read"])).toEqual([...X_SUGGESTED_SCOPES]);
  });

  it("generates an S256 PKCE challenge for the returned verifier", async () => {
    const pair = await createXPKCE();
    const expected = createHash("sha256").update(pair.verifier).digest("base64url");
    expect(pair.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pair.challenge).toBe(expected);
  });

  it("binds signed state to the cookie, owner, tenant, session version and expiry", async () => {
    const token = await signXOAuthState(stateValue, "state-secret");
    await expect(readXOAuthState(token, token, session, "state-secret")).resolves.toMatchObject(stateValue);
    await expect(readXOAuthState(token, undefined, session, "state-secret")).resolves.toBeNull();
    await expect(readXOAuthState(token, token, { ...session, tenantId: "tenant-b" }, "state-secret")).resolves.toBeNull();
    await expect(readXOAuthState(token, token, { ...session, userId: "owner-b" }, "state-secret")).resolves.toBeNull();
    await expect(readXOAuthState(token, token, { ...session, sessionVersion: 4 }, "state-secret")).resolves.toBeNull();
    await expect(readXOAuthState(token, token, session, "wrong-secret")).resolves.toBeNull();

    const expired = await signXOAuthState({ ...stateValue, exp: Math.floor(Date.now() / 1000) - 1 }, "state-secret");
    await expect(readXOAuthState(expired, expired, session, "state-secret")).resolves.toBeNull();
  });
});
