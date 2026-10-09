import { traceClasses } from "./event-body";
import { Disclosure, Summary, Badge, Button, Input, Label, Page } from "../../shared/ui";
import { EventBody } from "./event-body";
import { ContinuousTrace } from "./continuous-trace";
import { ExpandedRunDetail } from "./expanded-detail";
import { ReplayTrace } from "./replay";
import { useEffect, useState, useRef } from "react";
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
  const [continuous, setContinuous] = useState(false);
  const active = !status.data || !["succeeded", "failed", "stopped"].includes(status.data.state) || status.data.finalizing;
  const finalizedSnapshot = useRef("");
  useEffect(() => {
    if (!status.data) return;
    const next = `${status.data.state}:${status.data.finalizing}:${status.data.artifact_state}`;
    if (finalizedSnapshot.current && finalizedSnapshot.current !== next) {
      void cache.invalidateQueries({ queryKey: ["runs", runId, "detail"] });
      void cache.invalidateQueries({ queryKey: ["runs", runId, "diagnostics"] });
    }
    finalizedSnapshot.current = next;
  }, [status.data?.state, status.data?.finalizing, status.data?.artifact_state, cache, runId]);
  const trace = useQuery({ ...runTraceQuery(runId!, revision, search.after, active), enabled: !!revision && !continuous });
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
      void cache.cancelQueries({ queryKey: ["runs", runId, "continuous-trace"] });
      cache.removeQueries({ queryKey: ["runs", runId, "continuous-trace"] });
      void cache.cancelQueries({ queryKey: ["runs", runId, "continuous-tail"] });
      cache.removeQueries({ queryKey: ["runs", runId, "continuous-tail"] });
      if (revision || trace.data?.reset) void navigate({ to: "/job-runs/$runId", params: { runId: runId! }, search: { after: 0 }, replace: true });
    }
  }, [status.data?.trace_revision, trace.data?.revision, trace.data?.reset, revision, cache, runId, navigate]);
  const stop = useMutation({ retry: false, mutationFn: async () => {
    const { error } = await api.POST("/api/v1/runs/{runId}/stop", { params: { path: { runId: runId! } } });
    if (error) throw new Error(messageOf(error));
  }, onSuccess: () => cache.invalidateQueries({ queryKey: ["runs", runId] }) });
  return <Page className="max-w-6xl">
    {status.isPending && <p role="status">Loading run…</p>}{status.error && <p role="alert">{status.error.message}</p>}
    {status.data && <><Link to="/jobs/$jobId" params={{ jobId: status.data.job_id }}>{status.data.job_name}</Link>
      <h1 className="mt-5 text-3xl font-semibold">{status.data.run_name || "Run"}</h1><p role="status" className="mb-4"><Badge active={active}>{status.data.state}</Badge>{status.data.finalizing ? " · Finalizing trace and artifacts" : ""}</p>
      <p className="text-sm text-slate-600 dark:text-slate-400">Created {new Date(status.data.created_at).toLocaleString()} · Started {status.data.started_at ? new Date(status.data.started_at).toLocaleString() : "Not yet"}</p>
      {status.data.started_at && <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Queue time: {Math.max(0, Math.round((Date.parse(status.data.started_at) - Date.parse(status.data.created_at)) / 1000))}s · Runtime: {Math.max(0, Math.round(((active ? Date.now() : Date.parse(status.data.updated_at)) - Date.parse(status.data.started_at)) / 1000))}s</p>}
      {active && <p role="status">{trace.data?.items.at(-1)?.type === "reasoning" ? "Thinking…" : trace.data?.items.at(-1)?.title ? `Activity: ${trace.data.items.at(-1)!.title}` : "Waiting for execution activity…"}</p>}
      {status.data.destination_url && /^https?:\/\//.test(status.data.destination_url) && <a href={status.data.destination_url} target="_blank" rel="noopener noreferrer">Execution destination</a>}
      {["starting", "running", "blocked", "stopping"].includes(status.data.state) && <Button disabled={stop.isPending || status.data.state === "stopping"} onClick={() => stop.mutate()}>Stop run</Button>}
    </>}
    <ExpandedRunDetail runId={runId!} />{status.data && !active && <ReplayTrace runId={runId!} />}
    {stop.error && <p role="alert">{stop.error.message}</p>}
    <h2 className="my-4 text-xl font-semibold">Trace</h2>
    <Label><Input type="checkbox" checked={continuous} onChange={e => setContinuous(e.target.checked)} /> Continuous virtualized trace</Label>
    {continuous && <ContinuousTrace key={revision} runId={runId!} revision={revision} active={active} onReset={next => { if (next === revision) return; void cache.cancelQueries({ queryKey: ["runs", runId, "continuous-trace"] }); cache.removeQueries({ queryKey: ["runs", runId, "continuous-trace"] }); setRevision(next); cache.setQueryData(runStatusQuery(runId!).queryKey, previous => previous ? { ...previous, trace_revision: next } : previous); cache.removeQueries({ queryKey: ["runs", runId, "continuous-tail"] }); }} />}
    {!continuous && trace.error && <p role="alert">{trace.error.message}</p>}
    {!continuous && trace.isPending && <p role="status">Loading trace…</p>}
    {!continuous && trace.data && trace.data.revision === revision && <>
      {!trace.data.items.length && <p>No trace events yet.</p>}
      <ol className="grid gap-3">{trace.data.items.map(event => <li key={`${revision}:${event.id}:${event.sequence}`}><Disclosure className={traceClasses(event.type)}>
        <Summary>{event.title} · {event.type}</Summary><EventBody event={event} />
      </Disclosure></li>)}</ol>
      <nav aria-label="Trace pages" className="my-4 flex gap-4">
        {!!search.after && <Link to="/job-runs/$runId" params={{ runId: runId! }} search={{ after: 0 }}>First trace page</Link>}
        {trace.data.nextCursor !== null && <Link to="/job-runs/$runId" params={{ runId: runId! }} search={{ after: trace.data.nextCursor }}>Next trace page</Link>}
      </nav>
    </>}
  </Page>;
}
