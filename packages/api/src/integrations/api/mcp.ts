import { hetznerSshToolInput } from "./hetzner-ssh-contracts";
import { z } from "zod";

import { mcpTool } from "../../transport/mcp/tool";

export const exeTools = [
  mcpTool("integrations:read", "list_exe_connections", "List safe metadata for saved exe.dev connections. API tokens are never returned.", z.object({}), service => () => service.integrations.listExeConnections()),
];

export const githubTools = [
  mcpTool("integrations:read", "list_github_installations", "List connected GitHub App installations, including the installation IDs needed by GitHub Trigger events. Credentials are never returned.", z.object({}), service => () => service.integrations.listGitHubInstallations()),
];

export const tailTools = [
  mcpTool("integrations:read", "list_cloudflare_tail_integrations", "List installed Cloudflare Tail integrations and reference counts. Signing secrets are never returned.", z.object({}), service => () => service.integrations.listTailIntegrations()),
];


export const hetznerTools = [
  mcpTool("integrations:read", "check_hetzner_ssh", "Check SSH access for one owner-enrolled Hetzner Cloud server. Uses the pinned host identity and a Factorize-held credential. Runs only a fixed liveness check; no custom commands or output.", hetznerSshToolInput, service =>
    (input: {serverId: number}) => service.hetznerSsh.checkAsClient(input.serverId)),
];
