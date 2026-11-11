/**
 * Isolated protocol proof for a Codex-compatible credential proxy. This is not
 * production account storage or an agent runtime: callers keep account tokens
 * behind this adapter and present only the proxy's local key.
 */
export type CodexProofAccount = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  accountId: string;
};

type ProofOptions = {
  authOrigin: string;
  upstreamOrigin: string;
  clientId: string;
  localApiKey: string;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
  fetch?: typeof fetch;
};

const DEVICE_TIMEOUT_MS = 15 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 5_000;

function decodeAccountId(idToken: string): string {
  const payload = idToken.split(".")[1];
  if (!payload) throw new Error("Token response has no identity token payload");
  const base64 = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
  const claims = JSON.parse(atob(base64)) as {
    "https://api.openai.com/auth"?: { chatgpt_account_id?: unknown };
  };
  const accountId = claims["https://api.openai.com/auth"]?.chatgpt_account_id;
  if (typeof accountId !== "string" || accountId.length === 0) {
    throw new Error("Token identity has no ChatGPT account id");
  }
  return accountId;
}

function tokenForm(values: Record<string, string>): URLSearchParams {
  return new URLSearchParams(values);
}

/** Keeps OAuth tokens in the proxy-side closure; responses expose only model data. */
export function createCodexSubscriptionProof(options: ProofOptions) {
  const accounts = new Map<string, CodexProofAccount>();
  const now = options.now ?? Date.now;
  const wait = options.wait ?? ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const fetchImpl = options.fetch ?? fetch;
  const authOrigin = options.authOrigin.replace(/\/$/, "");
  const upstreamOrigin = options.upstreamOrigin.replace(/\/$/, "");

  async function fetchBounded(input: string, init?: RequestInit): Promise<Response> {
    return fetchImpl(input, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  }

  async function exchangeToken(body: URLSearchParams): Promise<CodexProofAccount> {
    const response = await fetchBounded(`${authOrigin}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!response.ok) throw new Error(`OAuth token exchange failed (${response.status})`);
    const tokens = await response.json() as {
      access_token?: unknown;
      refresh_token?: unknown;
      expires_in?: unknown;
      id_token?: unknown;
    };
    if (typeof tokens.access_token !== "string" || typeof tokens.refresh_token !== "string"
      || typeof tokens.expires_in !== "number" || typeof tokens.id_token !== "string") {
      throw new Error("OAuth token response is incomplete");
    }
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: now() + tokens.expires_in * 1000,
      accountId: decodeAccountId(tokens.id_token),
    };
  }

  async function login(name: string): Promise<{ accountId: string; verificationUrl: string; userCode: string }> {
    const start = await fetchBounded(`${authOrigin}/api/accounts/deviceauth/usercode`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_id: options.clientId }),
    });
    if (!start.ok) throw new Error(`Device authorization failed (${start.status})`);
    const device = await start.json() as {
      device_auth_id: string;
      user_code: string;
      interval?: string | number;
    };
    if (!device.device_auth_id || !device.user_code) throw new Error("Device authorization response is incomplete");

    const interval = Number(device.interval ?? 5) * 1000;
    const deadline = now() + DEVICE_TIMEOUT_MS;
    let grant: { authorization_code: string; code_verifier: string } | undefined;
    while (now() < deadline) {
      const poll = await fetchBounded(`${authOrigin}/api/accounts/deviceauth/token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ device_auth_id: device.device_auth_id, user_code: device.user_code }),
      });
      if (poll.ok) {
        grant = await poll.json() as { authorization_code: string; code_verifier: string };
        break;
      }
      if (poll.status !== 403 && poll.status !== 404) throw new Error(`Device authorization poll failed (${poll.status})`);
      await poll.body?.cancel();
      if (now() + interval >= deadline) throw new Error("Device authorization timed out");
      await wait(interval);
    }
    if (!grant?.authorization_code || !grant.code_verifier) throw new Error("Device authorization timed out");

    const account = await exchangeToken(tokenForm({
      grant_type: "authorization_code",
      client_id: options.clientId,
      code: grant.authorization_code,
      code_verifier: grant.code_verifier,
      redirect_uri: `${authOrigin}/deviceauth/callback`,
    }));
    accounts.set(name, account);
    return {
      accountId: account.accountId,
      verificationUrl: `${authOrigin}/codex/device`,
      userCode: device.user_code,
    };
  }

  async function currentAccount(name: string): Promise<CodexProofAccount> {
    const account = accounts.get(name);
    if (!account) throw new Error(`Unknown account: ${name}`);
    if (account.expiresAt > now()) return account;
    const refreshed = await exchangeToken(tokenForm({
      grant_type: "refresh_token",
      client_id: options.clientId,
      refresh_token: account.refreshToken,
    }));
    if (refreshed.accountId !== account.accountId) throw new Error("Refresh changed the ChatGPT account identity");
    accounts.set(name, refreshed);
    return refreshed;
  }

  async function request(name: string, localKey: string, path: "/v1/models" | "/v1/responses", body?: BodyInit): Promise<Response> {
    if (localKey !== options.localApiKey) throw new Error("Invalid local proxy key");
    const account = await currentAccount(name);
    const suffix = path === "/v1/models" ? "/models" : "/responses";
    const upstream = await fetchBounded(`${upstreamOrigin}${suffix}`, {
      method: path === "/v1/models" ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${account.accessToken}`,
        "chatgpt-account-id": account.accountId,
        ...(path === "/v1/responses" ? { "content-type": "application/json", accept: "text/event-stream" } : {}),
      },
      body: path === "/v1/responses" ? body : undefined,
      redirect: "error",
    });
    if (path === "/v1/responses" || !upstream.ok) return upstream;
    const catalog = await upstream.json() as { models?: Array<{ slug?: unknown; supported_in_api?: unknown }> };
    if (!Array.isArray(catalog.models)) throw new Error("Codex model catalog response is invalid");
    const data = catalog.models
      .filter((model) => model.supported_in_api === true && typeof model.slug === "string")
      .map((model) => ({ id: model.slug as string, object: "model" }));
    return Response.json({ object: "list", data }, { headers: { "content-type": "application/json" } });
  }

  return {
    login,
    request,
    /** Test-only metadata; token values remain inaccessible to the simulated agent. */
    inspectAccount(name: string): Readonly<Omit<CodexProofAccount, "accessToken" | "refreshToken">> | undefined {
      const account = accounts.get(name);
      if (!account) return undefined;
      return { accountId: account.accountId, expiresAt: account.expiresAt };
    },
  };
}
