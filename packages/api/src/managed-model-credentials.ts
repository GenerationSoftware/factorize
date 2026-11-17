import type { Database } from "./postgres/database";
import type { Env } from "./types";
import { EncryptedIntegrationRepository } from "./postgres/encrypted-integration-repository";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const REFRESH_ORIGIN = "https://auth.openai.com";
type Cache = { OPENAI_API_KEY?: unknown; tokens?: { access_token?: unknown; refresh_token?: unknown; id_token?: unknown; account_id?: unknown; chatgpt_account_id?: unknown; oauth_provenance?: { issuer?: unknown; client_id?: unknown } }; last_refresh?: unknown };
function cache(payload: string): Cache {
  const result = JSON.parse(payload);
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Model account requires reconnection");
  return result;
}
function nonempty(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 16_384 && !/[\r\n]/.test(value); }
function needsRefresh(auth: Cache): boolean {
  if (nonempty(auth.OPENAI_API_KEY)) return false;
  if (!nonempty(auth.tokens?.access_token)) return true;
  try {
    const claims = JSON.parse(atob(auth.tokens.access_token.split(".")[1]!.replaceAll("-", "+").replaceAll("_", "/")));
    // This is only an expiry hint for an owner-supplied upstream credential,
    // never an identity verification or local authorization decision.
    if (typeof claims.exp === "number") return claims.exp * 1000 <= Date.now() + 60_000;
  } catch { /* Opaque tokens follow Codex's scheduled refresh interval. */ }
  const refreshed = typeof auth.last_refresh === "string" ? Date.parse(auth.last_refresh) : NaN;
  return !Number.isFinite(refreshed) || refreshed <= Date.now() - 8 * 24 * 60 * 60_000;
}

/** Codex's published OAuth refresh protocol, restricted to its trusted issuer.
 * No guest-supplied endpoint or client can receive the refresh credential. */
export async function resolveManagedModelCredential(input: { database: Database; env: Env; tenantId: string; accountId: string }): Promise<{ origin: string; prefix: string; accessToken: string; accountId?: string } | null> {
  const repository = new EncryptedIntegrationRepository(input.database, input.tenantId, input.env.CREDENTIAL_ENCRYPTION_KEY);
  const current = await repository.managedCredential(input.accountId, "model");
  if (!current) return null;
  let payload: string | null = current.payload;
  if (needsRefresh(cache(payload))) {
    payload = await repository.refreshManagedModel(input.accountId, async value => {
      const auth = cache(value);
      if (!needsRefresh(auth)) return value;
      const tokens = auth.tokens;
      if (!tokens || !nonempty(tokens.refresh_token)) throw new Error("Model account requires reconnection");
      const provenance = tokens.oauth_provenance;
      if (provenance && (provenance.issuer !== REFRESH_ORIGIN || provenance.client_id !== CLIENT_ID)) throw new Error("Unsupported model OAuth authority");
      const response = await fetch(`${REFRESH_ORIGIN}/oauth/token`, {
        method: "POST", headers: {"Content-Type": "application/json", Accept: "application/json"},
        body: JSON.stringify({client_id: CLIENT_ID, grant_type: "refresh_token", refresh_token: tokens.refresh_token}),
        redirect: "error", signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) { await response.body?.cancel(); throw new Error("Model account requires reconnection"); }
      const refreshed = await response.json() as Record<string, unknown>;
      if (!nonempty(refreshed.access_token) || (refreshed.refresh_token !== undefined && !nonempty(refreshed.refresh_token)) || (refreshed.id_token !== undefined && !nonempty(refreshed.id_token))) throw new Error("Invalid model refresh response");
      tokens.access_token = refreshed.access_token;
      if (refreshed.refresh_token !== undefined) tokens.refresh_token = refreshed.refresh_token;
      if (refreshed.id_token !== undefined) tokens.id_token = refreshed.id_token;
      auth.last_refresh = new Date().toISOString();
      return JSON.stringify(auth);
    });
  }
  if (payload === null) return null;
  // Disconnect may have waited for a refresh lock; check live availability
  // again before authorizing an outbound request.
  const latest = await repository.managedCredential(input.accountId, "model");
  if (!latest) return null;
  const auth = cache(latest.payload);
  if (nonempty(auth.OPENAI_API_KEY)) return {origin: "https://api.openai.com", prefix: "/v1", accessToken: auth.OPENAI_API_KEY};
  if (!nonempty(auth.tokens?.access_token) || needsRefresh(auth)) return null;
  const accountId = auth.tokens.account_id ?? auth.tokens.chatgpt_account_id;
  if (accountId !== undefined && (!nonempty(accountId) || accountId.length > 512)) return null;
  return {origin: "https://chatgpt.com", prefix: "/backend-api/codex", accessToken: auth.tokens.access_token, ...(typeof accountId === "string" ? {accountId} : {})};
}
