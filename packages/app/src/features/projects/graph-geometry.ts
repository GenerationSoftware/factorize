export type GraphRect = { id: string; x: number; y: number; width: number; height: number };
export type GraphPoint = { x: number; y: number };
export type GraphSide = "left" | "right" | "top" | "bottom";
export type RoutedPath = { points: GraphPoint[]; sourceSide: GraphSide; targetSide: GraphSide; bounds: GraphRect; label: GraphPoint };

const clearance = 32;
const bendCost = 42;
const sides: GraphSide[] = ["left", "right", "top", "bottom"];
const anchor = (rect: GraphRect, side: GraphSide): GraphPoint => ({
  x: side === "left" ? rect.x : side === "right" ? rect.x + rect.width : rect.x + rect.width / 2,
  y: side === "top" ? rect.y : side === "bottom" ? rect.y + rect.height : rect.y + rect.height / 2,
});
const stub = (point: GraphPoint, side: GraphSide): GraphPoint => ({
  x: point.x + (side === "right" ? clearance : side === "left" ? -clearance : 0),
  y: point.y + (side === "bottom" ? clearance : side === "top" ? -clearance : 0),
});
const expanded = (r: GraphRect) => ({ left: r.x - clearance, right: r.x + r.width + clearance, top: r.y - clearance, bottom: r.y + r.height + clearance });
function clearSegment(a: GraphPoint, b: GraphPoint, obstacles: GraphRect[]) {
  if (a.x !== b.x && a.y !== b.y) return false;
  return obstacles.every(rect => {
    const r = expanded(rect);
    if (a.x === b.x) return a.x <= r.left || a.x >= r.right || Math.max(a.y, b.y) <= r.top || Math.min(a.y, b.y) >= r.bottom;
    return a.y <= r.top || a.y >= r.bottom || Math.max(a.x, b.x) <= r.left || Math.min(a.x, b.x) >= r.right;
  });
}
function routeBetween(start: GraphPoint, end: GraphPoint, obstacles: GraphRect[], margin = clearance): GraphPoint[] | null {
  const xs = new Set([start.x, end.x]), ys = new Set([start.y, end.y]);
  for (const o of obstacles) { const r = expanded(o); xs.add(r.left); xs.add(r.right); ys.add(r.top); ys.add(r.bottom); }
  if (obstacles.length) {
    const left = Math.min(...obstacles.map(o => o.x)) - margin, right = Math.max(...obstacles.map(o => o.x + o.width)) + margin;
    const top = Math.min(...obstacles.map(o => o.y)) - margin, bottom = Math.max(...obstacles.map(o => o.y + o.height)) + margin;
    xs.add(left); xs.add(right); ys.add(top); ys.add(bottom);
  }
  const x = [...xs].sort((a, b) => a - b), y = [...ys].sort((a, b) => a - b);
  const points = y.flatMap(py => x.map(px => ({ x: px, y: py })));
  const index = new Map(points.map((p, i) => [`${p.x},${p.y}`, i]));
  const startIndex = index.get(`${start.x},${start.y}`)!, endIndex = index.get(`${end.x},${end.y}`)!;
  type State = { id: number; dir: number; cost: number; prev: string | null };
  const key = (id: number, dir: number) => `${id}:${dir}`;
  const best = new Map<string, State>(), queue: State[] = [{ id: startIndex, dir: 0, cost: 0, prev: null }];
  best.set(key(startIndex, 0), queue[0]);
  let finish: State | undefined;
  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost);
    const state = queue.shift()!;
    if (best.get(key(state.id, state.dir)) !== state) continue;
    if (state.id === endIndex) { finish = state; break; }
    const p = points[state.id];
    const neighbors: [number, number][] = [];
    const row = y.indexOf(p.y), col = x.indexOf(p.x);
    for (const nextCol of [col - 1, col + 1]) if (x[nextCol] !== undefined) neighbors.push([index.get(`${x[nextCol]},${p.y}`)!, 1]);
    for (const nextRow of [row - 1, row + 1]) if (y[nextRow] !== undefined) neighbors.push([index.get(`${p.x},${y[nextRow]}`)!, 2]);
    for (const [ni, dir] of neighbors) {
      const n = points[ni]; if (!clearSegment(p, n, obstacles)) continue;
      const cost = state.cost + Math.abs(n.x - p.x) + Math.abs(n.y - p.y) + (state.dir && state.dir !== dir ? bendCost : 0);
      const k = key(ni, dir), old = best.get(k);
      if (!old || cost < old.cost) { const next = { id: ni, dir, cost, prev: key(state.id, state.dir) }; best.set(k, next); queue.push(next); }
    }
  }
  if (!finish) return null;
  const result: GraphPoint[] = [];
  for (let current: State | undefined = finish; current; current = current.prev ? best.get(current.prev) : undefined) result.push(points[current.id]);
  return result.reverse();
}
function simplify(points: GraphPoint[]) {
  const result: GraphPoint[] = [];
  for (const p of points) {
    const prev = result.at(-1), before = result.at(-2);
    if (prev && before && (prev.x === p.x && prev.x === before.x || prev.y === p.y && prev.y === before.y)) result.pop();
    result.push(p);
  }
  return result;
}
function boundsFor(points: GraphPoint[], labelWidth = 0, labelHeight = 0): GraphRect {
  const minX = Math.min(...points.map(p => p.x)) - labelWidth / 2, maxX = Math.max(...points.map(p => p.x)) + labelWidth / 2;
  const minY = Math.min(...points.map(p => p.y)) - labelHeight / 2, maxY = Math.max(...points.map(p => p.y)) + labelHeight / 2;
  return { id: "route", x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
export function routeAroundNodes(source: GraphRect, target: GraphRect, allNodes: GraphRect[], labelWidth = 0, labelHeight = 0): RoutedPath {
  const obstacles = allNodes.filter(n => n.id !== source.id && n.id !== target.id);
  let best: { points: GraphPoint[]; sourceSide: GraphSide; targetSide: GraphSide; cost: number; label: GraphPoint } | undefined;
  const self = source.id === target.id;
  for (const sourceSide of sides) for (const targetSide of sides) {
    if (self && sourceSide === targetSide) continue;
    const start = anchor(source, sourceSide), end = anchor(target, targetSide);
    const routeObstacles = self ? [...obstacles, source] : obstacles, startStub = stub(start, sourceSide), endStub = stub(end, targetSide);
    if (!clearSegment(start, startStub, obstacles) || !clearSegment(endStub, end, obstacles)) continue;
    let middle = routeBetween(startStub, endStub, routeObstacles, Math.max(clearance * 2, labelWidth / 2 + clearance, labelHeight / 2 + clearance));
    if (!middle) continue;
    const points = simplify([start, ...middle, end]);
    const length = points.slice(1).reduce((n, p, i) => n + Math.abs(p.x - points[i].x) + Math.abs(p.y - points[i].y), 0);
    const labelCandidates = points.slice(1).map((point, i) => {
      const previous = points[i], horizontal = previous.y === point.y, segment = Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y);
      return { x: (previous.x + point.x) / 2, y: (previous.y + point.y) / 2, extent: horizontal ? labelWidth : labelHeight, segment };
    }).sort((a, b) => b.segment - a.segment);
    const label = labelCandidates.find(candidate => candidate.segment >= candidate.extent + 24 && allNodes.every(node => {
      const halfWidth = labelWidth / 2, halfHeight = labelHeight / 2;
      return candidate.x + halfWidth <= node.x || candidate.x - halfWidth >= node.x + node.width || candidate.y + halfHeight <= node.y || candidate.y - halfHeight >= node.y + node.height;
    }));
    if (labelWidth && !label) continue;
    const labelPoint = label ? { x: label.x, y: label.y } : { x: (points[0].x + points.at(-1)!.x) / 2, y: (points[0].y + points.at(-1)!.y) / 2 };
    const cost = length + (points.length - 2) * bendCost + (sourceSide === targetSide ? 24 : 0);
    if (!best || cost < best.cost) best = { points, sourceSide, targetSide, cost, label: labelPoint };
  }
  if (!best) {
    const a = anchor(source, "right"), b = anchor(target, "left"), lane = Math.min(source.y, target.y) - clearance * 2;
    const points = [a, { x: a.x + clearance, y: a.y }, { x: a.x + clearance, y: lane }, { x: b.x - clearance, y: lane }, { x: b.x - clearance, y: b.y }, b];
    best = { points, sourceSide: "right", targetSide: "left", cost: Infinity, label: { x: (a.x + b.x) / 2, y: lane } };
  }
  return { ...best, bounds: boundsFor(best.points, labelWidth, labelHeight) };
}
export function roundedPath(points: GraphPoint[], radius = 12) {
  if (points.length < 2) return "";
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const before = points[i - 1], corner = points[i], after = points[i + 1];
    const beforeDistance = Math.abs(corner.x - before.x) + Math.abs(corner.y - before.y), afterDistance = Math.abs(after.x - corner.x) + Math.abs(after.y - corner.y);
    const r = Math.min(radius, beforeDistance / 2, afterDistance / 2);
    const approach = { x: corner.x + Math.sign(before.x - corner.x) * r, y: corner.y + Math.sign(before.y - corner.y) * r };
    const leave = { x: corner.x + Math.sign(after.x - corner.x) * r, y: corner.y + Math.sign(after.y - corner.y) * r };
    d += ` L ${approach.x} ${approach.y} Q ${corner.x} ${corner.y} ${leave.x} ${leave.y}`;
  }
  const last = points.at(-1)!;
  return `${d} L ${last.x} ${last.y}`;
}
export function pathIntersectsRect(points: GraphPoint[], rect: GraphRect, padding = 0) {
  const r = { left: rect.x - padding, right: rect.x + rect.width + padding, top: rect.y - padding, bottom: rect.y + rect.height + padding };
  return points.slice(1).some((b, i) => {
    const a = points[i];
    if (a.x === b.x) return a.x > r.left && a.x < r.right && Math.max(a.y, b.y) > r.top && Math.min(a.y, b.y) < r.bottom;
    return a.y > r.top && a.y < r.bottom && Math.max(a.x, b.x) > r.left && Math.min(a.x, b.x) < r.right;
  });
}
