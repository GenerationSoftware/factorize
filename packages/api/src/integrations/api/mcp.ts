import { z } from "zod";

import { mcpTool } from "../../transport/mcp/tool";
import { awsCodeInput } from "./aws-contracts";

export const exeTools = [
  mcpTool("integrations:read", "list_exe_connections", "List safe metadata for saved exe.dev connections. API tokens are never returned.", z.object({}), service => () => service.integrations.listExeConnections()),
];

export const githubTools = [
  mcpTool("integrations:read", "list_github_installations", "List connected GitHub App installations, including the installation IDs needed by GitHub Trigger events. Credentials are never returned.", z.object({}), service => () => service.integrations.listGitHubInstallations()),
];

export const tailTools = [
  mcpTool("integrations:read", "list_cloudflare_tail_integrations", "List installed Cloudflare Tail integrations and reference counts. Signing secrets are never returned.", z.object({}), service => () => service.integrations.listTailIntegrations()),
];

export const awsTools = [
  mcpTool<z.infer<typeof awsCodeInput>>("integrations:write", "run_aws_script",
    "Run Python in the AWS-hosted MCP sandbox through an explicitly assigned AWS connection. The customer role controls AWS API permissions; permitted writes can change resources and incur charges. Never assume a retry after timeout is safe.",
    awsCodeInput, service => ({ connectionId, code }, signal) => service.aws.codeMode(connectionId, code, signal)),
];
