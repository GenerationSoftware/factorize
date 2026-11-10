import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  Background, BaseEdge, Controls, EdgeLabelRenderer, MarkerType, Position, ReactFlow,
  Handle, type Edge, type EdgeProps, type Node, type NodeProps, type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { routeAroundNodes, roundedPath, type GraphRect, type GraphSide } from "./graph-geometry";

export type GraphNode = { id: string; type: string; label: string; provider?: string; jobKind?: string; enabled?: boolean; runningCount?: number; concurrencyLimit?: number };
export type GraphConnection = { id: string; source: string; target: string; label: string; kind: string; enabled: boolean };
type GraphNodeData = { graphNode: GraphNode; onOpen: (id: string) => void };
type GraphEdgeData = { connections: GraphConnection[]; nodeLabels: Record<string, string>; labels: string[]; count: number; muted: boolean; reverse: boolean; selected: boolean; onSelect: (edge: GraphConnection) => void; route: ReturnType<typeof routeAroundNodes> };
type FlowNode = Node<GraphNodeData, "job" | "webhook" | "bounds">;
type FlowEdge = Edge<GraphEdgeData, "routed">;
export type ProjectFlowInstance = ReactFlowInstance<FlowNode, FlowEdge>;
const width = (node: GraphNode) => node.type === "webhook" ? 145 : 220;
const height = (node: GraphNode) => node.type === "webhook" ? 70 : 112;
const positionFor = (nodes: GraphNode[], edges: GraphConnection[]) => {
  const jobs = nodes.filter(node => node.type === "job");
  const indegree = new Map(jobs.map(node => [node.id, 0]));
  for (const edge of edges) if (indegree.has(edge.source) && indegree.has(edge.target) && edge.kind !== "manual") indegree.set(edge.target, indegree.get(edge.target)! + 1);
  const level = new Map<string, number>(), queue = jobs.filter(node => indegree.get(node.id) === 0).map(node => node.id);
  queue.forEach(id => level.set(id, 0));
  for (let i = 0; i < queue.length; i++) for (const edge of edges) if (edge.source === queue[i] && indegree.has(edge.target) && edge.kind !== "manual") {
    level.set(edge.target, Math.max(level.get(edge.target) ?? 0, (level.get(queue[i]) ?? 0) + 1));
    indegree.set(edge.target, indegree.get(edge.target)! - 1); if (indegree.get(edge.target) === 0) queue.push(edge.target);
  }
  let maxLevel = Math.max(0, ...level.values());
  for (const node of jobs) if (!level.has(node.id)) level.set(node.id, ++maxLevel);
  const columns = new Map<number, GraphNode[]>();
  for (const node of jobs) { const col = level.get(node.id)!; columns.set(col, [...(columns.get(col) ?? []), node]); }
  const positions = new Map<string, { x: number; y: number }>();
  for (const [col, column] of columns) column.forEach((node, row) => positions.set(node.id, { x: 300 + col * 340, y: 110 + row * 200 }));
  nodes.filter(node => node.type === "webhook").forEach((node, row) => positions.set(node.id, { x: 35, y: 110 + row * 190 }));
  return positions;
};
function makeLayout(nodes: GraphNode[], edges: GraphConnection[], onOpen: (id: string) => void, onSelect: (edge: GraphConnection) => void) {
  const positions = positionFor(nodes, edges);
  const rects: GraphRect[] = nodes.map(node => ({ id: node.id, ...positions.get(node.id)!, width: width(node), height: height(node) }));
  const grouped = new Map<string, GraphConnection[]>();
  for (const edge of edges) { const pair = JSON.stringify([edge.source, edge.target].sort()); grouped.set(pair, [...(grouped.get(pair) ?? []), edge]); }
  const flowNodes: FlowNode[] = nodes.map(graphNode => ({
    id: graphNode.id, type: graphNode.type === "webhook" ? "webhook" : "job", position: positions.get(graphNode.id)!,
    width: width(graphNode), height: height(graphNode), data: { graphNode, onOpen }, sourcePosition: Position.Right, targetPosition: Position.Left,
  }));
  const flowEdges: FlowEdge[] = [...grouped].map(([pair, group]) => {
    const [a, b] = JSON.parse(pair) as [string, string], from = rects.find(n => n.id === a)!, to = rects.find(n => n.id === b)!;
    const route = routeAroundNodes(from, to, rects, Math.min(240, Math.max(58, group.map(e => e.label.length * 7).reduce((x, y) => x + y, 0) + (group.length > 1 ? 36 : 0))), 48);
    const first = group[0], reverse = group.some(edge => edge.source === b && edge.target === a);
    return { id: group.map(edge => edge.id).sort().join("|"), type: "routed", source: a, target: b,
      sourceHandle: route.sourceSide, targetHandle: route.targetSide, data: { route, labels: group.map(edge => edge.label).filter(Boolean), count: group.length, muted: group.every(edge => !edge.enabled), reverse,
        selected: false, connections: group, nodeLabels: Object.fromEntries(nodes.map(node => [node.id, node.label || node.provider || "Unknown"])), onSelect }, markerEnd: group.some(edge => edge.source === a && edge.target === b) ? { type: MarkerType.ArrowClosed, color: group.every(edge => !edge.enabled) ? "#a8a29e" : "#0f766e" } : undefined,
      markerStart: reverse ? { type: MarkerType.ArrowClosed, color: group.every(edge => !edge.enabled) ? "#a8a29e" : "#0f766e" } : undefined,
      } as FlowEdge;
  });
  const allBounds = flowEdges.flatMap(edge => { const r = edge.data!.route.bounds; return [{ x: r.x, y: r.y }, { x: r.x + r.width, y: r.y + r.height }]; });
  const allX = [...rects.flatMap(r => [r.x, r.x + r.width]), ...allBounds.map(p => p.x)], allY = [...rects.flatMap(r => [r.y, r.y + r.height]), ...allBounds.map(p => p.y)];
  const minX = Math.min(0, ...allX), minY = Math.min(0, ...allY), maxX = Math.max(...allX), maxY = Math.max(...allY);
  flowNodes.push({ id: "__graph_bounds__", type: "bounds", position: { x: minX, y: minY }, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY), data: { graphNode: { id: "", type: "bounds", label: "" }, onOpen }, selectable: false, draggable: false, zIndex: -10, style: { pointerEvents: "none" } });
  return { nodes: flowNodes, edges: flowEdges, rects };
}

const sides: GraphSide[] = ["left", "right", "top", "bottom"];
function handlePosition(side: GraphSide) { return side === "left" ? Position.Left : side === "right" ? Position.Right : side === "top" ? Position.Top : Position.Bottom; }
const GraphCardNode = memo(function GraphCardNode({ data }: NodeProps<FlowNode>) {
  const node = (data as GraphNodeData).graphNode, isJob = node.type === "job", muted = isJob && !node.enabled, active = isJob && (node.runningCount ?? 0) > 0;
  const title = node.label.length > 22 ? node.label.slice(0, 21) + "…" : node.label;
  const accessible = `${node.label}${muted ? ", disabled" : ""}${active ? `, running${node.concurrencyLimit && node.concurrencyLimit > 1 ? `, ${node.runningCount}/${node.concurrencyLimit} active` : ""}` : isJob ? ", not running" : ""}`;
  return <div role={isJob ? "link" : undefined} tabIndex={isJob ? 0 : undefined} onKeyDown={event => { if (isJob && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); (data as GraphNodeData).onOpen(node.id); } }} className={`relative h-full w-full rounded-xl border-2 p-3 shadow-sm ${muted ? "border-dashed border-stone-400 bg-stone-200" : isJob ? "border-teal-700 bg-white" : "border-sky-600 bg-sky-100"}`} aria-label={accessible}>
    {sides.map(side => <Handle key={side + "in"} id={side} type="target" position={handlePosition(side)} className="!h-1 !w-1 !border-0 !bg-transparent" />)}
    {sides.map(side => <Handle key={side + "out"} id={side} type="source" position={handlePosition(side)} className="!h-1 !w-1 !border-0 !bg-transparent" />)}
    {isJob ? <><div className="text-[11px] font-medium text-slate-800">{node.jobKind}</div><div className="mt-1 truncate text-base font-semibold text-slate-800">{title}</div><div className="mt-3 flex items-center gap-2 text-[11px] font-medium text-slate-600"><span className={`inline-block h-2.5 w-2.5 rounded-full ${active ? "bg-emerald-600 motion-safe:animate-pulse" : "bg-stone-400"}`} />{active ? `Running${node.concurrencyLimit && node.concurrencyLimit > 1 ? ` · ${node.runningCount}/${node.concurrencyLimit}` : ""}` : "Not running"}</div></> : <><div className="text-xs font-semibold text-slate-800">{node.provider}</div><div className="mt-1 truncate text-xs text-slate-700">{node.label.length > 19 ? node.label.slice(0, 18) + "…" : node.label}</div></>}
  </div>;
});
const nodeTypes = { job: GraphCardNode, webhook: GraphCardNode };
const BoundsNode = () => <div aria-hidden="true" className="pointer-events-none h-full w-full opacity-0" />;
const GraphEdgeView = memo(function GraphEdgeView(props: EdgeProps<FlowEdge>) {
  const data = props.data as GraphEdgeData & { route: ReturnType<typeof routeAroundNodes> }, path = roundedPath(data.route.points);
  const [open, setOpen] = useState(false), trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false); };
    const keydown = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("pointerdown", dismiss); document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", keydown); };
  }, [open]);
  const label = data.count > 1 ? `${data.labels.join(" · ")} · ${data.count}` : data.labels.join(" · ");
  const center = data.route.label;
  return <><BaseEdge id={props.id} path={path} markerStart={props.markerStart} markerEnd={props.markerEnd} style={{ stroke: data.muted ? "#a8a29e" : "#0f766e", strokeWidth: data.selected ? 3 : 2, strokeDasharray: data.muted ? "6 5" : undefined }} />
    <EdgeLabelRenderer><div className="nodrag nopan pointer-events-auto absolute" style={{ transform: `translate(-50%, -50%) translate(${center.x}px,${center.y}px)` }}><button ref={trigger} type="button" data-graph-interactive className="max-w-[240px] whitespace-normal rounded-md border border-slate-300 bg-white/95 px-2 py-1 text-center text-xs text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200" aria-label={`${label || "Workflow"} connection${data.count > 1 ? `, ${data.count} triggers` : ""}`} aria-haspopup={data.count > 1 ? "dialog" : undefined} aria-expanded={data.count > 1 ? open : undefined} onClick={() => data.count > 1 ? setOpen(value => !value) : data.onSelect(data.connections[0])}>{label || "Connection"}</button>
      {open && <div ref={menu} data-graph-interactive role="dialog" aria-label="Grouped connections" className="absolute left-1/2 top-full z-50 mt-1 max-h-[55vh] w-72 -translate-x-1/2 overflow-y-auto rounded-lg border border-stone-300 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900">{[...data.connections].sort((a, b) => a.label.localeCompare(b.label) || a.source.localeCompare(b.source) || a.target.localeCompare(b.target) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id)).map(edge => <button key={edge.id} type="button" className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-stone-100 focus:bg-stone-100 focus:outline-none dark:hover:bg-slate-800 dark:focus:bg-slate-800" onClick={() => { data.onSelect(edge); setOpen(false); }}><span className="block font-medium">{edge.label || "Workflow"}</span><span className="block text-xs text-slate-600 dark:text-slate-400">{data.nodeLabels[edge.source]} → {data.nodeLabels[edge.target]}</span><span className="block text-xs text-slate-600 dark:text-slate-400">{edge.kind === "manual" ? "Manual invocation permission" : "Automatic trigger"} · {edge.enabled ? "Enabled" : "Disabled"}</span></button>)}</div>}
    </div></EdgeLabelRenderer>
  </>;
});
const edgeTypes = { routed: GraphEdgeView };

export function ProjectGraphFlow({ graphNodes, graphEdges, onOpen, onSelect, flowRef }: {
  graphNodes: GraphNode[]; graphEdges: GraphConnection[]; onOpen: (id: string) => void; onSelect: (edge: GraphConnection) => void;
  flowRef: (instance: ProjectFlowInstance) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const layout = useMemo(() => makeLayout(graphNodes, graphEdges, onOpen, onSelect), [graphNodes, graphEdges, onOpen, onSelect]);
  const edges: FlowEdge[] = useMemo(() => layout.edges.map(edge => ({ ...edge, data: { ...edge.data!, selected: edge.id === selected } } as FlowEdge)), [layout.edges, selected]);
  return <div role="region" aria-label={`Workflow graph with ${graphNodes.filter(node => node.type === "job").length} jobs and ${graphEdges.length} connections`} className="h-[min(68vh,700px)] min-h-[360px] w-full overflow-hidden rounded-xl border border-stone-200 bg-stone-50 dark:border-slate-800 dark:bg-slate-950">
    <ReactFlow nodes={layout.nodes} edges={edges} nodeTypes={{ ...nodeTypes, bounds: BoundsNode }} edgeTypes={edgeTypes} onInit={flowRef} onNodeClick={(_, node) => node.type === "job" && onOpen(node.id)} onEdgeClick={(_, edge) => { setSelected(edge.id); edge.data?.onSelect(); }} onPaneClick={() => setSelected(null)} fitView fitViewOptions={{ padding: 0.18 }} minZoom={0.15} maxZoom={2} nodesDraggable={false} nodesConnectable={false} elementsSelectable onlyRenderVisibleElements proOptions={{ hideAttribution: false }}>
      <Background color="#cbd5e1" gap={24} size={1} /><Controls position="top-right" showInteractive={false} />
    </ReactFlow>
  </div>;
}
