export const API_OPERATIONS = [
  ["GET", "/api/v1/exe-connections"], ["GET", "/api/v1/github-installations"],
  ["GET", "/api/v1/execution-targets"], ["GET", "/api/v1/job-trigger-availability"],
  ["POST", "/api/v1/schedules/preview"], ["GET", "/api/v1/integrations"],
  ["GET", "/api/v1/integrations/cloudflare-tail"], ["POST", "/api/v1/integrations/cloudflare-tail"],
  ["PUT", "/api/v1/integrations/cloudflare-tail/{integrationId}"], ["DELETE", "/api/v1/integrations/cloudflare-tail/{integrationId}"],
  ["POST", "/api/v1/integrations/cloudflare-tail/{integrationId}/test"],
  ["PUT", "/api/v1/integrations/exe"], ["POST", "/api/v1/integrations/exe/test"], ["DELETE", "/api/v1/integrations/exe/{connectionId}"],
  ["POST", "/api/v1/integrations/exe/{connectionId}/diagnostics"],
  ["PUT", "/api/v1/integrations/amp"], ["POST", "/api/v1/integrations/amp/test"], ["DELETE", "/api/v1/integrations/amp/{connectionId}"],
  ["GET", "/api/v1/providers/linear/projects"], ["GET", "/api/v1/providers/linear/options"],
  ["GET", "/api/v1/providers/clickup/lists"], ["GET", "/api/v1/providers/clickup/options"],
  ["GET", "/api/v1/providers/github/installations"], ["DELETE", "/api/v1/providers/github/installations/{installationId}"],
  ["GET", "/api/v1/providers/github/installations/{installationId}/repositories"],
  ["GET", "/api/v1/providers/github/installations/{installationId}/repositories/{repositoryId}/issue-options"],
  ["GET", "/api/v1/access/authorized-clients"], ["DELETE", "/api/v1/access/authorized-clients/{clientId}"],
  ["GET", "/api/v1/access-tokens"], ["POST", "/api/v1/access-tokens"], ["DELETE", "/api/v1/access-tokens/{tokenId}"],
  ["GET", "/api/v1/jobs"], ["POST", "/api/v1/jobs"], ["GET", "/api/v1/jobs/{jobId}"], ["PUT", "/api/v1/jobs/{jobId}"], ["DELETE", "/api/v1/jobs/{jobId}"],
  ["POST", "/api/v1/jobs/{jobId}/enable"], ["POST", "/api/v1/jobs/{jobId}/disable"], ["POST", "/api/v1/jobs/{jobId}/invocations"], ["GET", "/api/v1/jobs/{jobId}/events"],
  ["POST", "/api/v1/job-handlers/test"], ["GET", "/api/v1/runs"], ["GET", "/api/v1/runs/{runId}"], ["GET", "/api/v1/runs/{runId}/trace"],
  ["GET", "/api/v1/runs/{runId}/diagnostics"], ["POST", "/api/v1/runs/{runId}/stop"], ["POST", "/api/v1/runs/{runId}/kill"], ["GET", "/api/v1/search"],
  ["GET", "/api/v1/webhooks/deliveries"], ["GET", "/api/v1/webhooks/deliveries/{deliveryId}"],
] as const;

const matchers = API_OPERATIONS.map(([method, template]) => [method, new RegExp(`^${template.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\{[^/]+\\\}/g, "[^/]+")}$`)] as const);
export function isDeclaredApiOperation(method: string, path: string): boolean { return matchers.some(([candidate, pattern]) => candidate === method && pattern.test(path)); }
