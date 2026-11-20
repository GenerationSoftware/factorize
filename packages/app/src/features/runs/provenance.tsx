import { Link } from "@tanstack/react-router";
import { Disclosure, Summary, Card } from "../../shared/ui";
import type { operations } from "factorize-api-client";
type Run = operations["get_api_v1_runs_runId"]["responses"][200]["content"]["application/json"];
export function RunProvenance({ run }: { run: Run }) {
  const invocation = run.invocation;
  return <Card><h2>Event and execution</h2><dl className="grid gap-2 sm:grid-cols-2">
    <div><dt>Source</dt><dd>{invocation.source}</dd></div>
    {run.launch_skill_key && <div><dt>Skill</dt><dd>/{run.launch_skill_key} · revision {run.launch_skill_revision}</dd></div>}
    {invocation.source_run_id && <div><dt>Parent run</dt><dd><Link to="/runs/$runId" params={{runId:invocation.source_run_id}}>{invocation.source_run_id}</Link></dd></div>}
    {invocation.source !== "direct" && <div><dt>Event</dt><dd>{Object.keys(invocation.context).join(", ") || "Unavailable"}</dd></div>}
    {invocation.event_id && <div><dt>Event ID</dt><dd className="break-all">{invocation.event_id}</dd></div>}
    <div><dt>Invoked at</dt><dd>{invocation.created_at}</dd></div>
    <div><dt>Execution</dt><dd>{run.execution_type === "code" ? "Code script" : run.agent_name || run.agent_kind || "Agent"}</dd></div>
    <div><dt>Workspace</dt><dd>{run.workspace_name || "Unavailable"}</dd></div>
    <div><dt>Backend</dt><dd>{run.execution_backend_kind}</dd></div>
    <div><dt>Claim</dt><dd>{run.claim_released ? "Released" : "Held"}</dd></div>
  </dl>{run.execution_type === "code" && <><h3>Executed script snapshot</h3><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words">{run.execution_script ?? "Unavailable"}</pre><h3>Execution configuration snapshot</h3><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words">{JSON.stringify(run.execution_configuration, null, 2)}</pre></>}<h3>Event context and occurrence</h3><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words">{JSON.stringify({ context: invocation.context, occurrence: invocation.occurrence }, null, 2)}</pre>
    {run.issue_url && /^https?:\/\//.test(run.issue_url) && <a href={run.issue_url} target="_blank" rel="noopener noreferrer">{run.issue_title || "Source issue"}</a>}
    <Disclosure><Summary>Trace source and projection</Summary><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words">{JSON.stringify({ sources: run.trace_sources, projection: run.trace_projection, generation: run.trace_generation }, null, 2)}</pre></Disclosure>
  </Card>;
}
