import { useEffect, useState } from "react";
import { Link, useParams, useSearch, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { runStatusQuery, runTraceQuery } from "./queries";
import { messageOf } from "../auth/session";
export function RunDetail() {
  const { runId } = useParams({ strict: false }), search = useSearch({ strict: false }) as { after: number };
  const navigate = useNavigate(), cache = useQueryClient();
  const status = useQuery(runStatusQuery(runId!));
  const [revision, setRevision] = useState("");
  const active = !status.data || !["succeeded", "failed", "stopped"].includes(status.data.state) || status.data.finalizing;
  const trace = useQuery(runTraceQuery(runId!, revision, search.after, active));
  useEffect(() => {
    const next = trace.data?.reset ? trace.data.revision : status.data?.trace_revision;
    if (next && next !== revision) {
      if (trace.data?.reset) {
        void cache.cancelQueries({ queryKey: ["runs", runId, "status"] });
        cache.setQueryData(runStatusQuery(runId!).queryKey, previous => previous ? { ...previous, trace_revision: next } : previous);
      }
      setRevision(next);
      void cache.cancelQueries({ queryKey: ["runs", runId, "trace"] });
      cache.removeQueries({ queryKey: ["runs", runId, "trace"] });
      if (revision || trace.data?.reset) void navigate({ to: "/job-runs/$runId", params: { runId: runId! }, search: { after: 0 }, replace: true });
    }
  }, [status.data?.trace_revision, trace.data?.revision, trace.data?.reset, revision, cache, runId, navigate]);
  const stop = useMutation({ retry: false, mutationFn: async () => {
    const { error } = await api.POST("/api/v1/runs/{runId}/stop", { params: { path: { runId: runId! } } });
    if (error) throw new Error(messageOf(error));
  }, onSuccess: () => cache.invalidateQueries({ queryKey: ["runs", runId] }) });
  return <main className="mx-auto max-w-4xl p-6">
    {status.isPending && <p role="status">Loading run…</p>}{status.error && <p role="alert">{status.error.message}</p>}
    {status.data && <><Link to="/jobs/$jobId" params={{ jobId: status.data.job_id }}>{status.data.job_name}</Link>
      <h1 className="text-3xl font-semibold">{status.data.run_name || "Run"}</h1><p role="status">{status.data.state}{status.data.finalizing ? " · Finalizing trace and artifacts" : ""}</p>
      <p>Created {status.data.created_at} · Started {status.data.started_at ?? "Not yet"}</p>
      {status.data.destination_url && /^https?:\/\//.test(status.data.destination_url) && <a href={status.data.destination_url} target="_blank" rel="noopener noreferrer">Execution destination</a>}
      {["starting", "running", "blocked", "stopping"].includes(status.data.state) && <button disabled={stop.isPending || status.data.state === "stopping"} onClick={() => stop.mutate()}>Stop run</button>}
    </>}
    {stop.error && <p role="alert">{stop.error.message}</p>}
    <h2 className="my-4 text-xl font-semibold">Trace</h2>
    {trace.error && <p role="alert">{trace.error.message}</p>}
    {trace.isPending && <p role="status">Loading trace…</p>}
    {trace.data && trace.data.revision === revision && <>
      {!trace.data.items.length && <p>No trace events yet.</p>}
      <ol className="grid gap-3">{trace.data.items.map(event => <li key={`${revision}:${event.id}:${event.sequence}`}><details>
        <summary>{event.title} · {event.type}</summary><pre className="whitespace-pre-wrap break-words">{event.preview}</pre>
      </details></li>)}</ol>
      <nav aria-label="Trace pages" className="my-4 flex gap-4">
        {!!search.after && <Link to="/job-runs/$runId" params={{ runId: runId! }} search={{ after: 0 }}>First trace page</Link>}
        {trace.data.nextCursor !== null && <Link to="/job-runs/$runId" params={{ runId: runId! }} search={{ after: trace.data.nextCursor }}>Next trace page</Link>}
      </nav>
    </>}
  </main>;
}
