import { fetchWithoutRedirects } from "../../transport/http/fetch-without-redirects";
import { AgentApiError } from "../../proxy/api/agent-api-error";
import { XReconnectRequiredError, type XConnectionRepository } from "../storage/x-connection-repository";

/** Refresh under the repository's rotation lock; only trusted egress receives the credential. */
export async function refreshXProxyToken(repository: XConnectionRepository, connectionId: string) {
  try {
    return await repository.accessToken(connectionId, async credentials => {
      const response = await fetchWithoutRedirects("https://api.x.com/2/oauth2/token", {
        method: "POST", signal: AbortSignal.timeout(15_000),
        headers: { Authorization: `Basic ${btoa(`${credentials.clientId}:${credentials.clientSecret}`)}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: credentials.refreshToken }),
      });
      const body = await response.json().catch(() => null) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; error?: unknown } | null;
      if (!response.ok) {
        if (response.status === 401 || body?.error === "invalid_grant") throw new XReconnectRequiredError();
        throw new Error("X token refresh temporarily failed");
      }
      if (typeof body?.access_token !== "string" || typeof body.refresh_token !== "string" || typeof body.expires_in !== "number" || !Number.isFinite(body.expires_in) || body.expires_in <= 0) throw new Error("X token refresh response was invalid");
      return { accessToken: body.access_token, refreshToken: body.refresh_token, expiresAt: new Date(Date.now() + body.expires_in * 1000).toISOString() };
    });
  } catch (error) {
    if (error instanceof XReconnectRequiredError) throw new AgentApiError(401, "reconnect_required", "X authorization expired or was revoked. Reconnect this connection in Settings.");
    throw new AgentApiError(502, "refresh_unavailable", "X authorization could not be refreshed temporarily. Retry the request later.");
  }
}
