import { z } from "zod";

import { mcpTool } from "../../transport/mcp/tool";
import { awsInventoryInput } from "./aws-contracts";

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
  mcpTool<z.infer<typeof awsInventoryInput>>("integrations:read", "list_aws_inventory",
    "List up to 25 Lambda function names, EC2 instance IDs or CloudFront distribution IDs through a verified AWS integration explicitly assigned to this OAuth connection.",
    awsInventoryInput, service => ({ connectionId, service: resource }, signal) => service.aws.inventory(connectionId, resource, signal), false, true),
];
