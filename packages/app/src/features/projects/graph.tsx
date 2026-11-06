import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { Button, Card } from "../../shared/ui";
import { messageOf } from "../auth/session";

type Graph = NonNullable<Awaited<ReturnType<typeof loadGraph>>>;
async function loadGraph(projectId: string, signal?: AbortSignal) {
  const { data, error } = await api.GET("/api/v1/projects/{projectId}/graph", { params: { path: { projectId } }, signal });
  if (!data || error) throw new Error(messageOf(error));
  return data;
}
export function projectGraphQuery(projectId: string) { return { queryKey: ["projects", projectId, "graph"], queryFn: ({ signal }: { signal: AbortSignal }) => loadGraph(projectId, signal), staleTime: 10_000 }; }

export function ProjectGraph({ projectId }: { projectId: string }) {
  const query = useQuery(projectGraphQuery(projectId)), navigate = useNavigate();
  const [selectedEdge, setSelectedEdge] = useState<Graph["edges"][number] | null>(null), [scale, setScale] = useState(1), [offset, setOffset] = useState({ x: 0, y: 0 });
  const layout = useMemo(() => {
    const graph = query.data;
    if (!graph) return { positions: new Map<string, { x: number; y: number }>(), width: 900, height: 400 };
    const jobs = graph.nodes.filter(node => node.type === "job"), indegree = new Map(jobs.map(node => [node.id, 0]));
    for (const edge of graph.edges) if (indegree.has(edge.source) && indegree.has(edge.target) && edge.kind !== "manual") indegree.set(edge.target, indegree.get(edge.target)! + 1);
    const level = new Map<string, number>(), queue = jobs.filter(node => indegree.get(node.id) === 0).map(node => node.id);
    for (const id of queue) level.set(id, 0);
    for (let i = 0; i < queue.length; i++) for (const edge of graph.edges) if (edge.source === queue[i] && indegree.has(edge.target) && edge.kind !== "manual") {
      const next = Math.max(level.get(edge.target) ?? 0, (level.get(queue[i]) ?? 0) + 1); level.set(edge.target, next);
      indegree.set(edge.target, indegree.get(edge.target)! - 1); if (indegree.get(edge.target) === 0) queue.push(edge.target);
    }
    let maxLevel = Math.max(0, ...level.values());
    for (const node of jobs) if (!level.has(node.id)) level.set(node.id, ++maxLevel);
    const columns = new Map<number, string[]>(); for (const node of jobs) { const key = level.get(node.id)!; columns.set(key, [...(columns.get(key) ?? []), node.id]); }
    const positions = new Map<string, { x: number; y: number }>();
    // Keep sources in their own column and give each workflow level enough room
    // for labels and crossing connections to remain readable.
    for (const [column, ids] of columns) ids.forEach((id, row) => positions.set(id, { x: 300 + column * 340, y: 110 + row * 200 }));
    graph.nodes.filter(node => node.type === "webhook").forEach((node, row) => positions.set(node.id, { x: 35, y: 110 + row * 190 }));
    const width = Math.max(900, ...[...positions.values()].map(p => p.x + 190)), height = Math.max(400, ...[...positions.values()].map(p => p.y + 110));
    return { positions, width, height };
  }, [query.data]);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  if (query.isPending) return <p role="status" className="py-10 text-center">Loading project graph…</p>;
  if (query.error) return <div role="alert" className="py-6">{query.error.message} <Button onClick={() => void query.refetch()}>Retry</Button></div>;
  if (!query.data?.nodes.length) return <Card className="py-10 text-center"><p>No jobs in this project yet.</p></Card>;
  const graph = query.data;
  const edgeGroups = new Map<string, Graph["edges"]>();
  for (const edge of graph.edges) {
    const pair = JSON.stringify([edge.source, edge.target].sort());
    edgeGroups.set(pair, [...(edgeGroups.get(pair) ?? []), edge]);
  }
  const zoom = (factor: number) => {
    const next = Math.max(.3, Math.min(2.5, scale * factor));
    const center = { x: layout.width / 2, y: layout.height / 2 };
    setOffset(current => ({
      x: center.x - (center.x - current.x) * next / scale,
      y: center.y - (center.y - current.y) * next / scale,
    }));
    setScale(next);
  };
  return <section aria-label="Project workflow graph" className="mt-4">
    <div className="mb-3 flex flex-wrap items-center gap-2" aria-label="Graph controls">
      <Button aria-label="Zoom out" onClick={() => zoom(.8)}>−</Button><Button aria-label="Zoom in" onClick={() => zoom(1.25)}>+</Button>
      <Button aria-label="Fit graph to view" onClick={() => { setScale(1); setOffset({ x: 0, y: 0 }); }}>Fit to view</Button><span className="ml-2 text-sm text-slate-600 dark:text-slate-400">Drag to pan. Select a job to open it.</span>
    </div>
    <div className="overflow-hidden rounded-xl border border-stone-200 bg-stone-50 dark:border-slate-800 dark:bg-slate-950" onPointerDown={event => { if (event.target === event.currentTarget) { event.currentTarget.setPointerCapture(event.pointerId); setDrag({ x: event.clientX - offset.x, y: event.clientY - offset.y }); } }} onPointerMove={event => { if (drag) setOffset({ x: event.clientX - drag.x, y: event.clientY - drag.y }); }} onPointerUp={() => setDrag(null)}>
      <svg role="img" aria-label={`Workflow graph with ${graph.nodes.filter(node => node.type === "job").length} jobs and ${graph.edges.length} connections`} viewBox={`0 0 ${layout.width} ${layout.height}`} className="h-[min(68vh,700px)] min-h-[360px] w-full touch-none" preserveAspectRatio="xMidYMid meet">
        <defs><marker id="graph-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" /></marker><marker id="graph-arrow-start" viewBox="0 0 10 10" refX="1" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" /></marker></defs>
        <g transform={`translate(${offset.x} ${offset.y}) scale(${scale})`}>
          {[...edgeGroups].map(([pair, edges]) => {
            const [leftId, rightId] = JSON.parse(pair) as [string, string], left = layout.positions.get(leftId), right = layout.positions.get(rightId);
            if (!left || !right) return null;
            const leftNode = graph.nodes.find(node => node.id === leftId), rightNode = graph.nodes.find(node => node.id === rightId);
            const leftWidth = leftNode?.type === "webhook" ? 145 : 170, rightWidth = rightNode?.type === "webhook" ? 145 : 170;
            const leftIsLeft = left.x <= right.x, from = leftIsLeft ? left : right, to = leftIsLeft ? right : left;
            const fromId = leftIsLeft ? leftId : rightId, toId = leftIsLeft ? rightId : leftId;
            const startWidth = leftIsLeft ? leftWidth : rightWidth, endX = to.x;
            const forward = edges.some(edge => edge.source === fromId && edge.target === toId), reverse = edges.some(edge => edge.source === toId && edge.target === fromId);
            const muted = edges.every(edge => !edge.enabled), label = [...new Set(edges.map(edge => edge.label).filter(Boolean))].join(" · ");
            const stroke = muted ? "#a8a29e" : edges.length === 1 && edges[0].kind === "manual" ? "#7c3aed" : edges.length === 1 && edges[0].kind === "webhook" ? "#0284c7" : "#0f766e";
            const groupId = edges.map(edge => edge.id).sort().join("|");
            return <g key={groupId} onClick={() => setSelectedEdge(edges[0])} className="cursor-pointer" role="button" tabIndex={0} aria-label={`${label || "Workflow"} connection${edges.length > 1 ? `, ${edges.length} triggers` : ""}`} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") setSelectedEdge(edges[0]); }}><path d={`M ${from.x + startWidth} ${from.y + 35} Q ${(from.x + startWidth + endX) / 2} ${(from.y + to.y) / 2 + 35} ${endX} ${to.y + 35}`} fill="none" stroke={stroke} strokeWidth={selectedEdge && edges.some(edge => edge.id === selectedEdge.id) ? 4 : 2} strokeDasharray={muted ? "6 5" : undefined} markerStart={reverse ? "url(#graph-arrow-start)" : undefined} markerEnd={forward ? "url(#graph-arrow)" : undefined}/><text x={(from.x + startWidth + endX) / 2} y={(from.y + to.y) / 2 + 28} textAnchor="middle" className="fill-slate-700 text-[12px] dark:fill-slate-200">{label}</text></g>;
          })}
          {graph.nodes.map(node => { const p = layout.positions.get(node.id)!; const isJob = node.type === "job", muted = isJob && !node.enabled, active = isJob && (node.runningCount ?? 0) > 0, height = isJob ? 92 : 70; return <g key={node.id} transform={`translate(${p.x} ${p.y})`} className={isJob ? "cursor-pointer" : ""} role={isJob ? "link" : undefined} tabIndex={isJob ? 0 : undefined} aria-label={isJob ? `${node.jobKind}: ${node.label}${muted ? ", disabled" : ""}${active ? `, running${node.concurrencyLimit && node.concurrencyLimit > 1 ? `, ${node.runningCount}/${node.concurrencyLimit} active` : ""}` : ", not running"}` : node.label} onClick={() => isJob && void navigate({ to: "/jobs/$jobId", params: { jobId: node.id } })} onKeyDown={event => { if (isJob && (event.key === "Enter" || event.key === " ")) void navigate({ to: "/jobs/$jobId", params: { jobId: node.id } }); }}><rect width={isJob ? 170 : 145} height={height} rx="12" fill={muted ? "#e7e5e4" : isJob ? "#fff" : "#e0f2fe"} stroke={muted ? "#a8a29e" : isJob ? "#0f766e" : "#0284c7"} strokeWidth="2" strokeDasharray={muted ? "5 4" : undefined}/><text x="14" y="27" className="fill-slate-800 text-[12px] font-semibold dark:fill-slate-900">{isJob ? node.jobKind : node.provider}</text><text x="14" y="49" className="fill-slate-700 text-[12px] dark:fill-slate-800">{node.label.length > 19 ? node.label.slice(0, 18) + "…" : node.label}</text>{isJob && <><circle cx="19" cy="70" r="5" fill={active ? "#059669" : "#a8a29e"} className={active ? "motion-safe:animate-pulse" : undefined}/><text x="30" y="74" className={`text-[11px] font-medium ${active ? "fill-emerald-700" : "fill-slate-500"}`}>{active ? `Running${node.concurrencyLimit && node.concurrencyLimit > 1 ? ` · ${node.runningCount}/${node.concurrencyLimit}` : ""}` : "Not running"}</text></>}</g>; })}
        </g>
      </svg>
    </div>
    <div aria-label="Graph legend" className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm" role="list">
      <span className="flex items-center gap-2" role="listitem"><span aria-hidden="true" className="inline-block h-4 w-5 rounded border-2 border-teal-700 bg-white" />Enabled job</span>
      <span className="flex items-center gap-2" role="listitem"><span aria-hidden="true" className="inline-block h-4 w-5 rounded border-2 border-dashed border-stone-400 bg-stone-200" />Disabled job</span>
      <span className="flex items-center gap-2" role="listitem"><span aria-hidden="true" className="inline-block h-4 w-5 rounded border-2 border-sky-600 bg-sky-100" />Webhook</span>
    </div>
    {selectedEdge && <Card className="mt-3" aria-live="polite"><div className="flex items-start justify-between gap-4"><div><h2 className="font-semibold">{selectedEdge.label}</h2><p className="text-sm text-slate-600 dark:text-slate-400">{graph.nodes.find(node => node.id === selectedEdge.source)?.label ?? graph.nodes.find(node => node.id === selectedEdge.source)?.provider} → {graph.nodes.find(node => node.id === selectedEdge.target)?.label} · {selectedEdge.enabled ? "Enabled" : "Disabled"}</p></div><Button aria-label="Close connection details" onClick={() => setSelectedEdge(null)}>Close</Button></div></Card>}
  </section>;
}
