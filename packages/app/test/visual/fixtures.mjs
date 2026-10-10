export const jobId = "00000000-0000-4000-8000-000000000001";
export const runId = "00000000-0000-4000-8000-000000000002";
export const time = "2026-10-09T12:00:00.000Z";
export const job = {
  id: jobId, name: "Review release builds", slug: "review-builds", enabled: true,
  promptTemplate: "Review {{trigger-1.prompt}}.\nCheck the release notes and report any regressions.",
  runNameTemplate: "Release review", executionTargetId: "vm",
  executionTarget: { connectionId: "vm", workspace: "ephemeral", cwd: "/workspace", agentKind: "codex" },
  model: "gpt-6", effort: "high", concurrencyLimit: 2, runningCount: 1, currentRuns: 1, maxConcurrency: 2,
  agentKind: "codex", lastRunState: "running",
  triggers: [{ id: "trigger", jobId, slug: "trigger-1", kind: "manual", enabled: true, config: {}, createdAt: time, updatedAt: time }],
  createdAt: time, updatedAt: time,
};
export const run = {
  id: runId, job_id: jobId, job_name: job.name, name: "Release review", run_name: "Release review",
  state: "succeeded", finalizing: false, trace_revision: "fixture-1", trace_generation: 1,
  artifact_state: "stored", created_at: time, started_at: time, updated_at: "2026-10-09T12:01:00.000Z",
  agent_kind: "codex", prompt: job.promptTemplate, destination_url: null,
  activity: [], invocation: { source: "manual", context: {}, prompt: "Review the release" },
  trace_projection: { source_kind: "native_session" },
};
export const events = [
  { id: "one", sequence: 1, type: "user_message", title: "User", preview: "Review the release and check **backwards compatibility**.", display: {} },
  { id: "two", sequence: 2, type: "reasoning", title: "Reasoning", preview: "I will inspect the changed interfaces and run the boundary checks.", display: {} },
  { id: "three", sequence: 3, type: "command", title: "npm run check:boundaries", preview: "\u001b[32mAll boundary checks passed\u001b[0m", display: {} },
  { id: "four", sequence: 4, type: "assistant_message", title: "Assistant", preview: "### Release ready\n\nThe interfaces remain compatible.\n\n- Contract checks passed\n- No regressions found\n\n```typescript\nconst release = { ready: true };\n```", display: {} },
];
export const integrations = { linear: { organizationName: "Release workspace" }, clickup: null, github: { installations: [] }, exeConnections: [], ampConnections: [], cloudflareTail: { installations: [] } };
export const targets = [{ id: "vm", kind: "exe-vm", name: "Release VM", workspace: "ephemeral", cwd: "/workspace", agentKind: "codex", models: ["gpt-6"], efforts: ["high"], capabilities: ["stop"] }];
export async function mockApi(page, { legacy = false, authenticated = true, empty = false, state = "succeeded", long = false } = {}) {
  const configuredJob = { ...job, ...(long ? { name: "Long release review " + "abcdefghij".repeat(14), promptTemplate: "A long prompt " + "word ".repeat(500) } : {}) };
  await page.route("**/api/v1/**", route => {
    const url = new URL(route.request().url()), path = url.pathname;
    let json;
    if (path === "/api/v1/session") json = authenticated ? { authenticated: true, user: { id: "owner", email: "owner@example.test" }, workspace: { id: "tenant", name: "Release" }, capabilities: [], expiresAt: "2026-10-10T00:00:00Z" } : { authenticated: false };
    else if (path === "/api/v1/job-summaries") json = { items: empty ? [] : [configuredJob, { ...configuredJob, id: "disabled", name: "Archive release artifacts", enabled: false, runningCount: 0, lastRunState: "failed" }], nextCursor: null };
    else if (path === "/api/v1/jobs") json = empty ? [] : [configuredJob, { ...configuredJob, id: "disabled", name: "Archive release artifacts", enabled: false, runningCount: 0, lastRunState: "failed" }];
    else if (path === "/api/v1/jobs/" + jobId) json = configuredJob;
    else if (path === "/api/v1/runs") json = { items: empty ? [] : [{ ...run, state }], nextCursor: null };
    else if (path.endsWith("/status") || path === "/api/v1/runs/" + runId) json = { ...run, state };
    else if (path.endsWith("/trace-pages")) json = { items: events, nextCursor: null, revision: "fixture-1", reset: false };
    else if (path.endsWith("/trace")) json = { items: events.filter(event => event.sequence > Number(url.searchParams.get("after") || 0)).map(event => ({ ...event, kind: event.type, content: event.preview, data: { text: event.preview, command: event.title } })), nextCursor: null, generation: 1, source: "native_session" };
    else if (path.endsWith("/diagnostics")) json = { artifacts: [], warnings: [] };
    else if (path === "/api/v1/execution-targets") json = targets;
    else if (path === "/api/v1/trigger-contexts") json = { manual: [{ path: "prompt", type: "string", description: "Manual prompt" }] };
    else if (path === "/api/v1/job-trigger-availability") json = { manual: true, schedule: true, jobLifecycle: true, linear: false, github: false, clickup: false, cloudflareTail: false };
    else if (path === "/api/v1/integrations") json = integrations;
    else if (path === "/api/v1/search") json = { items: [{ kind: "job", id: jobId, title: job.name, subtitle: "Manual · codex" }] };
    else if (path.endsWith("/consent/preview")) json = { clientName: "Release CLI", scopes: ["flows:read", "runs:read"], request: "fixture", signature: "fixture", expiresAt: time };
    else if (path.endsWith("/device/preview")) json = { clientName: "Release CLI", scopes: ["flows:read"], userCode: "ABCD-EFGH" };
    else json = [];
    return route.fulfill({ json });
  });
}
export const screens = [
  ["jobs", "/jobs", "Jobs"],
  ["job", "/jobs/" + jobId, job.name],
  ["editor", "/jobs/" + jobId + "/settings", job.name],
  ["trace", "/job-runs/" + runId, run.run_name],
  ["settings", "/settings", "Integrations"],
  ["login", "/auth/login", "Sign in to Factorize"],
];
