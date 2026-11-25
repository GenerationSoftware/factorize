import { z } from "zod";
import { AgentApiError } from "./agent-api-error";
import type { Env } from "./types";

const tokenEndpoint = "https://dash.cloudflare.com/oauth2/token";
export const credentialsSchema = z.object({ access: z.string().min(1).max(8192), refresh: z.string().min(1).max(8192).optional(), expiration: z.number() });
export type Credentials = z.infer<typeof credentialsSchema>;
export const reconnect = () => new AgentApiError(401, "reconnect_required", "Reconnect Cloudflare in Integrations.");
export type TokenFailureCode = "token_unreachable" | "token_rejected" | "token_client_rejected" | "token_grant_rejected" | "token_invalid_response";

export class TokenFailure extends AgentApiError {
  constructor(readonly diagnostic: TokenFailureCode) {
    super(502, "cloudflare_unavailable", "Cloudflare did not complete the request. Try again if safe.");
  }
}

const tokenResult = z.object({ access_token: z.string().min(1).max(8192), refresh_token: z.string().min(1).max(8192).optional(),
  expires_in: z.number().finite().positive(), token_type: z.string().refine(value => value.toLowerCase() === "bearer") });
export async function exchangeCloudflareToken(env: Env, payload: Record<string, string>, previous?: Credentials): Promise<Credentials> {
  let response: Response;
  try {
    response = await fetch(tokenEndpoint, {
      method: "POST", redirect: "manual", signal: AbortSignal.timeout(10_000),
      headers: { Accept: "application/json" }, body: new URLSearchParams({ ...payload,
        client_id: env.CLOUDFLARE_OAUTH_CLIENT_ID!, client_secret: env.CLOUDFLARE_OAUTH_CLIENT_SECRET! }),
    });
  } catch {
    throw new TokenFailure("token_unreachable");
  }
  // Workers accepts "manual", not "error". Never replay a token request at
  // a Location supplied by an upstream response or inspect its redirect body.
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel().catch(() => {});
    throw new TokenFailure("token_rejected");
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const result = z.object({ error: z.string() }).safeParse(body);
    const code = result.success ? result.data.error : undefined;
    if (code === "invalid_grant" || code === "invalid_token") {
      if (previous) throw reconnect();
      throw new TokenFailure("token_grant_rejected");
    }
    if (code === "invalid_client" || code === "unauthorized_client") throw new TokenFailure("token_client_rejected");
    throw new TokenFailure("token_rejected");
  }
  const result = tokenResult.safeParse(body);
  if (!result.success) throw new TokenFailure("token_invalid_response");
  // Cloudflare owns grant scope. Refresh the existing grant without requesting
  // any additional scope, and never synthesize or store local permissions.
  return { access: result.data.access_token, refresh: result.data.refresh_token ?? previous?.refresh,
    expiration: Date.now() + result.data.expires_in * 1000 };
}
