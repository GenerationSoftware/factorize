import { connectionAccess, requiredIntegrationScope, type AgentIntegration, type ConnectionPolicy } from "./agent-integration-access";
import { databaseFor } from "./postgres/database";
import type { Env, OAuthProps } from "./types";

const requirements = new Map<string, string>();
function tools(scope: string, names: string) { for (const name of names.split(" ")) requirements.set(name, scope); }
tools("triggers:read", "list_events get_event read_event_delivery_diagnostics read_event_occurrences list_event_occurrences list_triggers get_trigger list_trigger_webhook_activity list_webhook_deliveries get_webhook_delivery get_event_processing_acknowledgments set_event_processing_acknowledgments acknowledge_events replay_unacknowledged_events");
tools("triggers:write", "create_event update_event delete_event create_trigger update_trigger delete_trigger enable_trigger disable_trigger fire_trigger test_trigger_webhook_conditions");
tools("integrations:read", "list_exe_connections list_github_installations list_cloudflare_tail_integrations");
tools("vms:read", "list_vms");
tools("vms:edit", "grant_vm_permissions revoke_vm_permissions");
tools("apps:manage", "list_apps get_app create_app update_app");
tools("proxy:use", "request_api read_api_response query_api_response create_payload append_payload_chunk finalize_payload import_attachment fetch_payload get_api_operation read_api_operation cancel_api_operation");

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
  const scope = typeof name === "string" ? requirements.get(name) : methodNeedsRead ? "triggers:read" :
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
