import { afterEach, describe, expect, it, vi } from "vitest";
import { googleSignInCallback } from "../src/auth/api/auth-api";
import type { Env } from "../src/types";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {}, DurableObject: class {} }));
vi.mock("@cloudflare/workers-oauth-provider", () => ({ OAuthProvider: class {}, AuthorizationError: class extends Error {}, getOAuthApi: vi.fn() }));

const origin = "https://factorize.test";
const endpoint = origin + "/oauth/google/sign-in/callback";
const ray = "1234567890abcdef-YYZ";
const state = "90bb650a-cd15-4091-be4a-52b080819115";
const nonce = "test-nonce";
const clientId = "test-client-id";

function callback(headers: Record<string, string> = { "CF-Ray": ray }) {
  return new Request(endpoint + "?" + new URLSearchParams({ state, code: "private-fixture-code" }), {
    headers: { Cookie: "__Host-factorize_google_attempt=" + "a".repeat(43), ...headers },
  });
}

function environment(attempt: boolean) {
  const query = vi.fn(async (text: string) => {
    if (text.startsWith("SELECT * FROM app.google_sign_in_attempts")) {
      return { rows: attempt ? [{ id: state, nonce, verifier: "private-fixture-verifier" }] : [] };
    }
    return { rows: [], rowCount: 1 };
  });
  return {
    APP_ORIGIN: origin, SESSION_SIGNING_SECRET: "test-only-secret", GOOGLE_SIGN_IN_CLIENT_ID: clientId,
    GOOGLE_SIGN_IN_CLIENT_SECRET: "private-fixture-client-secret",
    DATABASE: { pool: { query }, transaction: async <T>(run: (sql: { query: typeof query }) => T) => run({ query }) },
  } as unknown as Env;
}

async function fixtureToken(emailVerified: unknown) {
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const key = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: "https://accounts.google.com", aud: clientId, sub: "private-fixture-subject", nonce,
    iat: now, exp: now + 3600, email: "fixture@gmail.com", email_verified: emailVerified };
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const signingInput = part({ alg: "RS256", kid: "fixture-key" }) + "." + part(payload);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(signingInput));
  return { token: signingInput + "." + Buffer.from(signature).toString("base64url"), key };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Google callback compatibility and diagnostics", () => {
  it.each([true, "true"])("continues for the exact signed email verification value %j", async emailVerified => {
    const { token, key } = await fixtureToken(emailVerified);
    const diagnostics = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", async (url: string) => {
      if (url === "https://oauth2.googleapis.com/token") return Response.json({ id_token: token });
      if (url === "https://www.googleapis.com/oauth2/v3/certs") return Response.json({ keys: [{ ...key, kid: "fixture-key" }] });
      throw new Error("Unexpected fixture outbound request");
    });
    const response = await googleSignInCallback(callback(), environment(true));
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(origin + "/auth/google");
    expect(diagnostics).not.toHaveBeenCalled();
  });

  it.each([false, "false", "TRUE", 1])("rejects signed unverified or noncanonical email value %j", async emailVerified => {
    const { token } = await fixtureToken(emailVerified);
    const diagnostics = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", async () => Response.json({ id_token: token }));
    const response = await googleSignInCallback(callback(), environment(true));
    expect(response.headers.get("Location")).toBe(origin + "/auth/login?google=failed");
    expect(diagnostics).toHaveBeenCalledExactlyOnceWith("factorize.google_callback_failed", { code: "id_token_shape", rayId: ray });
  });

  it("distinguishes an unavailable attempt without retaining arbitrary correlation headers", async () => {
    const diagnostics = vi.spyOn(console, "warn").mockImplementation(() => {});
    const noNetwork = vi.fn();
    vi.stubGlobal("fetch", noNetwork);
    const response = await googleSignInCallback(callback({ "CF-Ray": "arbitrary-sensitive-value" }), environment(false));
    expect(response.headers.get("Location")).toBe(origin + "/auth/login?google=failed");
    expect(diagnostics).toHaveBeenCalledExactlyOnceWith("factorize.google_callback_failed", { code: "attempt_unavailable" });
    expect(noNetwork).not.toHaveBeenCalled();
  });

  it("records only an allowlisted exchange rejection and Ray ID, without changing the public error", async () => {
    const diagnostics = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", async () => Response.json({ error: "invalid_client", error_description: "private-fixture-provider-detail" }, { status: 401 }));
    const response = await googleSignInCallback(callback(), environment(true));
    expect(response.headers.get("Location")).toBe(origin + "/auth/login?google=failed");
    expect(diagnostics).toHaveBeenCalledExactlyOnceWith("factorize.google_callback_failed", { code: "token_invalid_client", rayId: ray });
    expect(JSON.stringify(diagnostics.mock.calls)).not.toContain("private-fixture-");
  });
});
