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
  const [tab, setTab] = useState<"trace" | "info" | "settings">("trace");
  const [continuous, setContinuous] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const active = !status.data || !["succeeded", "failed", "stopped"].includes(status.data.state) || status.data.finalizing;
  useEffect(() => {
    if (!status.data?.started_at || !active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [status.data?.started_at, active]);
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
    <nav aria-label="Breadcrumb" className="flex min-w-0 flex-wrap items-center gap-2"><Link to="/jobs" search={{ q: "" }}>Jobs</Link>{status.data && <><span aria-hidden="true">→</span><Link className="break-words min-w-0" to="/jobs/$jobId" params={{ jobId: status.data.job_id }}>{status.data.job_name}</Link></>}</nav>
    {status.data && <>
      <div className="mt-5 flex min-w-0 flex-wrap items-start gap-3">
        <h1 className="min-w-0 flex-1 break-words text-3xl font-semibold">{status.data.run_name || "Run"}</h1>
        {["starting", "running", "blocked", "stopping"].includes(status.data.state) && <Button className="shrink-0" disabled={stop.isPending || status.data.state === "stopping"} onClick={() => stop.mutate()}>Stop run</Button>}
      </div>
      <p role="status" className="mb-4"><Badge active={active}>{status.data.state}</Badge>{status.data.finalizing ? " · Finalizing trace and artifacts" : ""}</p>
    </>}
    {stop.error && <p role="alert">{stop.error.message}</p>}
    <div role="tablist" aria-label="Run details" className="mt-6 flex gap-1 overflow-x-auto border-b border-stone-200 dark:border-slate-700">
      {(["trace", "info", "settings"] as const).map((name, index, tabs) => <button key={name} type="button" role="tab" id={`run-tab-${name}`} aria-controls={`run-panel-${name}`} aria-selected={tab === name} tabIndex={tab === name ? 0 : -1}
        className={`min-h-11 shrink-0 border-b-2 px-4 py-3 text-sm capitalize ${tab === name ? "border-factorize-500 font-semibold" : "border-transparent text-slate-600 hover:border-stone-300 dark:text-slate-400"}`}
        onClick={() => setTab(name)} onKeyDown={event => {
          const next = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
          if (next === null) return;
          event.preventDefault(); setTab(tabs[next]); document.getElementById(`run-tab-${tabs[next]}`)?.focus();
        }}>{name[0].toUpperCase() + name.slice(1)}</button>)}
    </div>
    <section role="tabpanel" id="run-panel-info" aria-labelledby="run-tab-info" hidden={tab !== "info"} tabIndex={0}>
      {status.data && <dl className="my-4 grid min-w-0 gap-4 sm:grid-cols-2">
        <div><dt className="text-sm font-semibold text-slate-700 dark:text-slate-300">Created</dt><dd className="break-words text-sm text-slate-600 dark:text-slate-400">{new Date(status.data.created_at).toLocaleString()}</dd></div>
        <div><dt className="text-sm font-semibold text-slate-700 dark:text-slate-300">Started</dt><dd className="break-words text-sm text-slate-600 dark:text-slate-400">{status.data.started_at ? new Date(status.data.started_at).toLocaleString() : "Not started yet"}</dd></div>
        <div><dt className="text-sm font-semibold text-slate-700 dark:text-slate-300">Queue time</dt><dd className="text-sm text-slate-600 dark:text-slate-400">{status.data.started_at ? `${Math.max(0, Math.round((Date.parse(status.data.started_at) - Date.parse(status.data.created_at)) / 1000))}s` : "Not available until the run starts"}</dd></div>
        <div><dt className="text-sm font-semibold text-slate-700 dark:text-slate-300">Runtime</dt><dd className="text-sm text-slate-600 dark:text-slate-400">{status.data.started_at ? `${Math.max(0, Math.round(((active ? now : Date.parse(status.data.updated_at)) - Date.parse(status.data.started_at)) / 1000))}s` : "Not available until the run starts"}</dd></div>
        <div className="sm:col-span-2"><dt className="text-sm font-semibold text-slate-700 dark:text-slate-300">Execution destination</dt><dd className="break-words text-sm text-slate-600 dark:text-slate-400">{status.data.destination_url && /^https?:\/\//.test(status.data.destination_url) ? <><a className="break-all underline" href={status.data.destination_url} target="_blank" rel="noopener noreferrer">{status.data.destination_url}</a><span className="mt-1 block text-xs">The location where this run executes.</span></> : "Not available for this run"}</dd></div>
      </dl>}
      <ExpandedRunDetail runId={runId!} />
    </section>
    <section role="tabpanel" id="run-panel-settings" aria-labelledby="run-tab-settings" hidden={tab !== "settings"} tabIndex={0}>
      {status.data && !active ? <ReplayTrace runId={runId!} /> : <p className="my-4">Replay is available after the run finishes and trace finalization completes.</p>}
    </section>
    <section role="tabpanel" id="run-panel-trace" aria-labelledby="run-tab-trace" hidden={tab !== "trace"} tabIndex={0}>
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
    </section>
  </Page>;
}
