import { useCallback, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { Button, Card } from "../../shared/ui";
import { messageOf } from "../auth/session";
import { ProjectGraphFlow, type GraphConnection, type GraphNode, type ProjectFlowInstance } from "./graph-flow";

type Graph = { nodes: GraphNode[]; edges: GraphConnection[] };
async function loadGraph(signal?: AbortSignal) {
  const { data, error } = await api.GET("/api/v1/triggers/graph", { signal });
  if (!data || error) throw new Error(messageOf(error));
  return data as Graph;
}
export function teamGraphQuery() { return { queryKey: ["triggers", "graph"], queryFn: ({ signal }: { signal: AbortSignal }) => loadGraph(signal), staleTime: 10_000 }; }

export function TeamGraph() {
  const query = useQuery(teamGraphQuery()), navigate = useNavigate();
  const [selectedEdge, setSelectedEdge] = useState<GraphConnection | null>(null);
  const [flow, setFlow] = useState<ProjectFlowInstance | null>(null);
  const openTrigger = useCallback((id: string) => void navigate({ to: "/triggers/$triggerId", params: { triggerId: id } }), [navigate]);
  const onSelect = useCallback((edge: GraphConnection) => setSelectedEdge(edge), []);
  if (query.isPending) return <p role="status" className="py-10 text-center">Loading team graph…</p>;
  if (query.error) return <div role="alert" className="py-6">{query.error.message} <Button onClick={() => void query.refetch()}>Retry</Button></div>;
  if (!query.data?.nodes.length) return <Card className="py-10 text-center"><p>No triggers yet.</p></Card>;
  const graph = query.data;
  return <section aria-label="Team workflow graph" className="mt-4">
    <div className="mb-3 flex flex-wrap items-center gap-2" aria-label="Graph controls">
      <Button aria-label="Fit graph to view" onClick={() => flow?.fitView({ padding: 0.18, duration: 200 })}>Fit to view</Button><span className="ml-2 text-sm text-slate-600 dark:text-slate-400">Use the graph controls to zoom. Select a trigger to open it.</span>
    </div>
    <ProjectGraphFlow graphNodes={graph.nodes} graphEdges={graph.edges} onOpen={openTrigger} onSelect={onSelect} flowRef={setFlow} />
    <div aria-label="Graph legend" className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm" role="list">
      <span className="flex items-center gap-2" role="listitem"><span aria-hidden="true" className="inline-block h-4 w-5 rounded border-2 border-teal-700 bg-white" />Enabled trigger</span>
      <span className="flex items-center gap-2" role="listitem"><span aria-hidden="true" className="inline-block h-4 w-5 rounded border-2 border-dashed border-stone-400 bg-stone-200" />Disabled trigger</span>
      <span className="flex items-center gap-2" role="listitem"><span aria-hidden="true" className="inline-block h-4 w-5 rounded border-2 border-sky-600 bg-sky-100" />Webhook</span>
    </div>
    {selectedEdge && <Card className="mt-3" aria-live="polite"><div className="flex items-start justify-between gap-4"><div><h2 className="font-semibold">{selectedEdge.label || "Workflow"}</h2><p className="text-sm text-slate-600 dark:text-slate-400">{graph.nodes.find(node => node.id === selectedEdge.source)?.label ?? graph.nodes.find(node => node.id === selectedEdge.source)?.provider ?? "Unknown"} → {graph.nodes.find(node => node.id === selectedEdge.target)?.label ?? graph.nodes.find(node => node.id === selectedEdge.target)?.provider ?? "Unknown"} · {selectedEdge.kind === "manual" ? "Manual invocation permission" : "Automatic event"} · {selectedEdge.enabled ? "Enabled" : "Disabled"}</p>{selectedEdge.details && <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{selectedEdge.details}</p>}</div><Button aria-label="Close connection details" onClick={() => setSelectedEdge(null)}>Close</Button></div></Card>}
  </section>;
}
