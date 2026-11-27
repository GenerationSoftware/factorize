import { awsCodeInput } from "./aws-contracts";
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
  mcpTool(null, "list_hetzner_servers", "List server inventory for a connected Hetzner project whose access is granted to this client.", z.strictObject({}), service => () => service.hetznerSsh.inventoryAsClient()),
  mcpTool(null, "check_hetzner_ssh", "Check SSH access for one owner-enrolled Hetzner Cloud server. Uses the pinned host identity and a Factorize-held credential. Proves fresh key authentication; no SSH channel, commands or remote output.", hetznerSshToolInput, service =>
    (input: {serverId: number}) => service.hetznerSsh.checkAsClient(input.serverId)),
];

export const awsTools = [
  // The owner-assigned AWS connection is the use permission. The service rechecks the active OAuth grant before dispatch.
  mcpTool<z.infer<typeof awsCodeInput>>(null, "run_aws_script",
    "Run Python in the AWS-hosted MCP sandbox through an AWS connection whose owner granted this OAuth installation Use access. The customer role controls AWS API permissions; permitted writes can change resources and incur charges. Never assume a retry after timeout is safe.",
    awsCodeInput, service => ({ connectionId, code }, signal) => service.aws.codeMode(connectionId, code, signal)),
];
