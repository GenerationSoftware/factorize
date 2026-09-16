export type ContextValueType = "string" | "number" | "boolean" | "object" | "array" | "unknown";
export interface ContextPath { path: string; type: ContextValueType; description: string; example?: unknown; }
export interface TriggerContextReflection { slug: string; kind: string; provider?: string; dynamic: boolean; paths: ContextPath[]; }

const commonWebhook: ContextPath[] = [
  { path: "provider", type: "string", description: "Normalized webhook provider name." },
  { path: "event", type: "string", description: "Provider event name." },
  { path: "delivery_id", type: "string", description: "Stable delivery identifier used for deduplication." },
];

export const triggerContextCatalog: Record<string, ContextPath[]> = {
  manual: [{ path: "prompt", type: "string", description: "Prompt supplied by the manual invocation.", example: "Review the failing build" }],
  schedule: [
    { path: "scheduled_at", type: "string", description: "Scheduled occurrence as an ISO 8601 timestamp.", example: "2026-09-16T09:00:00.000Z" },
    { path: "cron", type: "string", description: "Configured cron expression.", example: "0 9 * * *" },
    { path: "timezone", type: "string", description: "Configured IANA timezone.", example: "UTC" },
  ],
  linear: [...commonWebhook,
    { path: "issue", type: "object", description: "Complete Linear issue from the authenticated delivery." },
    { path: "issue.id", type: "string", description: "Linear issue UUID." },
    { path: "issue.identifier", type: "string", description: "Human-readable issue identifier.", example: "GEN-2019" },
    { path: "issue.title", type: "string", description: "Issue title." },
    { path: "issue.description", type: "string", description: "Issue description, when present." },
    { path: "issue.url", type: "string", description: "Canonical Linear issue URL." },
    { path: "issue.state.name", type: "string", description: "Current workflow state name." },
    { path: "issue.project.name", type: "string", description: "Project name, when present." },
  ],
  github: [...commonWebhook,
    { path: "action", type: "string", description: "GitHub webhook action." },
    { path: "pull_request", type: "object", description: "Complete GitHub pull request payload." },
    { path: "pull_request.number", type: "number", description: "Pull request number.", example: 42 },
    { path: "pull_request.title", type: "string", description: "Pull request title." },
    { path: "pull_request.html_url", type: "string", description: "Pull request URL." },
    { path: "pull_request.base.ref", type: "string", description: "Base branch name." },
    { path: "pull_request.head.ref", type: "string", description: "Head branch name." },
    { path: "repository.full_name", type: "string", description: "Owner and repository name.", example: "acme/widgets" },
  ],
  cloudflareTail: [...commonWebhook,
    { path: "outcome", type: "string", description: "Sanitized Worker invocation outcome." },
    { path: "scriptName", type: "string", description: "Worker script that emitted the Tail event." },
    { path: "eventTimestamp", type: "number", description: "Event timestamp in milliseconds." },
    { path: "logs", type: "array", description: "Sanitized console log records." },
    { path: "exceptions", type: "array", description: "Sanitized exception records." },
  ],
  custom: [...commonWebhook, { path: "*", type: "unknown", description: "Additional submitted JSON fields are dynamic and may be nested." }],
  jobLifecycle: [
    { path: "source_job_id", type: "string", description: "Job whose run reached a final state." },
    { path: "source_run_id", type: "string", description: "Run that reached a final state." },
    { path: "final_state", type: "string", description: "Observed final state: succeeded, failed, or stopped." },
    { path: "transitioned_at", type: "string", description: "State transition as an ISO 8601 timestamp." },
    { path: "observation_destination", type: "string", description: "Backend observation URL, when available." },
  ],
};

export function reflectTriggerContext(trigger: { slug?: unknown; kind?: unknown; config?: any }): TriggerContextReflection {
  const kind = String(trigger.kind ?? ""), provider = kind === "webhook" ? String(trigger.config?.provider ?? "custom") : undefined;
  const key = provider ?? kind, handler = kind === "webhook" && typeof trigger.config?.handlerCode === "string" && trigger.config.handlerCode.trim().length > 0;
  return {
    slug: String(trigger.slug ?? ""), kind, ...(provider ? { provider } : {}), dynamic: key === "custom" || handler,
    paths: handler ? [{ path: "*", type: "unknown", description: "The custom handler replaces context with a dynamic JSON object; inspect the handler contract." }] : (triggerContextCatalog[key] ?? [{ path: "*", type: "unknown", description: "Context shape is not known." }]),
  };
}
