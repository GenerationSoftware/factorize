import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createCodexSubscriptionProof } from "../src/codex-subscription-proof.js";

function jwt(accountId: string): string {
  const payload = Buffer.from(JSON.stringify({
    "https://api.openai.com/auth": { chatgpt_account_id: accountId },
  })).toString("base64url");
  return `synthetic.${payload}.signature`;
}

async function bodyOf(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function reply(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

describe("Codex subscription protocol proof", () => {
  let closeServer: (() => Promise<void>) | undefined;
  afterEach(async () => closeServer?.());

  it("owns device login and refresh, isolates accounts, discovers models, and relays SSE without exposing account tokens", async () => {
    let now = 10_000;
    const deviceStarts = new Map<string, number>();
    const upstreamRequests: Array<{ path: string; authorization?: string; accountId?: string; body: string }> = [];
    const server = createServer(async (request, response) => {
      const body = await bodyOf(request);
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname.slice(1) === "api/accounts/deviceauth/usercode") {
        const ordinal = deviceStarts.size + 1;
        const deviceId = `device-${ordinal}`;
        deviceStarts.set(deviceId, 0);
        reply(response, 200, { device_auth_id: deviceId, user_code: `USER-${ordinal}`, interval: 1 });
        return;
      }
      if (url.pathname.slice(1) === "api/accounts/deviceauth/token") {
        const poll = JSON.parse(body) as { device_auth_id: string; user_code: string };
        const count = deviceStarts.get(poll.device_auth_id);
        if (count === undefined || poll.user_code !== `USER-${Number(poll.device_auth_id.slice(-1))}`) {
          reply(response, 400, { error: "invalid_device" });
          return;
        }
        if (count === 0) {
          deviceStarts.set(poll.device_auth_id, 1);
          reply(response, 403, { error: "authorization_pending" });
          return;
        }
        reply(response, 200, {
          authorization_code: `code-${poll.device_auth_id}`,
          code_verifier: `verifier-${poll.device_auth_id}`,
          code_challenge: "synthetic-challenge",
        });
        return;
      }
      if (url.pathname === "/oauth/token") {
        const form = new URLSearchParams(body);
        if (form.get("grant_type") === "authorization_code") {
          const accountId = form.get("code")?.endsWith("device-1") ? "account-a" : "account-b";
          reply(response, 200, {
            access_token: `synthetic-access-${accountId}-v1`,
            refresh_token: `synthetic-refresh-${accountId}-v1`,
            expires_in: accountId === "account-a" ? 2 : 20,
            id_token: jwt(accountId),
          });
          return;
        }
        if (form.get("grant_type") === "refresh_token") {
          const accountId = form.get("refresh_token")?.includes("account-a") ? "account-a" : "account-b";
          reply(response, 200, {
            access_token: `synthetic-access-${accountId}-v2`,
            refresh_token: `synthetic-refresh-${accountId}-v2`,
            expires_in: 20,
            id_token: jwt(accountId),
          });
          return;
        }
        reply(response, 400, { error: "unsupported_grant" });
        return;
      }
      if (url.pathname === "/backend-api/codex/models" || url.pathname === "/backend-api/codex/responses") {
        const accountHeader = request.headers["chatgpt-account-id"];
        upstreamRequests.push({
          path: url.pathname,
          authorization: request.headers.authorization,
          accountId: Array.isArray(accountHeader) ? accountHeader[0] : accountHeader,
          body,
        });
        if (url.pathname.endsWith("/models")) {
          reply(response, 200, { models: [
            { slug: "gpt-5-codex", display_name: "GPT-5 Codex", supported_in_api: true },
            { slug: "hidden-preview", display_name: "Hidden preview", supported_in_api: false },
          ] });
          return;
        }
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.write('data: {"type":"response.output_text.delta","delta":"synthetic stream"}\n\n');
        response.end('data: {"type":"response.completed"}\n\n');
        return;
      }
      reply(response, 404, { error: "not_found" });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Fixture server did not bind TCP");
    const origin = `http://127.0.0.1:${address.port}`;
    closeServer = () => new Promise((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });

    const adapter = createCodexSubscriptionProof({
      authOrigin: origin,
      upstreamOrigin: `${origin}/backend-api/codex`,
      clientId: "synthetic-codex-client",
      localApiKey: "local-agent-key",
      now: () => now,
      wait: async (milliseconds) => { now += milliseconds; },
    });

    const loginA = await adapter.login("work");
    const loginB = await adapter.login("personal");
    expect(loginA).toMatchObject({ accountId: "account-a", verificationUrl: `${origin}/codex/device`, userCode: "USER-1" });
    expect(loginB.accountId).toBe("account-b");
    expect(adapter.inspectAccount("work")).toMatchObject({ accountId: "account-a" });
    expect(adapter.inspectAccount("work")).not.toHaveProperty("accessToken");

    const models = await adapter.request("work", "local-agent-key", "/v1/models");
    const modelResult = await models.json();
    expect(modelResult).toMatchObject({ data: [{ id: "gpt-5-codex" }] });

    now += 3_000;
    const stream = await adapter.request("work", "local-agent-key", "/v1/responses", JSON.stringify({ model: "gpt-5-codex", stream: true }));
    const streamedText = await stream.text();
    expect(streamedText).toContain('"delta":"synthetic stream"');
    expect(streamedText).toContain('"type":"response.completed"');

    await adapter.request("personal", "local-agent-key", "/v1/models");
    expect(upstreamRequests.map(({ accountId }) => accountId)).toEqual(["account-a", "account-a", "account-b"]);
    expect(upstreamRequests[0]?.authorization).toBe("Bearer synthetic-access-account-a-v1");
    expect(upstreamRequests[1]?.authorization).toBe("Bearer synthetic-access-account-a-v2");
    expect(upstreamRequests[2]?.authorization).toBe("Bearer synthetic-access-account-b-v1");
    expect(upstreamRequests[1]?.path).toBe("/backend-api/codex/responses");
    expect(upstreamRequests[1]?.body).toContain('"stream":true');

    // The simulated agent sees only the local result. Upstream synthetic OAuth tokens
    // are neither response headers nor body content, and the local key is not forwarded.
    for (const responseForAgent of [models, stream]) {
      expect(responseForAgent.headers.get("authorization")).toBeNull();
      expect(responseForAgent.headers.get("chatgpt-account-id")).toBeNull();
    }
    expect(JSON.stringify(modelResult) + streamedText).not.toContain("synthetic-access-");
    expect(JSON.stringify(upstreamRequests)).not.toContain("local-agent-key");
    await expect(adapter.request("work", "wrong-key", "/v1/models")).rejects.toThrow("Invalid local proxy key");
  }, 10_000);
});
