import { Badge, Button, Page } from "../../shared/ui";
import { ContinuousTrace } from "./continuous-trace";
import { ExpandedRunDetail } from "./expanded-detail";
import { ReplayTrace } from "./replay";
import { useEffect, useState, useRef } from "react";
import { Link, useParams, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { runStatusQuery } from "./queries";
import { messageOf } from "../auth/session";
export function RunDetail() {
  const { runId } = useParams({ strict: false });
  const navigate = useNavigate(), cache = useQueryClient();
  const status = useQuery(runStatusQuery(runId!));
  const [revision, setRevision] = useState("");
  const [tab, setTab] = useState<"trace" | "context" | "settings">("trace");
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
  useEffect(() => {
    const next = status.data?.trace_revision;
    if (next && next !== revision) {
      setRevision(next);
      void cache.cancelQueries({ queryKey: ["runs", runId, "trace"] });
      cache.removeQueries({ queryKey: ["runs", runId, "trace"] });
      void cache.cancelQueries({ queryKey: ["runs", runId, "continuous-trace"] });
      cache.removeQueries({ queryKey: ["runs", runId, "continuous-trace"] });
      void cache.cancelQueries({ queryKey: ["runs", runId, "continuous-tail"] });
      cache.removeQueries({ queryKey: ["runs", runId, "continuous-tail"] });
      if (revision) void navigate({ to: "/job-runs/$runId", params: { runId: runId! }, search: { after: 0 }, replace: true });
    }
  }, [status.data?.trace_revision, revision, cache, runId, navigate]);
  const stop = useMutation({ retry: false, mutationFn: async () => {
    const { error } = await api.POST("/api/v1/runs/{runId}/stop", { params: { path: { runId: runId! } } });
    if (error) throw new Error(messageOf(error));
  }, onSuccess: () => cache.invalidateQueries({ queryKey: ["runs", runId] }) });
  return <Page className="max-w-6xl">
    {status.isPending && <p role="status">Loading run…</p>}{status.error && <p role="alert">{status.error.message}</p>}
    <nav aria-label="Breadcrumb" className="flex min-w-0 flex-wrap items-center gap-2"><Link to="/jobs" search={{ q: "" }}>Jobs</Link>{status.data && <><span aria-hidden="true">→</span><Link className="break-words min-w-0" to="/jobs/$jobId" params={{ jobId: status.data.job_id }}>{status.data.job_name}</Link></>}</nav>
    {status.data && <>
      <h1 className="mt-5 text-3xl font-semibold">{status.data.run_name || "Run"}</h1><p role="status" className="mb-4"><Badge active={active}>{status.data.state}</Badge>{status.data.finalizing ? " · Finalizing trace and artifacts" : ""}</p>
      <p className="text-sm text-slate-600 dark:text-slate-400">Created {new Date(status.data.created_at).toLocaleString()} · Started {status.data.started_at ? new Date(status.data.started_at).toLocaleString() : "Not yet"}</p>
      {status.data.started_at && <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Queue time: {Math.max(0, Math.round((Date.parse(status.data.started_at) - Date.parse(status.data.created_at)) / 1000))}s · Runtime: {Math.max(0, Math.round(((active ? Date.now() : Date.parse(status.data.updated_at)) - Date.parse(status.data.started_at)) / 1000))}s</p>}
      {active && <p role="status">Watching live trace…</p>}
      {status.data.destination_url && /^https?:\/\//.test(status.data.destination_url) && <a href={status.data.destination_url} target="_blank" rel="noopener noreferrer">Execution destination</a>}
      {["starting", "running", "blocked", "stopping"].includes(status.data.state) && <Button disabled={stop.isPending || status.data.state === "stopping"} onClick={() => stop.mutate()}>Stop run</Button>}
    </>}
    {stop.error && <p role="alert">{stop.error.message}</p>}
    <div role="tablist" aria-label="Run details" className="mt-6 flex gap-1 overflow-x-auto border-b border-stone-200 dark:border-slate-700">
      {(["trace", "context", "settings"] as const).map((name, index, tabs) => <button key={name} type="button" role="tab" id={`run-tab-${name}`} aria-controls={`run-panel-${name}`} aria-selected={tab === name} tabIndex={tab === name ? 0 : -1}
        className={`min-h-11 shrink-0 border-b-2 px-4 py-3 text-sm capitalize ${tab === name ? "border-factorize-500 font-semibold" : "border-transparent text-slate-600 hover:border-stone-300 dark:text-slate-400"}`}
        onClick={() => setTab(name)} onKeyDown={event => {
          const next = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
          if (next === null) return;
          event.preventDefault(); setTab(tabs[next]); document.getElementById(`run-tab-${tabs[next]}`)?.focus();
        }}>{name[0].toUpperCase() + name.slice(1)}</button>)}
    </div>
    <section role="tabpanel" id="run-panel-context" aria-labelledby="run-tab-context" hidden={tab !== "context"} tabIndex={0}>
      <ExpandedRunDetail runId={runId!} />
    </section>
    <section role="tabpanel" id="run-panel-settings" aria-labelledby="run-tab-settings" hidden={tab !== "settings"} tabIndex={0}>
      {status.data && !active ? <ReplayTrace runId={runId!} /> : <p className="my-4">Replay is available after the run finishes and trace finalization completes.</p>}
    </section>
    <section role="tabpanel" id="run-panel-trace" aria-labelledby="run-tab-trace" hidden={tab !== "trace"} tabIndex={0}>
    <h2 className="my-4 text-xl font-semibold">Trace</h2>
    {revision && <ContinuousTrace key={revision} runId={runId!} revision={revision} active={active} onReset={next => { if (next === revision) return; void cache.cancelQueries({ queryKey: ["runs", runId, "continuous-trace"] }); cache.removeQueries({ queryKey: ["runs", runId, "continuous-trace"] }); setRevision(next); cache.setQueryData(runStatusQuery(runId!).queryKey, previous => previous ? { ...previous, trace_revision: next } : previous); cache.removeQueries({ queryKey: ["runs", runId, "continuous-tail"] }); }} />}
    </section>
  </Page>;
}
