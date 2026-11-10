import { test } from "node:test";
import assert from "node:assert/strict";
import { pathIntersectsRect, routeAroundNodes, roundedPath } from "../src/features/projects/graph-geometry.ts";

const node = (id, x, y, width = 220, height = 112) => ({ id, x, y, width, height });
function assertClear(route, nodes, endpoints, labelWidth = 0, labelHeight = 0) {
  for (const [point, rect] of [[route.points[0], endpoints[0]], [route.points.at(-1), endpoints[1]]]) {
    assert.ok(point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height);
    assert.ok(point.x === rect.x || point.x === rect.x + rect.width || point.y === rect.y || point.y === rect.y + rect.height);
  }
  for (const obstacle of nodes) {
    if (obstacle.id === endpoints[0].id || obstacle.id === endpoints[1].id) continue;
    assert.equal(pathIntersectsRect(route.points, obstacle, 12), false, `route intersects ${obstacle.id}`);
  }
  if (labelWidth) for (const obstacle of nodes) {
    const l = route.label.x - labelWidth / 2, r = route.label.x + labelWidth / 2, t = route.label.y - labelHeight / 2, b = route.label.y + labelHeight / 2;
    assert.ok(r <= obstacle.x || l >= obstacle.x + obstacle.width || b <= obstacle.y || t >= obstacle.y + obstacle.height, `label intersects ${obstacle.id}`);
  }
  assert.match(roundedPath(route.points), /^M /);
  assert.ok(route.bounds.width >= 0 && route.bounds.height >= 0);
}

test("routes around a skipped column and branching/converging obstacles with stable geometry", () => {
  const nodes = [node("source", 0, 100), node("obstacle", 340, 100), node("branch", 680, 0), node("target", 680, 260)];
  const a = routeAroundNodes(nodes[0], nodes[2], nodes, 90, 32);
  const b = routeAroundNodes(nodes[0], nodes[2], nodes, 90, 32);
  assert.deepEqual(a, b);
  assertClear(a, nodes, [nodes[0], nodes[2]], 90, 32);
  assertClear(routeAroundNodes(nodes[0], nodes[3], nodes, 110, 32), nodes, [nodes[0], nodes[3]]);
  assertClear(routeAroundNodes(nodes[2], nodes[3], nodes, 70, 32), nodes, [nodes[2], nodes[3]]);
});

test("routes cycles, reverse connections, webhook sources, and self loops", () => {
  const webhook = node("hook", 0, 0, 145, 70), a = node("a", 300, 0), b = node("b", 300, 220), nodes = [webhook, a, b];
  assertClear(routeAroundNodes(webhook, b, nodes), nodes, [webhook, b]);
  assertClear(routeAroundNodes(b, a, nodes), nodes, [b, a]);
  const self = routeAroundNodes(a, a, nodes, 60, 32);
  assertClear(self, nodes, [a, a]);
  assert.notDeepEqual(self.points[0], self.points.at(-1));
});
