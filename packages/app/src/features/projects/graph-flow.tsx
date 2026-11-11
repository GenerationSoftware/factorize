import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background, BaseEdge, Controls, EdgeLabelRenderer, MarkerType, Position, ReactFlow,
  Handle, type Edge, type EdgeProps, type Node, type NodeProps, type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { RunStatusLabel } from "../../shared/ui";
import { routeAroundNodes, roundedPath, type GraphRect, type GraphSide } from "./graph-geometry";
import { positionProjectGraph } from "./graph-layout.mjs";

export type GraphNode = { id: string; type: string; label: string; provider?: string; jobKind?: string; enabled?: boolean; runningCount?: number; concurrencyLimit?: number };
export type GraphConnection = { id: string; source: string; target: string; label: string; details?: string; kind: string; enabled: boolean };
type GraphNodeData = { graphNode: GraphNode; onOpen: (id: string) => void };
type GraphEdgeData = { connections: GraphConnection[]; labels: string[]; count: number; muted: boolean; reverse: boolean; selected: boolean; onSelect: (edge: GraphConnection) => void; onGroup: (edges: GraphConnection[], trigger: HTMLButtonElement) => void; route: ReturnType<typeof routeAroundNodes> };
type FlowNode = Node<GraphNodeData, "job" | "webhook" | "bounds">;
type FlowEdge = Edge<GraphEdgeData, "routed">;
export type ProjectFlowInstance = ReactFlowInstance<FlowNode, FlowEdge>;
const width = (node: GraphNode) => node.type === "webhook" ? 145 : 220;
const height = (node: GraphNode) => node.type === "webhook" ? 70 : 112;
function makeLayout(nodes: GraphNode[], edges: GraphConnection[], onOpen: (id: string) => void, onSelect: (edge: GraphConnection) => void, onGroup: (edges: GraphConnection[], trigger: HTMLButtonElement) => void) {
  const positions = positionProjectGraph(nodes, edges);
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
        selected: false, connections: group, onSelect, onGroup }, markerEnd: group.some(edge => edge.source === a && edge.target === b) ? { type: MarkerType.ArrowClosed, color: group.every(edge => !edge.enabled) ? "#a8a29e" : "#0f766e" } : undefined,
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
    {isJob ? <><div className="text-[11px] font-medium text-slate-800">{node.jobKind}</div><div className="mt-1 truncate text-base font-semibold text-slate-800">{title}</div><div className="mt-3 flex items-center gap-1 text-[11px] font-medium text-slate-600"><RunStatusLabel state={active ? "running" : "Not running"} />{active && node.concurrencyLimit && node.concurrencyLimit > 1 ? ` · ${node.runningCount}/${node.concurrencyLimit}` : ""}</div></> : <><div className="text-xs font-semibold text-slate-800">{node.provider}</div><div className="mt-1 truncate text-xs text-slate-700">{node.label.length > 19 ? node.label.slice(0, 18) + "…" : node.label}</div></>}
  </div>;
});
const nodeTypes = { job: GraphCardNode, webhook: GraphCardNode };
const BoundsNode = () => <div aria-hidden="true" className="pointer-events-none h-full w-full opacity-0" />;
const GraphEdgeView = memo(function GraphEdgeView(props: EdgeProps<FlowEdge>) {
  const data = props.data as GraphEdgeData & { route: ReturnType<typeof routeAroundNodes> }, path = roundedPath(data.route.points);
  const label = data.count > 1 ? `${data.labels.join(" · ")} · ${data.count}` : data.labels.join(" · ");
  const center = data.route.label;
  return <><BaseEdge id={props.id} path={path} markerStart={props.markerStart} markerEnd={props.markerEnd} style={{ stroke: data.muted ? "#a8a29e" : "#0f766e", strokeWidth: data.selected ? 3 : 2, strokeDasharray: data.muted ? "6 5" : undefined }} />
    <EdgeLabelRenderer><button type="button" data-graph-interactive className="nodrag nopan pointer-events-auto absolute max-w-[240px] whitespace-normal rounded-md border border-slate-300 bg-white/95 px-2 py-1 text-center text-xs text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200" style={{ transform: `translate(-50%, -50%) translate(${center.x}px,${center.y}px)` }} aria-label={`${label || "Workflow"} connection${data.count > 1 ? `, ${data.count} triggers` : ""}`} aria-haspopup={data.count > 1 ? "dialog" : undefined} onClick={event => data.count > 1 ? data.onGroup(data.connections, event.currentTarget) : data.onSelect(data.connections[0])}>{label || "Connection"}</button></EdgeLabelRenderer>
  </>;
});
const edgeTypes = { routed: GraphEdgeView };

export function ProjectGraphFlow({ graphNodes, graphEdges, onOpen, onSelect, flowRef }: {
  graphNodes: GraphNode[]; graphEdges: GraphConnection[]; onOpen: (id: string) => void; onSelect: (edge: GraphConnection) => void;
  flowRef: (instance: ProjectFlowInstance) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [openGroup, setOpenGroup] = useState<GraphConnection[] | null>(null), groupTrigger = useRef<HTMLButtonElement | null>(null), groupMenu = useRef<HTMLDivElement | null>(null);
  const onGroup = useCallback((connections: GraphConnection[], trigger: HTMLButtonElement) => { groupTrigger.current = trigger; setOpenGroup(connections); }, []);
  useEffect(() => { if (!openGroup) return; const keydown = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpenGroup(null); groupTrigger.current?.focus(); } }; const dismiss = (event: PointerEvent) => { if (!groupMenu.current?.contains(event.target as globalThis.Node) && !groupTrigger.current?.contains(event.target as globalThis.Node)) setOpenGroup(null); }; document.addEventListener("keydown", keydown); document.addEventListener("pointerdown", dismiss); return () => { document.removeEventListener("keydown", keydown); document.removeEventListener("pointerdown", dismiss); }; }, [openGroup]);
  const layout = useMemo(() => makeLayout(graphNodes, graphEdges, onOpen, onSelect, onGroup), [graphNodes, graphEdges, onOpen, onSelect, onGroup]);
  const edges: FlowEdge[] = useMemo(() => layout.edges.map(edge => ({ ...edge, data: { ...edge.data!, selected: edge.id === selected } } as FlowEdge)), [layout.edges, selected]);
  return <div role="region" aria-label={`Workflow graph with ${graphNodes.filter(node => node.type === "job").length} jobs and ${graphEdges.length} connections`} className="relative h-[min(68vh,700px)] min-h-[360px] w-full overflow-hidden rounded-xl border border-stone-200 bg-stone-50 dark:border-slate-800 dark:bg-slate-950">
    <ReactFlow nodes={layout.nodes} edges={edges} nodeTypes={{ ...nodeTypes, bounds: BoundsNode }} edgeTypes={edgeTypes} onInit={flowRef} onNodeClick={(_, node) => node.type === "job" && onOpen(node.id)} onEdgeClick={(_, edge) => { setSelected(edge.id); edge.data?.onSelect(edge.data.connections[0]); }} onPaneClick={() => setSelected(null)} fitView fitViewOptions={{ padding: 0.18 }} minZoom={0.15} maxZoom={2} nodesDraggable={false} nodesConnectable={false} elementsSelectable onlyRenderVisibleElements proOptions={{ hideAttribution: false }}>
      <Background color="#cbd5e1" gap={24} size={1} /><Controls position="top-right" showInteractive={false} />
    </ReactFlow>
    {openGroup && <div ref={groupMenu} role="dialog" aria-label="Grouped connections" className="absolute left-3 top-3 z-50 max-h-[55vh] w-72 overflow-y-auto rounded-lg border border-stone-300 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900">{[...openGroup].sort((a, b) => a.label.localeCompare(b.label) || a.source.localeCompare(b.source) || a.target.localeCompare(b.target) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id)).map(edge => <button key={edge.id} type="button" className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-stone-100 focus:bg-stone-100 focus:outline-none dark:hover:bg-slate-800 dark:focus:bg-slate-800" onClick={() => { setSelected(edge.id); onSelect(edge); setOpenGroup(null); }}><span className="block font-medium">{edge.label || "Workflow"}</span><span className="block text-xs text-slate-600 dark:text-slate-400">{graphNodes.find(node => node.id === edge.source)?.label ?? graphNodes.find(node => node.id === edge.source)?.provider ?? "Unknown"} → {graphNodes.find(node => node.id === edge.target)?.label ?? graphNodes.find(node => node.id === edge.target)?.provider ?? "Unknown"}</span><span className="block text-xs text-slate-600 dark:text-slate-400">{edge.kind === "manual" ? "Manual invocation permission" : "Automatic trigger"} · {edge.enabled ? "Enabled" : "Disabled"}</span></button>)}</div>}
  </div>;
}
