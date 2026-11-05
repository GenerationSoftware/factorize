import { Disclosure, Summary, Card } from "../../shared/ui";
import { RunProvenance } from "./provenance";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { runDetailQuery, diagnosticsQuery } from "./queries";

export function ExpandedRunDetail({ runId }: { runId: string }) {
  const [details, setDetails] = useState(false), [diagnostics, setDiagnostics] = useState(false);
  const run = useQuery({ ...runDetailQuery(runId), enabled: details }), evidence = useQuery({ ...diagnosticsQuery(runId), enabled: diagnostics });
  return <Card className="my-4"><Disclosure onToggle={e => setDetails(e.currentTarget.open)}><Summary>Prompt, context and provenance</Summary>
    {run.isPending && <p role="status">Loading run details…</p>}{run.error && <p role="alert">{run.error.message}</p>}{run.data && <>
      {run.data.job_result && <section aria-label="Structured job result" className="my-3 rounded-lg border p-3"><h2 className="font-semibold">Job result · {run.data.job_result.status}</h2>{run.data.job_result.summary && <p>{run.data.job_result.summary}</p>}{run.data.job_result.reason && <p className="text-red-700 dark:text-red-400">{run.data.job_result.reason}</p>}{run.data.job_result.outputs && <><h3 className="mt-3 font-semibold">Outputs</h3><pre className="whitespace-pre-wrap break-words">{JSON.stringify(run.data.job_result.outputs, null, 2)}</pre></>}</section>}
      {run.data.run_artifacts?.filter(a => a.state === "stored").map(a => <p key={a.id}><a href={`/api/v1/runs/${runId}/artifacts/${a.id}`}>Download retained file ({a.byte_size} bytes)</a></p>)}
      {run.data.agent_error && <section aria-label="Reported run error" className="my-3 rounded-lg border border-red-300 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/30"><h2 className="font-semibold">Agent reported error</h2><p className="whitespace-pre-wrap break-words">{(run.data.agent_error as any).reason}</p><p className="mt-1 text-xs">Reported {new Date((run.data.agent_error as any).reported_at).toLocaleString()}</p></section>}
      {run.data.execution_diagnostics?.detail && <section aria-label="Execution observer diagnostics" className="my-3 rounded-lg border p-3"><h2 className="font-semibold">Execution observer diagnostics</h2><p className="whitespace-pre-wrap break-words">{String(run.data.execution_diagnostics.detail)}</p></section>}<h2>Prompt</h2><pre className="whitespace-pre-wrap break-words">{run.data.prompt}</pre><RunProvenance run={run.data} /><h2>Activity</h2><ul>{run.data.activity.map((item, index) => <li key={index}>{item.created_at} · {item.action}: {item.detail}</li>)}</ul></>}
  </Disclosure><Disclosure onToggle={e => setDiagnostics(e.currentTarget.open)}><Summary>Diagnostics and artifacts</Summary>{evidence.isPending && <p role="status">Loading diagnostics…</p>}{evidence.error && <p role="alert">{evidence.error.message}</p>}{evidence.data && <pre className="whitespace-pre-wrap break-words">{JSON.stringify(evidence.data, null, 2)}</pre>}</Disclosure></Card>;
}
