import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { runDetailQuery, diagnosticsQuery } from "./queries";
export function ExpandedRunDetail({ runId }: { runId: string }) {
  const [details, setDetails] = useState(false), [diagnostics, setDiagnostics] = useState(false);
  const run = useQuery({ ...runDetailQuery(runId), enabled: details }), evidence = useQuery({ ...diagnosticsQuery(runId), enabled: diagnostics });
  return <section className="my-4"><details onToggle={e => setDetails(e.currentTarget.open)}><summary>Prompt, context and provenance</summary>
    {run.isPending && <p role="status">Loading run details…</p>}{run.error && <p role="alert">{run.error.message}</p>}{run.data && <><h2>Prompt</h2><pre className="whitespace-pre-wrap break-words">{run.data.prompt}</pre><h2>Invocation</h2><pre className="whitespace-pre-wrap break-words">{JSON.stringify(run.data.invocation, null, 2)}</pre><h2>Activity</h2><ul>{run.data.activity.map((item, index) => <li key={index}>{item.created_at} · {item.action}: {item.detail}</li>)}</ul></>}
  </details><details onToggle={e => setDiagnostics(e.currentTarget.open)}><summary>Diagnostics and artifacts</summary>{evidence.isPending && <p role="status">Loading diagnostics…</p>}{evidence.error && <p role="alert">{evidence.error.message}</p>}{evidence.data && <pre className="whitespace-pre-wrap break-words">{JSON.stringify(evidence.data, null, 2)}</pre>}</details></section>;
}
