import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { Button, Card, RunStatusLabel } from "../../shared/ui";
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
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null), [openGroupId, setOpenGroupId] = useState<string | null>(null), [dropdownPosition, setDropdownPosition] = useState({ x: 0, y: 0, width: 280 }), [scale, setScale] = useState(1), [offset, setOffset] = useState({ x: 0, y: 0 });
  const badgeRefs = useRef(new Map<string, SVGGElement>()), dropdownRef = useRef<HTMLDivElement>(null), restoreFocusRef = useRef<string | null>(null);
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
    const width = Math.max(900, ...[...positions.values()].map(p => p.x + 240)), height = Math.max(400, ...[...positions.values()].map(p => p.y + 110));
    return { positions, width, height };
  }, [query.data]);
  const pointers = useRef(new Map<number, { x: number; y: number; type: string }>());
  const lastPanCenter = useRef<{ x: number; y: number } | null>(null);
  const graphPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest("[data-graph-interactive]")) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY, type: event.pointerType });
    const active = [...pointers.current.values()], touch = active.some(pointer => pointer.type === "touch");
    if (touch ? active.filter(pointer => pointer.type === "touch").length >= 2 : true) {
      const center = active.reduce((point, pointer) => ({ x: point.x + pointer.x / active.length, y: point.y + pointer.y / active.length }), { x: 0, y: 0 });
      lastPanCenter.current = center;
    }
  };
  const graphPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY, type: event.pointerType });
    const active = [...pointers.current.values()], touch = active.some(pointer => pointer.type === "touch");
    if (touch && active.filter(pointer => pointer.type === "touch").length < 2) return;
    if (!lastPanCenter.current) return;
    const center = active.reduce((point, pointer) => ({ x: point.x + pointer.x / active.length, y: point.y + pointer.y / active.length }), { x: 0, y: 0 });
    const previous = lastPanCenter.current;
    setOffset(current => ({ x: current.x + center.x - previous.x, y: current.y + center.y - previous.y }));
    lastPanCenter.current = center;
  };
  const graphPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    const active = [...pointers.current.values()], touchCount = active.filter(pointer => pointer.type === "touch").length;
    if (!active.length || (active.some(pointer => pointer.type === "touch") && touchCount < 2)) lastPanCenter.current = null;
    else if (lastPanCenter.current) lastPanCenter.current = active.reduce((point, pointer) => ({ x: point.x + pointer.x / active.length, y: point.y + pointer.y / active.length }), { x: 0, y: 0 });
  };
  const edgeGroups = new Map<string, Graph["edges"]>();
  for (const edge of query.data?.edges ?? []) {
    const pair = JSON.stringify([edge.source, edge.target].sort());
    edgeGroups.set(pair, [...(edgeGroups.get(pair) ?? []), edge]);
  }
  useEffect(() => { if (selectedEdgeId && !query.data?.edges.some(edge => edge.id === selectedEdgeId)) setSelectedEdgeId(null); }, [query.data?.edges, selectedEdgeId]);
  useEffect(() => { if (openGroupId && ![...edgeGroups.values()].some(edges => edges.map(edge => edge.id).sort().join("|") === openGroupId)) setOpenGroupId(null); }, [openGroupId, query.data?.edges]);
  useLayoutEffect(() => {
    if (!openGroupId) return;
    const badge = badgeRefs.current.get(openGroupId);
    if (!badge) return;
    const rect = badge.getBoundingClientRect(), width = Math.min(300, window.innerWidth - 24);
    const count = query.data?.edges.filter(edge => openGroupId.split("|").includes(edge.id)).length ?? 0;
    const height = Math.min(window.innerHeight * .6, count * 72 + 8);
    const above = rect.bottom + height > window.innerHeight - 12 && rect.top > height;
    setDropdownPosition({ x: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), y: above ? Math.max(12, rect.top - height - 6) : Math.min(window.innerHeight - height - 12, rect.bottom + 6), width });
    dropdownRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [openGroupId, scale, offset, query.data?.edges]);
  useEffect(() => {
    if (!openGroupId) return;
    const dismiss = (event: globalThis.PointerEvent) => { if (!dropdownRef.current?.contains(event.target as Node) && !badgeRefs.current.get(openGroupId)?.contains(event.target as Node)) setOpenGroupId(null); };
    const keydown = (event: KeyboardEvent) => { if (event.key === "Escape") { restoreFocusRef.current = openGroupId; setOpenGroupId(null); } };
    document.addEventListener("pointerdown", dismiss); document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", keydown); };
  }, [openGroupId]);
  useEffect(() => { if (!openGroupId && restoreFocusRef.current) { badgeRefs.current.get(restoreFocusRef.current)?.focus(); restoreFocusRef.current = null; } }, [openGroupId]);
  if (query.isPending) return <p role="status" className="py-10 text-center">Loading project graph…</p>;
  if (query.error) return <div role="alert" className="py-6">{query.error.message} <Button onClick={() => void query.refetch()}>Retry</Button></div>;
  if (!query.data?.nodes.length) return <Card className="py-10 text-center"><p>No jobs in this project yet.</p></Card>;
  const graph = query.data;
  const selectedEdge = graph.edges.find(edge => edge.id === selectedEdgeId) ?? null;
  const activeGroup = [...edgeGroups].find(([, edges]) => edges.map(edge => edge.id).sort().join("|") === openGroupId);
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
    <div className="overflow-hidden rounded-xl border border-stone-200 bg-stone-50 touch-none dark:border-slate-800 dark:bg-slate-950" onPointerDown={graphPointerDown} onPointerMove={graphPointerMove} onPointerUp={graphPointerUp} onPointerCancel={graphPointerUp}>
      <svg role="img" aria-label={`Workflow graph with ${graph.nodes.filter(node => node.type === "job").length} jobs and ${graph.edges.length} connections`} viewBox={`0 0 ${layout.width} ${layout.height}`} className="h-[min(68vh,700px)] min-h-[360px] w-full touch-none" preserveAspectRatio="xMidYMid meet">
        <defs><marker id="graph-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" /></marker><marker id="graph-arrow-start" viewBox="0 0 10 10" refX="1" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" /></marker></defs>
        <g transform={`translate(${offset.x} ${offset.y}) scale(${scale})`}>
          {[...edgeGroups].map(([pair, edges]) => {
            const [leftId, rightId] = JSON.parse(pair) as [string, string], left = layout.positions.get(leftId), right = layout.positions.get(rightId);
            if (!left || !right) return null;
            const leftNode = graph.nodes.find(node => node.id === leftId), rightNode = graph.nodes.find(node => node.id === rightId);
            const leftWidth = leftNode?.type === "webhook" ? 145 : 220, rightWidth = rightNode?.type === "webhook" ? 145 : 220;
            const leftIsLeft = left.x <= right.x, from = leftIsLeft ? left : right, to = leftIsLeft ? right : left;
            const fromId = leftIsLeft ? leftId : rightId, toId = leftIsLeft ? rightId : leftId;
            const startWidth = leftIsLeft ? leftWidth : rightWidth, endX = to.x;
            const forward = edges.some(edge => edge.source === fromId && edge.target === toId), reverse = edges.some(edge => edge.source === toId && edge.target === fromId);
            const muted = edges.every(edge => !edge.enabled), label = edges.length === 1 ? edges[0].label : "";
            const stroke = muted ? "#a8a29e" : edges.length === 1 && edges[0].kind === "manual" ? "#7c3aed" : edges.length === 1 && edges[0].kind === "webhook" ? "#0284c7" : "#0f766e";
            const groupId = edges.map(edge => edge.id).sort().join("|");
            const middleX = (from.x + startWidth + endX) / 2, middleY = (from.y + to.y) / 2 + 28;
            return <g key={groupId}>
              <path d={`M ${from.x + startWidth} ${from.y + 35} Q ${(from.x + startWidth + endX) / 2} ${(from.y + to.y) / 2 + 35} ${endX} ${to.y + 35}`} fill="none" stroke={stroke} strokeWidth={selectedEdge && edges.some(edge => edge.id === selectedEdge.id) ? 4 : 2} strokeDasharray={muted ? "6 5" : undefined} markerStart={reverse ? "url(#graph-arrow-start)" : undefined} markerEnd={forward ? "url(#graph-arrow)" : undefined}/>
              {edges.length === 1 ? <g data-graph-interactive role="button" tabIndex={0} aria-label={`${edges[0].label || "Workflow"} connection, ${edges[0].source === fromId ? `${leftNode?.label ?? leftNode?.provider} → ${rightNode?.label ?? rightNode?.provider}` : `${rightNode?.label ?? rightNode?.provider} → ${leftNode?.label ?? leftNode?.provider}`}, ${edges[0].enabled ? "enabled" : "disabled"}`} className="cursor-pointer" onClick={() => setSelectedEdgeId(edges[0].id)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedEdgeId(edges[0].id); } }}><text x={middleX} y={middleY} textAnchor="middle" className="fill-slate-700 text-[12px] dark:fill-slate-200">{label}</text></g> : <g ref={element => { if (element) badgeRefs.current.set(groupId, element); else badgeRefs.current.delete(groupId); }} data-graph-interactive role="button" tabIndex={0} aria-label={`${edges.length} connections`} aria-haspopup="dialog" aria-expanded={openGroupId === groupId} className="cursor-pointer" onClick={() => setOpenGroupId(current => current === groupId ? null : groupId)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setOpenGroupId(current => current === groupId ? null : groupId); } }}><rect x={middleX - 13} y={middleY - 14} width="26" height="22" rx="7" className="fill-white stroke-slate-400 dark:fill-slate-800 dark:stroke-slate-500"/><text x={middleX} y={middleY + 2} textAnchor="middle" className="fill-slate-800 text-[12px] font-semibold dark:fill-slate-100">{edges.length}</text></g>}
            </g>;
          })}
          {graph.nodes.map(node => { const p = layout.positions.get(node.id)!; const isJob = node.type === "job", muted = isJob && !node.enabled, active = isJob && (node.runningCount ?? 0) > 0, height = isJob ? 112 : 70, title = node.label.length > 22 ? node.label.slice(0, 21) + "…" : node.label; return <g key={node.id} data-graph-interactive transform={`translate(${p.x} ${p.y})`} className={isJob ? "cursor-pointer" : ""} role={isJob ? "link" : undefined} tabIndex={isJob ? 0 : undefined} aria-label={isJob ? `${node.label}${muted ? ", disabled" : ""}${active ? `, running${node.concurrencyLimit && node.concurrencyLimit > 1 ? `, ${node.runningCount}/${node.concurrencyLimit} active` : ""}` : ", not running"}` : node.label} onClick={() => isJob && void navigate({ to: "/jobs/$jobId", params: { jobId: node.id } })} onKeyDown={event => { if (isJob && (event.key === "Enter" || event.key === " ")) void navigate({ to: "/jobs/$jobId", params: { jobId: node.id } }); }}><rect width={isJob ? 220 : 145} height={height} rx="12" fill={muted ? "#e7e5e4" : isJob ? "#fff" : "#e0f2fe"} stroke={muted ? "#a8a29e" : isJob ? "#0f766e" : "#0284c7"} strokeWidth="2" strokeDasharray={muted ? "5 4" : undefined}/>{isJob ? <><text x="14" y="25" className="fill-slate-800 text-[11px] font-medium dark:fill-slate-900">{node.jobKind}</text><text x="14" y="53" className="fill-slate-800 text-base font-semibold dark:fill-slate-900">{title}</text><foreignObject x="14" y="73" width="192" height="24"><div className="flex items-center gap-1 text-[11px] font-medium text-slate-800"><RunStatusLabel state={active ? "running" : "Not running"} />{active && node.concurrencyLimit && node.concurrencyLimit > 1 ? ` · ${node.runningCount}/${node.concurrencyLimit}` : ""}</div></foreignObject></> : <><text x="14" y="27" className="fill-slate-800 text-[12px] font-semibold dark:fill-slate-900">{node.provider}</text><text x="14" y="49" className="fill-slate-700 text-[12px] dark:fill-slate-800">{node.label.length > 19 ? node.label.slice(0, 18) + "…" : node.label}</text></>}</g>; })}
        </g>
      </svg>
      {activeGroup && <div ref={dropdownRef} data-graph-interactive role="dialog" aria-label="Grouped connections" className="fixed z-50 max-h-[60vh] overflow-y-auto rounded-lg border border-stone-300 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900" style={{ left: dropdownPosition.x, top: dropdownPosition.y, width: dropdownPosition.width }} onPointerDown={event => event.stopPropagation()}>
        {([...activeGroup[1]].sort((a, b) => a.label.localeCompare(b.label) || a.source.localeCompare(b.source) || a.target.localeCompare(b.target) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id))).map((edge, index) => {
          const source = graph.nodes.find(node => node.id === edge.source), target = graph.nodes.find(node => node.id === edge.target);
          return <button key={edge.id} type="button" className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-stone-100 focus:bg-stone-100 focus:outline-none dark:hover:bg-slate-800 dark:focus:bg-slate-800" onClick={() => { setSelectedEdgeId(edge.id); setOpenGroupId(null); }}>
            <span className="block font-medium">{edge.label || "Workflow"}</span>
            <span className="block text-xs text-slate-600 dark:text-slate-400">{source?.label ?? source?.provider ?? "Unknown"} → {target?.label ?? target?.provider ?? "Unknown"}</span>
            <span className="block text-xs text-slate-600 dark:text-slate-400">{edge.kind === "manual" ? "Manual invocation permission" : "Automatic trigger"} · {edge.enabled ? "Enabled" : "Disabled"}</span>
          </button>;
        })}
      </div>}
    </div>
    <div aria-label="Graph legend" className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm" role="list">
      <span className="flex items-center gap-2" role="listitem"><span aria-hidden="true" className="inline-block h-4 w-5 rounded border-2 border-teal-700 bg-white" />Enabled job</span>
      <span className="flex items-center gap-2" role="listitem"><span aria-hidden="true" className="inline-block h-4 w-5 rounded border-2 border-dashed border-stone-400 bg-stone-200" />Disabled job</span>
      <span className="flex items-center gap-2" role="listitem"><span aria-hidden="true" className="inline-block h-4 w-5 rounded border-2 border-sky-600 bg-sky-100" />Webhook</span>
    </div>
    {selectedEdge && <Card className="mt-3" aria-live="polite"><div className="flex items-start justify-between gap-4"><div><h2 className="font-semibold">{selectedEdge.label || "Workflow"}</h2><p className="text-sm text-slate-600 dark:text-slate-400">{graph.nodes.find(node => node.id === selectedEdge.source)?.label ?? graph.nodes.find(node => node.id === selectedEdge.source)?.provider} → {graph.nodes.find(node => node.id === selectedEdge.target)?.label ?? graph.nodes.find(node => node.id === selectedEdge.target)?.provider} · {selectedEdge.kind === "manual" ? "Manual invocation permission" : "Automatic trigger"} · {selectedEdge.enabled ? "Enabled" : "Disabled"}</p></div><Button aria-label="Close connection details" onClick={() => setSelectedEdgeId(null)}>Close</Button></div></Card>}
  </section>;
}
