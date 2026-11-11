export type LayoutNode = { id: string; type: string; label: string };
export type LayoutEdge = { source: string; target: string; enabled: boolean };
export function positionProjectGraph(nodes: LayoutNode[], edges: LayoutEdge[]): Map<string, { x: number; y: number }>;
