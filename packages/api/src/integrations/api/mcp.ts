import { z } from "zod";

import { mcpTool } from "../../transport/mcp/tool";

export const exeTools = [
  mcpTool("integrations:read", "list_exe_connections", "List safe metadata for saved exe.dev connections. API tokens are never returned.", z.object({}), service => () => service.listExeConnections()),
];

export const githubTools = [
  mcpTool("integrations:read", "list_github_installations", "List connected GitHub App installations, including the installation IDs needed by GitHub Trigger events. Credentials are never returned.", z.object({}), service => () => service.listGitHubInstallations()),
];

export const tailTools = [
  mcpTool("integrations:read", "list_cloudflare_tail_integrations", "List installed Cloudflare Tail integrations and reference counts. Signing secrets are never returned.", z.object({}), service => () => service.listTailIntegrations()),
];
