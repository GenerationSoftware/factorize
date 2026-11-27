import { requiredMcpToolScope } from "./registry";
import { connectionAccess, requiredIntegrationScope, type AgentIntegration, type ConnectionPolicy } from "../../proxy/application/agent-integration-access";
import { databaseFor } from "../../postgres/database";
import type { Env, OAuthProps } from "../../types";

export async function mcpMissingScopes(env: Env, auth: OAuthProps, body: unknown, policy: ConnectionPolicy): Promise<string[] | null> {
  if (!body || typeof body !== "object") return null;
  const { jsonrpc, id, method, params } = body as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: any };
  if (jsonrpc !== "2.0" || !(typeof id === "string" || typeof id === "number")) return null;
  const name = method === "tools/call" ? params?.name : undefined;
  const uri = params?.uri;
  const resourceRead = method === "resources/read" || method === "resources/subscribe";
  const methodNeedsRead = method === "events/list" || method === "events/subscribe" || method === "events/unsubscribe" ||
    (resourceRead && typeof uri === "string" && uri.startsWith("factorize://events/")) ||
    (method === "subscriptions/listen" && Array.isArray(params?.notifications?.resourceSubscriptions) &&
      params.notifications.resourceSubscriptions.some((item: unknown) => typeof item === "string" && item.startsWith("factorize://events/")));
  const scope = typeof name === "string" ? requiredMcpToolScope(name) : methodNeedsRead ? "triggers:read" :
    resourceRead && typeof uri === "string" && uri.startsWith("proxy://responses/") ? "proxy:use" : undefined;
  const missing = scope && !auth.scopes.includes(scope) ? [scope] : null;

  // Only local Factorize integration policy may request additional OAuth
  // scopes. Blocked integrations and upstream errors stay normal tool errors.
  const integration = params?.arguments?.integration;
  if ((name !== "request_api" && name !== "fetch_payload") || typeof integration !== "string" ||
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(integration)) return missing;
  const row = (await databaseFor(env).pool.query<AgentIntegration>(
    "SELECT * FROM app.agent_integrations WHERE tenant_id=$1 AND id=$2", [auth.tenantId, integration])).rows[0];
  return row && connectionAccess(row, auth.scopes, policy, auth.explicitIntegrationScopes) === "requestable" ? ["proxy:use", requiredIntegrationScope(row)] : missing;
}
