import { subscriptionsProtocol, processingTools } from "../../subscriptions/api/mcp";
import { skillsProtocol } from "../../skills/api/mcp";
import { eventsProtocol, definitionTools, occurrenceTools } from "../../events/api/mcp";
import { proxyProtocol, proxyTools } from "../../proxy/api/mcp";
import { clientTools } from "../../access-control/api/mcp";
import { exeTools, githubTools, tailTools, hetznerTools } from "../../integrations/api/mcp";
import { vmTools } from "../../vm-grants/api/mcp";
import { appTools } from "../../apps/api/mcp";
import { triggerTools } from "../../triggers/api/mcp";
import { McpServer } from "@modelcontextprotocol/server";
import type { ApiService } from "../../api-service";
import { SKILLS_EXTENSION } from "../../skills/api/mcp-skills";

const tools = [...clientTools, ...proxyTools, ...exeTools, ...vmTools, ...appTools, ...githubTools, ...definitionTools, ...processingTools, ...occurrenceTools, ...triggerTools, ...tailTools, ...hetznerTools];
const scopes = new Map(tools.map(tool => [tool.name, tool.scope]));
if (scopes.size !== tools.length) throw new Error("Duplicate MCP tool declaration.");
export const requiredMcpToolScope = (name: string) => scopes.get(name) ?? undefined;

export const listMcpToolMetadata = () => tools.map(({ name, description, scope }) => ({ name, description, scope }));

export function createMcpServer(service: ApiService, subscriptions = true, signal?: AbortSignal): McpServer {
  const server = new McpServer({ name: "factorize", version: "1.0.0" }, {capabilities:{resources:{subscribe:subscriptions},extensions:{[SKILLS_EXTENSION]:{}}}});
  subscriptionsProtocol(server, service);
  skillsProtocol(server, service);
  eventsProtocol(server, service);
  proxyProtocol(server, service);
  for (const tool of tools) tool.register(server, service, signal);
  return server;
}
