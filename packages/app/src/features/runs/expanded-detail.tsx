import { Disclosure, Summary, Card } from "../../shared/ui";
import { RunProvenance } from "./provenance";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { runDetailQuery, diagnosticsQuery } from "./queries";
export function ExpandedRunDetail({ runId }: { runId: string }) {
  const [details, setDetails] = useState(false), [diagnostics, setDiagnostics] = useState(false);
  const run = useQuery({ ...runDetailQuery(runId), enabled: details }), evidence = useQuery({ ...diagnosticsQuery(runId), enabled: diagnostics });
  return <Card className="my-4"><Disclosure onToggle={e => setDetails(e.currentTarget.open)}><Summary>Prompt, context and provenance</Summary>
    {run.isPending && <p role="status">Loading run details…</p>}{run.error && <p role="alert">{run.error.message}</p>}{run.data && <><h2>Prompt</h2><pre className="whitespace-pre-wrap break-words">{run.data.prompt}</pre><RunProvenance run={run.data} /><h2>Activity</h2><ul>{run.data.activity.map((item, index) => <li key={index}>{item.created_at} · {item.action}: {item.detail}</li>)}</ul></>}
  </Disclosure><Disclosure onToggle={e => setDiagnostics(e.currentTarget.open)}><Summary>Diagnostics and artifacts</Summary>{evidence.isPending && <p role="status">Loading diagnostics…</p>}{evidence.error && <p role="alert">{evidence.error.message}</p>}{evidence.data && <pre className="whitespace-pre-wrap break-words">{JSON.stringify(evidence.data, null, 2)}</pre>}</Disclosure></Card>;
}
