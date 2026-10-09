import type { operations } from "factorize-api-client";
type Run = operations["get_api_v1_runs_runId"]["responses"][200]["content"]["application/json"];
export function RunProvenance({ run }: { run: Run }) {
  const invocation = run.invocation;
  return <section><h2>Trigger and execution</h2><dl className="grid gap-2 sm:grid-cols-2">
    <div><dt>Source</dt><dd>{invocation.source}</dd></div>
    <div><dt>Trigger</dt><dd>{Object.keys(invocation.context).join(", ") || "Unavailable"}</dd></div>
    <div><dt>Trigger ID</dt><dd className="break-all">{invocation.trigger_id ?? "Unavailable"}</dd></div>
    <div><dt>Invoked at</dt><dd>{invocation.created_at}</dd></div>
    <div><dt>Agent</dt><dd>{run.agent_name || run.agent_kind || "Unavailable"}</dd></div>
    <div><dt>Workspace</dt><dd>{run.workspace_name || "Unavailable"}</dd></div>
    <div><dt>Backend</dt><dd>{run.execution_backend_kind}</dd></div>
    <div><dt>Claim</dt><dd>{run.claim_released ? "Released" : "Held"}</dd></div>
  </dl><h3>Trigger context and occurrence</h3><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words">{JSON.stringify({ context: invocation.context, occurrence: invocation.occurrence }, null, 2)}</pre>
    {run.issue_url && /^https?:\/\//.test(run.issue_url) && <a href={run.issue_url} target="_blank" rel="noopener noreferrer">{run.issue_title || "Source issue"}</a>}
    <details><summary>Trace source and projection</summary><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words">{JSON.stringify({ sources: run.trace_sources, projection: run.trace_projection, generation: run.trace_generation }, null, 2)}</pre></details>
  </section>;
}
