import { expect } from "vitest";
import { protectedApiFetch } from "../../src/protected-api";
import type { Env, OAuthProps } from "../../src/types";

export function mcpRequest(env: Env, identity: OAuthProps) {
  return async (method: string, params: Record<string, unknown> = {}, auth = identity, headers: Record<string, string> = {}) => {
    const response = await protectedApiFetch(new Request(env.APP_ORIGIN + "/mcp", {
      method: "POST",
      headers: {
        Host: new URL(env.APP_ORIGIN).host,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "Mcp-Method": method,
        ...(method === "resources/read" ? { "Mcp-Name": String(params.uri) } :
          method === "tools/call" ? { "Mcp-Name": String(params.name) } : {}),
        ...headers,
      },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method,
        params: {
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientInfo": { name: "factorize-test-client", version: "1" },
            "io.modelcontextprotocol/clientCapabilities": {},
          },
          ...params,
        },
      }),
    }), env, auth, {} as ExecutionContext);
    const text = await response.text();
    const body = text.startsWith("{") ? text : text.split("\n").find(line => line.startsWith("data: "))?.slice(6);
    expect(body, text).toBeDefined();
    return { status: response.status, message: JSON.parse(body!) };
  };
}
